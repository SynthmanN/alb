// Скан рефайна читает кувшин: тесты засеивают его известными числами. Своя модель — без «доли рынка»: партия и минимум дней.
import { createRequire } from 'node:module';
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

process.env.JUG_DB_PATH = ':memory:';
process.env.DISABLE_RATE_LIMIT = 'true';
process.env.DISABLE_JUG_CRAWLER = 'true';
const require = createRequire(import.meta.url);
const { app, jugDb, resetCaches, batchAdjustedDailyProfit } = require('../server.js');
const { upsertPriceSnapshots, upsertHistoryBatch } = require('../lib/jugStore.js');

const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString().slice(0, 19);
const CITY = 'Martlock';
const QUERY = { cities: CITY, days: 7, minDaily: 1, quantity: 1000, minDays: 1 };
const days = (n = 6) => Array.from({ length: n }, (_, i) => `${iso(NOW - (i + 1) * 86400000).slice(0, 10)}T00:00:00`);

function seed(id, { price, buyOrder = 0, perDay, avg = price, city = CITY }) {
  upsertPriceSnapshots(jugDb, [{ item_id: id, city, quality: 1, sell_price_min: price, sell_price_min_date: iso(NOW - 5 * 60000), buy_price_max: buyOrder || null, buy_price_max_date: iso(NOW - 5 * 60000) }], NOW);
  upsertHistoryBatch(jugDb, [{ item_id: id, location: city, quality: 1, data: days().map((ts) => ({ timestamp: ts, item_count: perDay, avg_price: avg })) }], NOW);
}
const scan = async (extra = {}) => (await request(app).get('/api/refine-scan').query({ ...QUERY, ...extra })).body;

beforeEach(() => {
  jugDb.exec('DELETE FROM prices');
  jugDb.exec('DELETE FROM history');
  resetCaches();
});

describe('batchAdjustedDailyProfit: профит в день с потолком по минимуму дней', () => {
  it('быстрая партия (рынок съедает её за 0.003 дня) считается за минимум дней — фантастика срезается', () => {
    const r = batchAdjustedDailyProfit({ profitPerUnit: 50, quantity: 1000, cycleDays: 0.003, minDays: 1 });
    expect(r).toEqual({ batchProfit: 50000, effectiveDays: 1, dailyProfit: 50000 });
  });
  it('долгий цикл дольше минимума считается как есть', () => {
    const r = batchAdjustedDailyProfit({ profitPerUnit: 50, quantity: 1000, cycleDays: 10, minDays: 1 });
    expect(r.dailyProfit).toBe(5000);
    expect(r.effectiveDays).toBe(10);
  });
});

describe('GET /api/refine-scan', () => {
  it('пустой кувшин — пустой список, а не ошибка', async () => {
    const res = await request(app).get('/api/refine-scan').query(QUERY);
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  it('нет «доли рынка»: параметр marketShare не влияет на результат; в ответе партия и минимум дней', async () => {
    seed('T2_ORE', { price: 10, perDay: 50000 });
    seed('T2_METALBAR', { price: 40, buyOrder: 38, perDay: 50000, avg: 40 });
    const a = await scan({ mode: 'patient', marketShare: 0.1 });
    const b = await scan({ mode: 'patient', marketShare: 1 });
    expect(a.results[0].dailyProfit).toBe(b.results[0].dailyProfit);
    expect(a).toMatchObject({ quantity: 1000, minDays: 1, mode: 'patient' });
    expect(a.results[0]).not.toHaveProperty('yourDailyVolume');
  });

  it('гигантский оборот дешёвого сырья: профит в день = профит с партии за минимум дней, а не «профит × 25% от 350 000 штук»', async () => {
    seed('T2_ORE', { price: 10, perDay: 350_000 });
    seed('T2_METALBAR', { price: 40, buyOrder: 38, perDay: 350_000, avg: 40 });
    const row = (await scan({ mode: 'patient' })).results.find((r) => r.itemId === 'T2_METALBAR');
    expect(row.profitPerUnit).toBeCloseTo(40 * (1 - 0.08 - 0.025) - 10, 6);
    expect(row.batchProfit).toBeCloseTo(row.profitPerUnit * 1000, 6);
    expect(row.cappedByMinDays).toBe(true);
    expect(row.effectiveDays).toBe(1);
    expect(row.dailyProfit).toBeCloseTo(row.batchProfit, 6);                        // 1 день
    const slower = (await scan({ mode: 'patient', minDays: 4 })).results[0];
    expect(slower.dailyProfit).toBeCloseTo(row.batchProfit / 4, 6);                 // потолок по дням настраивается
  });

  it('терпеливый режим: себестоимость сырья — по СРЕДНЕЙ цене сделок, а не по мгновенной (регрессия из переноса)', async () => {
    seed('T2_ORE', { price: 5, avg: 10, perDay: 500 });                              // мгновенно 5, в среднем 10
    seed('T2_METALBAR', { price: 40, buyOrder: 38, perDay: 500, avg: 40 });
    const patient = (await scan({ mode: 'patient' })).results.find((r) => r.itemId === 'T2_METALBAR');
    expect(patient.cost).toBeCloseTo(10, 6);
    const instant = (await scan({ mode: 'instant' })).results.find((r) => r.itemId === 'T2_METALBAR');
    expect(instant.cost).toBeCloseTo(5, 6);
    expect(instant.avgSellPrice).toBe(38);                                          // мгновенно — в Buy Order
    expect(instant.profitPerUnit).toBeCloseTo(38 * 0.92 - 5, 6);
  });

  it('дни цикла = закупка + продажа партии по полному обороту; материал без оборота — строки нет', async () => {
    seed('T2_ORE', { price: 10, perDay: 6000 });                                     // 6000·6/7 в день
    seed('T2_METALBAR', { price: 40, perDay: 3000, avg: 40 });
    const row = (await scan({ mode: 'patient', quantity: 10000, minDays: 0.1 })).results.find((r) => r.itemId === 'T2_METALBAR');
    expect(row.daysToSell).toBeCloseTo(10000 / (3000 * 6 / 7), 6);
    expect(row.daysToAcquire).toBeCloseTo(10000 / (6000 * 6 / 7), 6);
    expect(row.cycleDays).toBeCloseTo(row.daysToSell + row.daysToAcquire, 6);
    jugDb.exec("DELETE FROM history WHERE item_id = 'T2_ORE'");
    resetCaches();
    expect((await scan({ mode: 'patient' })).results.find((r) => r.itemId === 'T2_METALBAR')).toBeUndefined();
  });

  it('возврат по городу: с бонусом города материал дешевле; ★ бонус там, где город закупки бонусный для типа', async () => {
    seed('T4_ORE', { price: 100, avg: 100, perDay: 500, city: 'Thetford' });         // Thetford — город руды
    seed('T3_METALBAR', { price: 100, avg: 100, perDay: 500, city: 'Thetford' });
    seed('T4_METALBAR', { price: 900, buyOrder: 850, perDay: 500, avg: 900, city: 'Thetford' });
    const without = (await scan({ mode: 'patient', cities: 'Thetford', royalBonus: 'false', focus: 'false' })).results.find((r) => r.itemId === 'T4_METALBAR');
    const withBonus = (await scan({ mode: 'patient', cities: 'Thetford', royalBonus: 'true', focus: 'false' })).results.find((r) => r.itemId === 'T4_METALBAR');
    expect(without.cost).toBeCloseTo(2 * 100 + 1 * 100, 6);                          // T4: 2 сырья + 1 материал T3, без возврата
    expect(withBonus.cost).toBeCloseTo(300 / 1.58, 6);                               // 36.7% в бонусном городе
    expect(withBonus.cityBonus).toBe(true);
    expect(without.cityBonus).toBe(false);
  });

  it('убыточная переработка не показывается; шумный город и выбросы истории не создают профит', async () => {
    seed('T2_ORE', { price: 100, perDay: 500 });
    seed('T2_METALBAR', { price: 90, perDay: 500, avg: 90 });                        // продаём дешевле, чем стоит сырьё
    expect((await scan({ mode: 'patient' })).results).toEqual([]);
  });

  it('индекс доверия и свежесть есть в каждой строке', async () => {
    seed('T2_ORE', { price: 10, perDay: 500 });
    seed('T2_METALBAR', { price: 40, perDay: 500, avg: 40 });
    const row = (await scan({ mode: 'patient' })).results[0];
    expect(row.tradeHours).toBe(6);
    expect(row.confidence).toBeCloseTo(6 / 26, 9);
    expect(row.freshMinutes).toBeLessThan(10);
  });
});
