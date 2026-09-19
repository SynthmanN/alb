// Объединённый скан читает кувшин: тесты засеивают его в памяти известными числами и проверяют модель отбора и ранжирования.
import { createRequire } from 'node:module';
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

process.env.JUG_DB_PATH = ':memory:';
process.env.DISABLE_RATE_LIMIT = 'true';
process.env.DISABLE_JUG_CRAWLER = 'true';
const require = createRequire(import.meta.url);
const { app, jugDb, resetCaches } = require('../server.js');
const { upsertPriceSnapshots, upsertHistoryBatch } = require('../lib/jugStore.js');

const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString().slice(0, 19);
const CITY = 'Martlock';
const QUERY = { cities: CITY, days: 7, marketShare: 1, minDaily: 1, category: 'weapon', rrr: 'none' };

// Цена материала в кувшине (свежая котировка) и его история торгов (оборот, чтобы закупка партии была осуществима).
function seedMaterial(id, price, dailyVolume = 500) {
  upsertPriceSnapshots(jugDb, [{ item_id: id, city: CITY, quality: 1, sell_price_min: price, sell_price_min_date: iso(NOW - 5 * 60000), buy_price_max: price - 1, buy_price_max_date: iso(NOW - 5 * 60000) }], NOW);
  upsertHistoryBatch(jugDb, [{ item_id: id, location: CITY, quality: 1, data: days().map((ts) => ({ timestamp: ts, item_count: dailyVolume, avg_price: price })) }], NOW);
}
function days(n = 6) { return Array.from({ length: n }, (_, i) => iso(NOW - (i + 1) * 86400000).slice(0, 10) + 'T00:00:00'); }
// Продажа готового: история сделок по качеству (в город) и текущий Buy Order.
function seedSales(id, { quality = 1, avg, perDay, buyOrder = null, city = CITY }) {
  upsertHistoryBatch(jugDb, [{ item_id: id, location: city, quality, data: days().map((ts) => ({ timestamp: ts, item_count: perDay, avg_price: avg })) }], NOW);
  if (buyOrder) {
    upsertPriceSnapshots(jugDb, [{ item_id: id, city, quality, sell_price_min: avg, sell_price_min_date: iso(NOW - 5 * 60000), buy_price_max: buyOrder, buy_price_max_date: iso(NOW - 5 * 60000) }], NOW);
  }
}
const scan = async (extra = {}) => (await request(app).get('/api/unified-scan').query({ ...QUERY, ...extra })).body;

beforeEach(() => {
  jugDb.exec('DELETE FROM prices');
  jugDb.exec('DELETE FROM history');
  resetCaches();
  // T4_MAIN_SWORD = 16 слитков + 8 кожи; T4_2H_BOW = 32 досок (себестоимость без RRR)
  seedMaterial('T4_METALBAR', 100);
  seedMaterial('T4_LEATHER', 100);     // меч: 16×100 + 8×100 = 2400
  seedMaterial('T4_PLANKS', 50, 50000); // лук: 32×50 = 1600 (закупка не узкое место)
});

describe('GET /api/unified-scan', () => {
  it('пустой кувшин — пустой список и честное состояние свежести, а не ошибка', async () => {
    jugDb.exec('DELETE FROM prices');
    const res = await request(app).get('/api/unified-scan').query(QUERY);
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
    expect(res.body.jug).toMatchObject({ lastFullPass: null, oldestPriceAgeMinutes: null });
  });

  it('ранжирует по честному дневному профиту, а не по проценту маржи', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 2 });      // маржа (4000·0.895 − 2400)/2400 = 49%, но всего 2 шт/день
    seedSales('T4_2H_BOW', { avg: 1900, perDay: 200 });        // маржа ≈ 6%, зато 200 шт/день
    const rows = (await scan({ mode: 'patient', quantity: 100 })).results;
    const sword = rows.find((r) => r.itemId === 'T4_MAIN_SWORD');
    const bow = rows.find((r) => r.itemId === 'T4_2H_BOW');
    expect(sword.profitPct).toBeGreaterThan(bow.profitPct * 5);
    expect(bow.dailyProfit).toBeGreaterThan(sword.dailyProfit);
    expect(rows.indexOf(bow)).toBeLessThan(rows.indexOf(sword));
  });

  it('ликвидность — часть отбора комбинации: качество с лучшим % без оборота не побеждает ликвидное', async () => {
    seedSales('T4_MAIN_SWORD', { quality: 1, avg: 6000, perDay: 0.2 });   // «красивое» качество почти не продаётся (ниже порога 1 шт/день)
    seedSales('T4_MAIN_SWORD', { quality: 3, avg: 3500, perDay: 40 });
    const row = (await scan({ mode: 'patient', quantity: 100 })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(row.quality).toBe(3);
    expect(row.avgSellPrice).toBeCloseTo(3500, 0);
  });

  it('убыточный предмет в список не попадает: цена продажи после налога и сбора ниже себестоимости', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 2500, perDay: 50 });     // 2500·(1 − 0.08 − 0.025) = 2237 < 2400
    expect((await scan({ mode: 'patient' })).results.find((r) => r.itemId === 'T4_MAIN_SWORD')).toBeUndefined();
  });

  it('терпеливый режим: сбор за размещение 2.5% учтён, есть закупка+продажа партии и поле quantity', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40 });
    const res = await scan({ mode: 'patient', quantity: 200 });
    const row = res.results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(row.profitPerUnit).toBeCloseTo(4000 * (1 - 0.08 - 0.025) - 2400, 0);
    expect(row.quantity).toBe(200);
    expect(row.daysToSell).toBeCloseTo(200 / (6 * 40 / 7), 5);    // партия / (оборот × доля рынка 100%); оборот = сделки за 6 дней / окно 7 дней
    expect(row.daysToAcquire).toBeGreaterThan(0);                 // закупка 200×16 слитков при обороте 500/день
    expect(row.totalDays).toBeCloseTo(row.daysToAcquire + row.daysToSell, 5);
    expect(res.setupFeeRate).toBe(0.025);
  });

  it('мгновенный режим: продаём в текущий Buy Order без сбора за размещение, циклов нет', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40, buyOrder: 3800 });
    const res = await scan({ mode: 'instant' });
    const row = res.results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(row.avgSellPrice).toBe(3800);
    expect(row.profitPerUnit).toBeCloseTo(3800 * 0.92 - 2400, 0);
    expect(row.sellCities).toEqual([CITY]);
    expect(row.totalDays).toBeNull();
    expect(res.setupFeeRate).toBe(0);
  });

  it('мгновенный режим без Buy Order-а предмет не показывает (продавать некуда)', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40 });
    expect((await scan({ mode: 'instant' })).results.find((r) => r.itemId === 'T4_MAIN_SWORD')).toBeUndefined();
  });

  it('шумный город не задаёт цену: при liquidity=best берётся город с реальным оборотом', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 3200, perDay: 60, city: 'Martlock' });
    seedSales('T4_MAIN_SWORD', { avg: 9000, perDay: 0.3, city: 'Lymhurst' });    // 0.5% оборота: одна сделка по завышенной цене
    const res = await scan({ mode: 'patient', liquidity: 'best', cities: 'Martlock,Lymhurst', minDaily: 0 });
    const row = res.results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(row.sellCities).toEqual(['Martlock']);
    expect(row.avgSellPrice).toBeCloseTo(3200, 0);
  });

  it('сырьё/рефайн — опция: без includeMaterials его нет, с ним строка kind=material', async () => {
    seedMaterial('T2_ORE', 10);                                  // T2: 1 руда → 1 слиток
    seedSales('T2_METALBAR', { avg: 40, perDay: 300, buyOrder: 38 });
    const without = await scan({ mode: 'instant', category: 'all' });
    expect(without.results.some((r) => r.kind === 'material')).toBe(false);
    const withMaterials = await scan({ mode: 'instant', category: 'all', includeMaterials: 'true' });
    const row = withMaterials.results.find((r) => r.kind === 'material' && r.itemId === 'T2_METALBAR');
    expect(row).toBeTruthy();
    expect(row).toMatchObject({ type: 'ORE', tier: 2, enchant: 0, quality: 1, cost: 10 });
    expect(row.profitPerUnit).toBeCloseTo(38 * 0.92 - 10, 2);
  });

  it('рефайн в терпеливом режиме и гир ранжируются вместе по одному правилу (дневной профит)', async () => {
    seedMaterial('T2_ORE', 10);
    seedSales('T2_METALBAR', { avg: 40, perDay: 300 });
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40 });
    const rows = (await scan({ mode: 'patient', category: 'all', includeMaterials: 'true', quantity: 100 })).results;
    expect(rows.map((r) => r.kind).sort()).toEqual(['gear', 'material']);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].rankScore).toBeGreaterThanOrEqual(rows[i].rankScore);
  });

  it('доля рынка масштабирует дневной профит (конкуренты тоже продают)', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40 });
    const full = (await scan({ mode: 'patient', marketShare: 1 })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    const quarter = (await scan({ mode: 'patient', marketShare: 0.25 })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(quarter.yourDailyVolume).toBeCloseTo(full.yourDailyVolume / 4, 5);
    expect(quarter.dailyProfit).toBeLessThan(full.dailyProfit);
  });

  it('материал без оборота за период: закупку партии оценить нельзя — предмет в терпеливом режиме не показывается', async () => {
    jugDb.exec("DELETE FROM history WHERE item_id = 'T4_LEATHER'");
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40 });
    expect((await scan({ mode: 'patient' })).results.find((r) => r.itemId === 'T4_MAIN_SWORD')).toBeUndefined();
  });

  it('выброс в истории AODP (цена в 100 раз выше рынка) не превращается в выдуманный профит', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 3200, perDay: 40, city: 'Martlock' });
    seedSales('T4_MAIN_SWORD', { avg: 3300, perDay: 30, city: 'Thetford' });
    seedSales('T4_MAIN_SWORD', { avg: 320000, perDay: 20, city: 'Lymhurst' });    // абсурдная «средняя цена» из битых данных
    const res = await scan({ mode: 'patient', cities: 'Martlock,Thetford,Lymhurst', quantity: 100 });
    const row = res.results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(row.avgSellPrice).toBeLessThan(3400);
    expect(row.sellCities).not.toContain('Lymhurst');
  });

  it('фантомный Buy Order (в разы выше рынка) не считается ценой мгновенной продажи', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 3200, perDay: 40, buyOrder: 3000 });
    seedSales('T4_MAIN_SWORD', { avg: 3300, perDay: 40, buyOrder: 90000, city: 'Thetford' });
    const res = await scan({ mode: 'instant', cities: 'Martlock,Thetford' });
    const row = res.results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(row.avgSellPrice).toBe(3000);
    expect(row.sellCities).toEqual([CITY]);
  });

  it('.4 по умолчанию не ищется, но это явный выбор: с includeAwakened строка .4 появляется, диапазон сообщается в ответе', async () => {
    seedMaterial('T4_METALBAR_LEVEL4@4', 100);
    seedMaterial('T4_LEATHER_LEVEL4@4', 100);
    seedSales('T4_MAIN_SWORD@4', { avg: 20000, perDay: 30 });
    const off = await scan({ mode: 'patient', quantity: 100 });
    expect(off.enchantRange).toBe('.0–.3');
    expect(off.results.find((r) => r.itemId === 'T4_MAIN_SWORD')).toBeUndefined();
    const on = await scan({ mode: 'patient', quantity: 100, includeAwakened: 'true' });
    expect(on.enchantRange).toBe('.0–.4');
    expect(on.results.find((r) => r.itemId === 'T4_MAIN_SWORD')).toMatchObject({ enchant: 4 });
  });

  it('.4 не берётся при «зачаровать после крафта»: рунами .4 не получить', async () => {
    seedMaterial('T4_RUNE', 100); seedMaterial('T4_SOUL', 100); seedMaterial('T4_RELIC', 100);
    seedSales('T4_MAIN_SWORD@4', { avg: 90000, perDay: 30 });
    const res = await scan({ mode: 'patient', quantity: 100, includeAwakened: 'true', enchantMode: 'after' });
    expect(res.results.find((r) => r.itemId === 'T4_MAIN_SWORD')).toBeUndefined();
  });

  it('индекс доверия: 6 часов торговли — 23%, а не «уверенные» 100%; в ответе есть tradeHours', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40 });          // seedSales кладёт по одной точке в день, 6 дней
    const row = (await scan({ mode: 'patient', quantity: 100 })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(row.tradeHours).toBe(6);
    expect(row.confidence).toBeCloseTo(6 / 26, 9);
  });

  it('возврат по городу покупки: с бонусом города себестоимость меньше, чем без него', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40 });
    const without = (await scan({ mode: 'patient', quantity: 100, royalBonus: 'false', focus: 'false' })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    const withBonus = (await scan({ mode: 'patient', quantity: 100, royalBonus: 'true', focus: 'false' })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    // в тестовом кувшине единственный город — Martlock: кожа получает спец-бонус (58%), слитки — только базу (18%)
    expect(withBonus.cost).toBeCloseTo(16 * 100 * (1 - 0.18 / 1.18) + 8 * 100 * (1 - 0.58 / 1.58), 0);
    expect(withBonus.cost).toBeLessThan(without.cost);
  });

  it('РЕГРЕССИЯ: убыточный город с огромным оборотом не раздувает профит и не топит прибыльный (профит считается по городам)', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 10, city: 'Martlock' });          // прибыльный: 4000·0.895 − 2400 = 1180/шт
    seedSales('T4_MAIN_SWORD', { avg: 2000, perDay: 5000, city: 'Thetford' });        // убыточный, но с огромным оборотом
    const row = (await scan({ mode: 'patient', cities: 'Martlock,Thetford', quantity: 100 })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    const profitPerUnit = 4000 * (1 - 0.08 - 0.025) - 2400;
    expect(row.profitPerUnit).toBeCloseTo(profitPerUnit, 6);
    expect(row.sellCities).toEqual(['Martlock']);
    expect(row.dailyVolume).toBeCloseTo(60 / 7, 6);                                   // оборот только прибыльного города
    expect(row.dailyProfit).toBeCloseTo(profitPerUnit * (60 / 7) * 1, 4);             // и профит в день — только с него
  });
});

