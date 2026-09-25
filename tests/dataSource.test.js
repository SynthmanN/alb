// Источник данных калькуляторов: по умолчанию краулер (кувшин) — без походов в AODP; ?source=aodp — живой запрос.
import { createRequire } from 'node:module';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

process.env.JUG_DB_PATH = ':memory:';
process.env.DISABLE_RATE_LIMIT = 'true';
process.env.DISABLE_JUG_CRAWLER = 'true';
process.env.AODP_RATE_PER_MINUTE = '1000000';
const require = createRequire(import.meta.url);
const { app, jugDb, resetCaches } = require('../server.js');
const { upsertPriceSnapshots, upsertHistoryBatch } = require('../lib/jugStore.js');

const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString().slice(0, 19);
const CITY = 'Martlock';
const ITEM = 'T4_CAPE';                        // рецепт: T4_CLOTH? — сырьё берём из рецепта, чтобы не гадать
const URL = `/api/craft-calc?item=${ITEM}&quantity=1&cities=${CITY}&gearRrr=none&enchant=0&days=3`;

function seedPrice(id, quality, sell, buy = 0) {
  upsertPriceSnapshots(jugDb, [{ item_id: id, city: CITY, quality, sell_price_min: sell, sell_price_min_date: iso(NOW - 5 * 60000), buy_price_max: buy, buy_price_max_date: iso(NOW - 5 * 60000) }], NOW);
}
function seedSales(id, quality, avg, count) {
  upsertHistoryBatch(jugDb, [{ item_id: id, location: CITY, quality, data: [1, 2].map((h) => ({ timestamp: iso(NOW - h * 3600000), item_count: count, avg_price: avg })) }], NOW);
}
// Живой AODP: цена готового плаща 9999 (заметно отличается от кувшина), история пуста
const aodpCalls = [];
function fakeAodp(url) {
  aodpCalls.push(String(url));
  if (String(url).includes('/history/')) return [];
  const ids = decodeURIComponent(String(url).split('?')[0].split('/').pop()).split(',');
  const loc = (String(url).match(/locations=([^&]+)/) || [])[1] || CITY;
  const city = loc.split(',')[0] === 'BlackMarket' ? 'BlackMarket' : CITY;
  return ids.map((id) => ({ item_id: id, city, quality: 1, sell_price_min: 9999, sell_price_min_date: iso(NOW), buy_price_max: 9000, buy_price_max_date: iso(NOW) }));
}

beforeEach(() => {
  aodpCalls.length = 0;
  jugDb.exec('DELETE FROM prices');
  jugDb.exec('DELETE FROM history');
  resetCaches();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (u) => ({ ok: true, status: 200, json: async () => fakeAodp(u) }));
  seedPrice('T4_CAPE', 1, 4321, 4000);         // готовый предмет в кувшине
  seedSales('T4_CAPE', 1, 4200, 30);
});

describe('источник данных калькулятора крафта', () => {
  it('по умолчанию — краулер: цены и история из кувшина, AODP не вызывается; в ответе dataSource=jug и свежесть кувшина', async () => {
    const d = (await request(app).get(URL)).body;
    expect(d.dataSource).toBe('jug');
    expect(d.jug).not.toBeNull();                                              // свежесть кувшина — чтобы показать «данные обновлены N мин назад»
    expect(aodpCalls).toEqual([]);
    const martlock = d.sellPrices.find((p) => p.city === 'Martlock');
    expect(martlock.sellMin).toBe(4321);
    expect(martlock.buyMax).toBe(4000);
    expect(d.patientSell).not.toBeNull();                                      // терпеливая продажа — по истории из кувшина
  });
  it('source=aodp — живой запрос: цена из AODP, кувшин по готовому предмету не читается; в ответе dataSource=aodp', async () => {
    const d = (await request(app).get(`${URL}&source=aodp`)).body;
    expect(d.dataSource).toBe('aodp');
    expect(d.jug).toBeNull();
    expect(aodpCalls.length).toBeGreaterThan(0);
    expect(d.sellPrices.find((p) => p.city === 'Martlock').sellMin).toBe(9999);
  });
  it('неизвестное значение source — умолчание сервера (краулер)', async () => {
    const d = (await request(app).get(`${URL}&source=whatever`)).body;
    expect(d.dataSource).toBe('jug');
    expect(aodpCalls).toEqual([]);
  });
  it('Чёрный Рынок краулер не собирает: в режиме краулера ЧР идёт живым запросом только за ним, города — из кувшина', async () => {
    const d = (await request(app).get(`${URL}&blackMarket=true`)).body;
    expect(d.dataSource).toBe('jug');
    expect(aodpCalls.length).toBeGreaterThan(0);
    expect(aodpCalls.every((u) => u.includes('BlackMarket') && !u.includes('Caerleon'))).toBe(true);
    expect(d.sellPrices.find((p) => p.city === 'Martlock').sellMin).toBe(4321);
  });
});

describe('источник данных остальных калькуляторов', () => {
  it('ленивый крафтер и план партии: источник в ответе, по умолчанию AODP не вызывается', async () => {
    const lazy = await request(app).get(`/api/lazy-crafter?budget=1000000&cities=${CITY}&gearRrr=none&category=cape`);
    expect(lazy.body.dataSource).toBe('jug');
    const bulk = await request(app).get(`/api/craft-bulk-plan?item=${ITEM}&quantity=5&cities=${CITY}&gearRrr=none&days=3`);
    expect(bulk.body.dataSource).toBe('jug');
    expect(aodpCalls.filter((u) => u.includes('/history/') || u.includes('/prices/'))).toEqual([]);
    const live = await request(app).get(`/api/craft-bulk-plan?item=${ITEM}&quantity=5&cities=${CITY}&gearRrr=none&days=3&source=aodp`);
    expect(live.body.dataSource).toBe('aodp');
    expect(aodpCalls.length).toBeGreaterThan(0);
  });
  it('примерочная берёт цены из кувшина по умолчанию и из AODP по запросу', async () => {
    const q = '/api/fitting-room?cities=Martlock&weapon=MAIN_SWORD&offhand=OFF_SHIELD&head=HEAD_PLATE_SET1&chest=ARMOR_PLATE_SET1&shoes=SHOES_PLATE_SET1&cape=CAPE&targetIP=900&tolMinus=30&tolPlus=100&variants=5';
    for (const tier of [4, 5, 6, 7, 8]) for (const fam of ['MAIN_SWORD', 'OFF_SHIELD', 'HEAD_PLATE_SET1', 'ARMOR_PLATE_SET1', 'SHOES_PLATE_SET1', 'CAPE']) for (const e of ['', '@1', '@2', '@3']) for (const qu of [1, 2, 3, 4, 5]) seedPrice(`T${tier}_${fam}${e}`, qu, 1000 * tier);
    const jug = await request(app).get(q);
    expect(jug.body.dataSource).toBe('jug');
    expect(aodpCalls).toEqual([]);
    const live = await request(app).get(`${q}&source=aodp`);
    expect(live.body.dataSource).toBe('aodp');
    expect(aodpCalls.length).toBeGreaterThan(0);
  });
});

describe('запасная цена ордера в терпеливой продаже (города без сделок)', () => {
  const U = `${URL}&quality=4`;
  const CITY2 = 'Lymhurst';
  function seedOrder(city, quality, sell, ageMs = 5 * 60000) {
    upsertPriceSnapshots(jugDb, [{ item_id: 'T4_CAPE', city, quality, sell_price_min: sell, sell_price_min_date: iso(NOW - ageMs), buy_price_max: 0, buy_price_max_date: iso(NOW - ageMs) }], NOW);
  }
  beforeEach(() => { jugDb.exec('DELETE FROM history'); });

  it('сделок нигде нет, но есть свежий ордер — patientSell не null: цена лучшего города, оборот неизвестен (orderOnly), в автоплан не входит', async () => {
    seedOrder(CITY, 4, 6000);
    const d = (await request(app).get(U)).body;
    expect(d.patientSell).not.toBeNull();
    expect(d.patientSell.orderOnly).toBe(true);
    expect(d.patientSell.avgSellPrice).toBe(6000);
    expect(d.patientSell.avgDailyVolume).toBe(0);
    expect(d.patientSell.daysToSellBatch).toBeNull();
    expect(d.patientSell.byCity.find((c) => c.city === CITY)).toMatchObject({ orderOnly: true, avgSellPrice: 6000, avgDailyVolume: 0 });
    expect(d.patientSell.plan.cities).toEqual([]);
  });
  it('старый ордер (старше окна «История гира», days=3) не считается — как и раньше «нет данных»', async () => {
    seedOrder(CITY, 4, 6000, 4 * 86400000);
    const d = (await request(app).get(U)).body;
    expect(d.patientSell).toBeNull();
  });
  it('ордер другого качества не подставляется', async () => {
    seedOrder(CITY, 3, 6000);
    const d = (await request(app).get(U)).body;
    expect(d.patientSell).toBeNull();
  });
  it('есть сделки в одном городе, в другом только ордер — заголовок и план по сделкам, город с ордером виден с ценой и без оборота', async () => {
    seedSales('T4_CAPE', 4, 5000, 30);
    seedOrder(CITY2, 4, 9000);
    const d = (await request(app).get(`${U.replace(`cities=${CITY}`, `cities=${CITY},${CITY2}`)}`)).body;
    expect(d.patientSell.orderOnly).toBe(false);
    expect(d.patientSell.avgSellPrice).toBe(5000);                              // заголовок — по сделкам, дорогой ордер его не портит
    expect(d.patientSell.byCity.find((c) => c.city === CITY2)).toMatchObject({ orderOnly: true, avgSellPrice: 9000, avgDailyVolume: 0 });
    expect(d.patientSell.plan.cities.map((c) => c.city)).toEqual([CITY]);
  });
});

describe('строгие материалы по окну (экспериментально)', () => {
  it('цена материала старше окна «История сырья» и без сделок: по умолчанию годится, со strictMaterials=true — материал в рецепте «нет цены»', async () => {
    const recipe = (await request(app).get(URL)).body.recipe;
    const mat = recipe[0].queryId;
    upsertPriceSnapshots(jugDb, [{ item_id: mat, city: CITY, quality: 1, sell_price_min: 100, sell_price_min_date: iso(NOW - 3 * 86400000), buy_price_max: 0, buy_price_max_date: iso(NOW - 3 * 86400000) }], NOW);
    resetCaches();
    const loose = (await request(app).get(`${URL}&materialHours=24`)).body;
    expect(loose.recipe[0].cheapestPrice).toBeCloseTo(102.5, 6);
    resetCaches();
    const strict = (await request(app).get(`${URL}&materialHours=24&strictMaterials=true`)).body;
    expect(strict.recipe[0].cheapestPrice).toBeNull();
  });
});
