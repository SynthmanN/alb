// Скан и калькулятор рефайна читают кувшин: тесты засеивают его известными числами.
// Модель: сырьё и полуфабрикат пред. тира — в самых дешёвых ликвидных городах (каждое в своём), переработка — единой ставкой RRR в городе
// с бонусом, продажа — в городе с лучшей чистой ценой; всё своими ордерами (комиссия 2.5% на покупке, налог + 2.5% на продаже); одна штука.
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
const RATE = 1 - 1 / 1.58;              // 36.7% — умолчание
const NET = 1 - 0.08 - 0.025;           // налог 8% + Setup Fee 2.5%
const CITIES = 'Fort Sterling,Lymhurst,Martlock,Thetford,Bridgewatch';

// Цена и сделки за последний час (окно 24 ч): perDay — оборот; city — как в запросе (с пробелом), в истории — без него
function seed(id, city, price, perDay = 5000, avg = price) {
  upsertPriceSnapshots(jugDb, [{ item_id: id, city, quality: 1, sell_price_min: price, sell_price_min_date: iso(NOW - 5 * 60000), buy_price_max: 0, buy_price_max_date: iso(NOW - 5 * 60000) }], NOW);
  if (perDay > 0) upsertHistoryBatch(jugDb, [{ item_id: id, location: city.replace(/\s+/g, ''), quality: 1, data: [{ timestamp: iso(NOW - 2 * 3600000), item_count: perDay, avg_price: avg }] }], NOW);
}
const scan = async (extra = {}) => (await request(app).get('/api/refine-scan').query({ cities: CITIES, minDaily: 1, ...extra })).body;
const calc = async (extra = {}) => (await request(app).get('/api/refining-calc').query({ type: 'ORE', tier: 4, cities: CITIES, ...extra })).body;

beforeEach(() => {
  jugDb.exec('DELETE FROM prices');
  jugDb.exec('DELETE FROM history');
  resetCaches();
  // T4 слиток: 2 × руда T4 + 1 × слиток T3
  seed('T4_ORE', 'Lymhurst', 100);
  seed('T4_ORE', 'Thetford', 110);
  seed('T3_METALBAR', 'Martlock', 150);
  seed('T4_METALBAR', 'Fort Sterling', 500, 300);
  seed('T4_METALBAR', 'Martlock', 480, 500);
});

describe('GET /api/refine-scan', () => {
  it('пустой кувшин — пустой список, а не ошибка', async () => {
    jugDb.exec('DELETE FROM prices');
    jugDb.exec('DELETE FROM history');
    const res = await request(app).get('/api/refine-scan').query({ cities: CITIES });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  it('три разных города: сырьё и пред. тир — в самых дешёвых (каждое в своём), переработка — в городе бонуса, продажа — в городе лучшей чистой цены', async () => {
    const row = (await scan()).results.find((r) => r.itemId === 'T4_METALBAR');
    expect(row).toMatchObject({ rawCity: 'Lymhurst', prevCity: 'Martlock', refineCity: 'Thetford', sellCity: 'Fort Sterling' });
    const nominal = 2 * 100 * FEE + 150 * FEE;                                     // комиссия 2.5% за свой Buy Order на обоих компонентах
    expect(row.cost).toBeCloseTo(nominal * (1 - RATE), 6);                          // одна ставка возврата на переработку
    expect(row.netSell).toBeCloseTo(500 * NET, 6);                                  // налог 8% + Setup Fee 2.5% на продаже
    expect(row.profitPerUnit).toBeCloseTo(500 * NET - nominal * (1 - RATE), 6);
    expect(row.dailyVolume).toBe(300);                                              // оборот продукта в городе продажи
  });

  it('своя ставка возврата: пресет и «своя %» меняют себестоимость; по умолчанию 36.7%', async () => {
    const base = (await scan()).results[0];
    const none = (await scan({ refineRrr: 'none' })).results[0];
    const own = (await scan({ refineRrrCustom: 50 })).results[0];
    expect(none.cost).toBeCloseTo(base.cost / (1 - RATE), 6);
    expect(own.cost).toBeCloseTo((2 * 100 * FEE + 150 * FEE) * 0.5, 6);
    expect((await scan({ refineRrrCustom: 50 })).refineRate).toBe(0.5);
  });

  it('город с почти нулевым оборотом сырья цену закупки не задаёт: дешёвая цена одной случайной сделки игнорируется', async () => {
    seed('T4_ORE', 'Bridgewatch', 20, 1);                                            // 20 — но торгуется 1 шт/день против 5000
    const row = (await scan()).results.find((r) => r.itemId === 'T4_METALBAR');
    expect(row.rawCity).toBe('Lymhurst');
  });

  it('ликвидность продукта: мёртвый полуфабрикат (оборот ниже порога) не попадает в список, даже с огромным профитом', async () => {
    jugDb.exec("DELETE FROM history WHERE item_id = 'T4_METALBAR'");
    jugDb.exec("DELETE FROM prices WHERE query_id = 'T4_METALBAR'");
    seed('T4_METALBAR', 'Fort Sterling', 5000, 2);                                   // 2 шт/день
    expect((await scan({ minDaily: 5 })).results.find((r) => r.itemId === 'T4_METALBAR')).toBeUndefined();
    expect((await scan({ minDaily: 1 })).results.find((r) => r.itemId === 'T4_METALBAR')).toBeDefined();
  });

  it('ранжирование учитывает ликвидность: при равной марже впереди тот, что торгуется быстрее', async () => {
    // T5 слиток: 3 × руда T5 + 1 × слиток T4; ту же цену продажи, но оборот в 100 раз меньше
    seed('T5_ORE', 'Lymhurst', 100);
    seed('T4_METALBAR', 'Martlock', 480, 500);
    seed('T5_METALBAR', 'Fort Sterling', 1500, 3);
    const rows = (await scan()).results;
    const t4 = rows.find((r) => r.itemId === 'T4_METALBAR');
    const t5 = rows.find((r) => r.itemId === 'T5_METALBAR');
    expect(t5).toBeDefined();
    expect(t4.rankScore / t4.profitPct).toBeGreaterThan(t5.rankScore / t5.profitPct);   // множитель log2(2 + оборот)
  });

  it('зачарованные полуфабрикаты — только по галочке (enchanted=true); камень не зачаровывается вообще', async () => {
    seed('T4_ORE_LEVEL1@1', 'Lymhurst', 200);
    seed('T3_METALBAR', 'Martlock', 150);
    seed('T4_METALBAR_LEVEL1@1', 'Fort Sterling', 2000, 200);
    expect((await scan()).results.some((r) => r.enchant > 0)).toBe(false);
    const withEnch = (await scan({ enchanted: 'true' })).results.find((r) => r.enchant === 1);
    expect(withEnch).toMatchObject({ itemId: 'T4_METALBAR_LEVEL1@1', type: 'ORE' });
    expect((await scan({ enchanted: 'true', type: 'ROCK' })).results.some((r) => r.enchant > 0)).toBe(false);
  });

  it('в ответе нет партии, минимума дней и профита в день — только честная единица', async () => {
    const row = (await scan()).results[0];
    for (const k of ['quantity', 'positionCost', 'dailyProfit', 'premiumDays', 'cycleDays']) expect(row).not.toHaveProperty(k);
  });

  it('«Доверие» — слабое звено: продукт торгуется в 1 час, сырьё в 1 час → n = 1', async () => {
    const row = (await scan()).results.find((r) => r.itemId === 'T4_METALBAR');
    expect(row.tradeHours).toBe(1);
    expect(row.confidence).toBeCloseTo(1 / 21, 6);
  });
});

describe('GET /api/refining-calc', () => {
  it('те же цифры, что в скане: компоненты (город, цена с комиссией, ликвидность), себестоимость штуки, продажа по всем городам', async () => {
    const d = await calc();
    expect(d).toMatchObject({ itemId: 'T4_METALBAR', refineCity: 'Thetford', bonusCity: 'Thetford', hours: 24 });
    const raw = d.components.find((c) => c.role === 'raw');
    expect(raw).toMatchObject({ id: 'T4_ORE', count: 2 });
    expect(raw.buy.city).toBe('Lymhurst');
    expect(raw.buy.price).toBeCloseTo(100 * FEE, 6);
    expect(raw.buy.cities.map((c) => c.city)).toEqual(['Lymhurst', 'Thetford']);       // цены по остальным городам — от дешёвых к дорогим
    expect(d.components.find((c) => c.role === 'prev').buy.city).toBe('Martlock');
    expect(d.cost).toBeCloseTo((2 * 100 * FEE + 150 * FEE) * (1 - RATE), 6);
    expect(d.sellByCity.map((c) => c.city)).toEqual(expect.arrayContaining(['Fort Sterling', 'Martlock', 'Lymhurst', 'Thetford', 'Bridgewatch']));
    expect(d.sellByCity.filter((c) => c.noData).map((c) => c.city).sort()).toEqual(['Bridgewatch', 'Lymhurst', 'Thetford']);   // все города видны, где сделок нет — «нет данных»
    expect(d.best.city).toBe('Fort Sterling');
    const scanRow = (await scan()).results.find((r) => r.itemId === 'T4_METALBAR');
    expect(d.cost).toBeCloseTo(scanRow.cost, 9);
    expect(d.best.netSell - d.cost).toBeCloseTo(scanRow.profitPerUnit, 9);
  });

  it('окно истории — своё (часы), ставка — пресет или своя %; неверные тип/тир/зачарование — 400', async () => {
    expect((await calc({ hours: 48 })).hours).toBe(48);
    expect((await calc({ hours: 9999 })).hours).toBe(240);                              // кувшин хранит 10 дней
    expect((await calc({ refineRrrCustom: 20 })).refineRate).toBe(0.2);
    expect((await request(app).get('/api/refining-calc?type=NOPE&tier=4')).status).toBe(400);
    expect((await request(app).get('/api/refining-calc?type=ORE&tier=9')).status).toBe(400);
    expect((await request(app).get('/api/refining-calc?type=ROCK&tier=5&enchant=1')).status).toBe(400);   // камень не зачаровывается
    expect((await request(app).get('/api/refining-calc?type=ORE&tier=3&enchant=1')).status).toBe(400);    // T2–T3 — без зачарования
  });
});
