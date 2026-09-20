// План фракционных очков и вписанные цены: кувшин засеян известными числами.
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
const FEE = 1.025;
const CITY = 'Martlock';
const Q = { faction: 'MARTLOCK', cities: CITY, days: 3 };

function seedPrice(id, price, perDay = 500) {
  upsertPriceSnapshots(jugDb, [{ item_id: id, city: CITY, quality: 1, sell_price_min: price, sell_price_min_date: iso(NOW - 5 * 60000), buy_price_max: 0, buy_price_max_date: iso(NOW - 5 * 60000) }], NOW);
  if (perDay) upsertHistoryBatch(jugDb, [{ item_id: id, location: CITY, quality: 1, data: [{ timestamp: iso(NOW - 2 * 3600000), item_count: perDay, avg_price: price }] }], NOW);
}
function seedSale(id, quality, avg, perDay) {
  upsertHistoryBatch(jugDb, [{ item_id: id, location: CITY, quality, data: [1, 2].map((d) => ({ timestamp: iso(NOW - d * 3600000), item_count: perDay, avg_price: avg })) }], NOW);
}
const plan = async (extra = {}) => (await request(app).get('/api/faction-plan').query({ ...Q, ...extra })).body;

beforeEach(() => {
  jugDb.exec('DELETE FROM prices');
  jugDb.exec('DELETE FROM history');
  jugDb.exec('DELETE FROM manual_prices');
  resetCaches();
  // T4: обычный плащ .0 и .2, руны/души, герб и сердце; продажи T4 .2 отличного и T5 .0 обычного
  seedPrice('T4_CAPE', 1000);
  seedPrice('T4_CAPE@2', 5000);
  seedPrice('T4_RUNE', 10);
  seedPrice('T4_SOUL', 20);
  seedPrice('T4_CAPEITEM_FW_MARTLOCK_BP', 3000, 50);
  seedPrice('T1_FACTION_HIGHLAND_TOKEN_1', 2000, 50);
  seedSale('T4_CAPEITEM_FW_MARTLOCK@2', 4, 60000, 20);
  seedPrice('T5_CAPE', 2000);
  seedSale('T5_CAPEITEM_FW_MARTLOCK', 1, 20000, 10);
});

describe('GET /api/faction-plan', () => {
  it('в списке только комбинации, по которым есть данные продаж (не 125 строк); очков на плащ по тиру; нужна фракция', async () => {
    const d = await plan();
    expect(d.rows.map((r) => [r.tier, r.enchant, r.quality])).toEqual([[4, 2, 4], [5, 0, 1]]);
    expect(d.rows.map((r) => r.pointsPerCape)).toEqual([3400, 5250]);
    expect((await request(app).get('/api/faction-plan?faction=NOPE')).status).toBe(400);
  });

  it('два пути себестоимости: прямой (плащ .2) и «после крафта» (плащ .0 + руны, души); руны и души — количеством для слота плаща', async () => {
    const r = (await plan()).rows[0];
    expect(r.capeDirect).toMatchObject({ id: 'T4_CAPE@2' });
    expect(r.capeDirect.price).toBeCloseTo(5000 * FEE, 6);
    expect(r.cape0.price).toBeCloseTo(1000 * FEE, 6);
    expect(r.runes.map((x) => x.id)).toEqual(['T4_RUNE', 'T4_SOUL']);
    expect(r.runes.every((x) => x.count === 96)).toBe(true);
    expect(r.runes[0].price).toBeCloseTo(10 * FEE, 6);
  });

  it('продажа: средняя цена, чистая после налога и Setup Fee, оборот, возраст сделок; герб и сердце — рыночные цены для сравнения', async () => {
    const r = (await plan()).rows[0];
    expect(r.sale.avgPrice).toBeCloseTo(60000, 6);
    expect(r.sale.netSell).toBeCloseTo(60000 * (1 - 0.08 - 0.025), 6);
    expect(r.sale.dailyVolume).toBeGreaterThan(0);
    expect(r.crest.price).toBeCloseTo(3000, 6);
    expect(r.heart.price).toBeCloseTo(2000, 6);
    expect(r.sale.manual).toBe(false);
  });

  it('добавленная пользователем позиция без данных попадает в список (extra=тир:чарка:качество), продажи в ней нет', async () => {
    const d = await plan({ extra: '7:2:4' });
    const t7 = d.rows.find((r) => r.tier === 7);
    expect(t7).toMatchObject({ enchant: 2, quality: 4, pointsPerCape: 3000 + 7500, sale: null });
    expect(t7.capeDirect.price).toBeNull();                                        // нет цены — клиент попросит вписать
    expect(t7.crest).toBeNull();
  });
});

describe('вписанные цены (POST /api/manual-price)', () => {
  it('герб без данных: вписанная цена подставляется как цена рынка с пометкой manual; кувшин остаётся при обновлении AODP, пока данных нет', async () => {
    const before = (await plan({ extra: '7:0:1' })).rows.find((r) => r.tier === 7);
    expect(before.crest).toBeNull();
    const res = await request(app).post('/api/manual-price').send({ id: 'T7_CAPEITEM_FW_MARTLOCK_BP', quality: 1, price: 30000 });
    expect(res.body).toMatchObject({ ok: true, price: 30000 });
    resetCaches();
    const after = (await plan({ extra: '7:0:1' })).rows.find((r) => r.tier === 7);
    expect(after.crest).toMatchObject({ manual: true });
    expect(after.crest.price).toBeCloseTo(30000, 6);
    // пришли данные AODP — вписанная цена уходит на второй план (ручная запись жива, но не применяется)
    seedPrice('T7_CAPEITEM_FW_MARTLOCK_BP', 25000, 5);
    resetCaches();
    const aodp = (await plan({ extra: '7:0:1' })).rows.find((r) => r.tier === 7);
    expect(aodp.crest.manual).toBe(false);
    expect(aodp.crest.price).toBeCloseTo(25000, 6);
  });

  it('цена продажи для позиции без истории — вписанная, помечена manual; 0 убирает; неизвестный id, качество и цена проверяются', async () => {
    await request(app).post('/api/manual-price').send({ id: 'T7_CAPEITEM_FW_MARTLOCK@2', quality: 4, price: 150000 });
    const row = (await plan({ extra: '7:2:4' })).rows.find((r) => r.tier === 7);
    expect(row.sale).toMatchObject({ manual: true, dailyVolume: null });
    expect(row.sale.avgPrice).toBe(150000);
    await request(app).post('/api/manual-price').send({ id: 'T7_CAPEITEM_FW_MARTLOCK@2', quality: 4, price: 0 });
    resetCaches();
    expect((await plan({ extra: '7:2:4' })).rows.find((r) => r.tier === 7).sale).toBeNull();
    expect((await request(app).post('/api/manual-price').send({ id: 'DROP TABLE', quality: 1, price: 5 })).status).toBe(400);
    expect((await request(app).post('/api/manual-price').send({ id: 'T4_RUNE', quality: 9, price: 5 })).status).toBe(400);
    expect((await request(app).post('/api/manual-price').send({ id: 'T4_RUNE', quality: 1, price: -1 })).status).toBe(400);
  });
});
