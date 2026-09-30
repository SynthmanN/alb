// Скан и реролл качества: серверная копия модели совпадает с клиентской, реролл до «Отличного» входит в себестоимость строк этого качества,
// «рецепты с зачарованными материалами» выключены — гир .1–.3 считается только как «.0 + реролл на .0 + чары после крафта»
import { createRequire } from 'node:module';
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { rerollCost } from '../public/js/next/logic/reroll.js';

process.env.JUG_DB_PATH = ':memory:';
process.env.DISABLE_RATE_LIMIT = 'true';
process.env.DISABLE_JUG_CRAWLER = 'true';
const require = createRequire(import.meta.url);
const { app, jugDb, resetCaches, scanRerollCost } = require('../server.js');
const { upsertPriceSnapshots, upsertHistoryBatch } = require('../lib/jugStore.js');

const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString().slice(0, 19);
const CITY = 'Martlock';
const QUERY = { cities: CITY, days: 7, minDaily: 1, minDays: 1, category: 'weapon', gearRrr: 'none', mode: 'patient' };
const days = () => Array.from({ length: 6 }, (_, i) => iso(NOW - (i + 1) * 86400000).slice(0, 10) + 'T00:00:00');
function seedMaterial(id, price, dailyVolume = 500) {
  upsertPriceSnapshots(jugDb, [{ item_id: id, city: CITY, quality: 1, sell_price_min: price, sell_price_min_date: iso(NOW - 5 * 60000), buy_price_max: price - 1, buy_price_max_date: iso(NOW - 5 * 60000) }], NOW);
  const recent = { timestamp: iso(NOW - 2 * 3600000), item_count: dailyVolume, avg_price: price };
  upsertHistoryBatch(jugDb, [{ item_id: id, location: CITY, quality: 1, data: [...days().map((ts) => ({ timestamp: ts, item_count: dailyVolume, avg_price: price })), recent] }], NOW);
}
function seedSales(id, { quality = 1, avg, perDay }) {
  upsertHistoryBatch(jugDb, [{ item_id: id, location: CITY, quality, data: days().map((ts) => ({ timestamp: ts, item_count: perDay, avg_price: avg })) }], NOW);
}
const sword = async (extra = {}) => (await request(app).get('/api/unified-scan').query({ ...QUERY, ...extra })).body.results.find((r) => r.itemId === 'T4_MAIN_SWORD');
const RE = { reroll: 'true' };
const BASE0 = 24 * 100 * 1.025;       // меч .0: 16 слитков + 8 кожи по 100 с комиссией 2.5%
const STEP = 288 * 10 * 1.025;        // один шаг чар одноручного при руне/душе по 10

beforeEach(() => {
  jugDb.exec('DELETE FROM prices');
  jugDb.exec('DELETE FROM history');
  resetCaches();
  seedMaterial('T4_METALBAR', 100); seedMaterial('T4_LEATHER', 100);
  seedMaterial('T4_RUNE', 10); seedMaterial('T4_SOUL', 10); seedMaterial('T4_RELIC', 10);
});

describe('серверная копия модели реролла', () => {
  it('совпадает с logic/reroll.js: по шансам крафта и с фиксированного качества, на всех уровнях зачарования', () => {
    for (const level of [0, 1, 2, 3]) {
      expect(scanRerollCost(level, { on: true, from: 0, base: 2604.17 })).toBeCloseTo(11473.5 * 2 ** level, 0);
      for (const from of [1, 2, 3]) expect(scanRerollCost(level, { on: true, from, base: 2604.17 })).toBeCloseTo(rerollCost(from, 4, level), 6);
    }
    expect(scanRerollCost(0, { on: true, from: 4, base: 2604.17 })).toBe(0);
    expect(scanRerollCost(0, { on: false, from: 0, base: 2604.17 })).toBe(0);
  });
});

describe('реролл в себестоимости скана', () => {
  it('без параметра реролл выключен — себестоимость как раньше', async () => {
    seedSales('T4_MAIN_SWORD', { quality: 4, avg: 40000, perDay: 30 });
    expect((await sword()).cost).toBeCloseTo(BASE0, 2);
  });
  it('«Отличное»: себестоимость растёт на средний реролл с качества после крафта по шансам; ранжирование и профит уже с ним', async () => {
    seedSales('T4_MAIN_SWORD', { quality: 4, avg: 40000, perDay: 30 });
    const off = await sword();
    const on = await sword(RE);
    expect(on.quality).toBe(4);
    expect(on.cost).toBeCloseTo(BASE0 + 11473.5, 0);
    expect(off.profitPerUnit - on.profitPerUnit).toBeCloseTo(11473.5, 0);
    expect(on.profitPct).toBeCloseTo((on.profitPerUnit / on.cost) * 100, 6);
  });
  it('другие качества реролла не получают (в скане он только до «Отличного»)', async () => {
    seedSales('T4_MAIN_SWORD', { quality: 3, avg: 40000, perDay: 30 });
    const row = await sword(RE);
    expect(row.quality).toBe(3);
    expect(row.cost).toBeCloseTo(BASE0, 2);
  });
  it('rerollStart — фиксированное качество после крафта, rerollBase — цена попытки; «Отличное» после крафта — без реролла', async () => {
    seedSales('T4_MAIN_SWORD', { quality: 4, avg: 40000, perDay: 30 });
    expect((await sword({ ...RE, rerollStart: 1 })).cost).toBeCloseTo(BASE0 + 12843, 0);
    expect((await sword({ ...RE, rerollStart: 2 })).cost).toBeCloseTo(BASE0 + rerollCost(2, 4, 0), 4);
    expect((await sword({ ...RE, rerollStart: 4 })).cost).toBeCloseTo(BASE0, 2);
    expect((await sword({ ...RE, rerollBase: 5208.34 })).cost).toBeCloseTo(BASE0 + 2 * 11473.5, 0);
  });
  it('разные настройки реролла не смешиваются в кэше', async () => {
    seedSales('T4_MAIN_SWORD', { quality: 4, avg: 40000, perDay: 30 });
    const a = await sword(RE);
    const b = await sword({ ...RE, rerollStart: 1 });
    const c = await sword();
    expect(new Set([a.cost, b.cost, c.cost]).size).toBe(3);
  });
});

describe('enchantedRecipes: рецепты с зачарованными материалами', () => {
  beforeEach(() => {
    seedMaterial('T4_METALBAR_LEVEL2@2', 100); seedMaterial('T4_LEATHER_LEVEL2@2', 100);     // прямой .2 стоит как .0: 2460
    seedSales('T4_MAIN_SWORD@2', { quality: 4, avg: 90000, perDay: 30 });
  });
  it('по умолчанию для сервера (без параметра) поведение прежнее: enchantMode=direct — прямой крафт .2 с рероллом на .2', async () => {
    const row = await sword({ ...RE, enchantMode: 'direct' });
    expect(row).toMatchObject({ enchant: 2, after: false });
    expect(row.cost).toBeCloseTo(BASE0 + 45894, 0);
  });
  it('включены + auto: выбирается лучшее с учётом реролла — «.0 + реролл на .0 + чары» дешевле прямого .2 с рероллом на .2', async () => {
    const row = await sword({ ...RE, enchantMode: 'auto', enchantedRecipes: 'true' });
    expect(row).toMatchObject({ enchant: 2, after: true });
    expect(row.cost).toBeCloseTo(BASE0 + 2 * STEP + 11473.5, 0);
  });
  it('выключены: .2 считается только как «.0 + реролл на .0 + чары после крафта», даже при enchantMode=direct', async () => {
    const row = await sword({ ...RE, enchantMode: 'direct', enchantedRecipes: 'false' });
    expect(row).toMatchObject({ enchant: 2, after: true });
    expect(row.cost).toBeCloseTo(BASE0 + 2 * STEP + 11473.5, 0);
  });
  it('выключены: .0 и .4 остаются прямым крафтом, смешанные рецепты игнорируются', async () => {
    jugDb.exec("DELETE FROM history WHERE item_id='T4_MAIN_SWORD@2'");
    seedSales('T4_MAIN_SWORD@4', { quality: 4, avg: 90000, perDay: 30 });
    seedMaterial('T4_METALBAR_LEVEL4@4', 100); seedMaterial('T4_LEATHER_LEVEL4@4', 100);
    const r4 = await sword({ enchantMode: 'auto', enchantedRecipes: 'false' });
    expect(r4).toMatchObject({ enchant: 4, after: false });
    seedSales('T4_MAIN_SWORD@2', { quality: 4, avg: 90000, perDay: 30 });
    jugDb.exec("DELETE FROM history WHERE item_id='T4_MAIN_SWORD@4'");
    seedMaterial('T4_METALBAR_LEVEL1@1', 100); seedMaterial('T4_LEATHER_LEVEL1@1', 100);
    const mixedOff = await sword({ enchantMode: 'after', mixed: 'true', enchantedRecipes: 'false' });
    expect(mixedOff.enchantBaseLevel).toBe(0);
  });
  it('реролл дорожает с уровнем базы: смешанный рецепт с базой .1 без реролла выигрывает, с рероллом побеждает база .0', async () => {
    seedMaterial('T4_METALBAR_LEVEL1@1', 100); seedMaterial('T4_LEATHER_LEVEL1@1', 100);
    const noReroll = await sword({ enchantMode: 'after', mixed: 'true' });
    expect(noReroll.enchantBaseLevel).toBe(1);
    expect(noReroll.cost).toBeCloseTo(BASE0 + STEP, 0);
    const withReroll = await sword({ ...RE, enchantMode: 'after', mixed: 'true' });
    expect(withReroll.enchantBaseLevel).toBe(0);
    expect(withReroll.cost).toBeCloseTo(BASE0 + 2 * STEP + 11473.5, 0);
  });
  it('в ответе видны настройки: enchantedRecipes и reroll { on, from, target: 4 }', async () => {
    const res = (await request(app).get('/api/unified-scan').query({ ...QUERY, ...RE, rerollStart: 1, enchantedRecipes: 'false' })).body;
    expect(res.enchantedRecipes).toBe(false);
    expect(res.reroll).toMatchObject({ on: true, from: 1, target: 4 });
  });
});
