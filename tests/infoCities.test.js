// Города «только для информации» (infoCities): цены и оборот по ним видны в закупке и продаже, но расчёт (город закупки, план, профит) их не берёт
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
const days = (n = 6) => Array.from({ length: n }, (_, i) => iso(NOW - (i + 1) * 86400000).slice(0, 10) + 'T00:00:00');

function seedMaterial(id, city, price) {
  upsertPriceSnapshots(jugDb, [{ item_id: id, city, quality: 1, sell_price_min: price, sell_price_min_date: iso(NOW - 5 * 60000), buy_price_max: price - 1, buy_price_max_date: iso(NOW - 5 * 60000) }], NOW);
  upsertHistoryBatch(jugDb, [{ item_id: id, location: city, quality: 1, data: [...days().map((ts) => ({ timestamp: ts, item_count: 500, avg_price: price })), { timestamp: iso(NOW - 2 * 3600000), item_count: 500, avg_price: price }] }], NOW);
}
function seedSales(id, city, avg, perDay) {
  upsertHistoryBatch(jugDb, [{ item_id: id, location: city, quality: 1, data: days().map((ts) => ({ timestamp: ts, item_count: perDay, avg_price: avg })) }], NOW);
}
const calc = async (extra = '') => (await request(app).get(`/api/craft-calc?item=T4_MAIN_SWORD&quantity=10&cities=Martlock&gearRrr=none&days=7&quality=1${extra}`)).body;

beforeEach(() => {
  jugDb.exec('DELETE FROM prices');
  jugDb.exec('DELETE FROM history');
  resetCaches();
  for (const id of ['T4_METALBAR', 'T4_LEATHER']) { seedMaterial(id, 'Martlock', 100); seedMaterial(id, 'Caerleon', 60); }     // в Caerleon дешевле
  seedSales('T4_MAIN_SWORD', 'Martlock', 4000, 20);
  seedSales('T4_MAIN_SWORD', 'Caerleon', 5000, 40);                                                                           // и продажа выгоднее
});

describe('infoCities в /api/craft-calc', () => {
  it('без infoCities помеченных строк нет', async () => {
    const d = await calc();
    expect(d.recipe.flatMap((r) => r.cityPrices).some((c) => c.inactive)).toBe(false);
    expect(d.patientSell.byCity.some((c) => c.inactive)).toBe(false);
    expect(d.sellPrices.some((c) => c.inactive)).toBe(false);
  });

  it('закупка: цены города вне расчёта видны, но город закупки и себестоимость прежние', async () => {
    const plain = await calc();
    const info = await calc('&infoCities=Caerleon');
    const metal = info.recipe.find((r) => r.resource === 'T4_METALBAR');
    expect(metal.cityPrices.find((c) => c.city === 'Caerleon')).toMatchObject({ inactive: true, price: 60 });
    expect(metal.cheapestCity).toBe('Martlock');
    expect(info.effectiveCostPerUnit).toBeCloseTo(plain.effectiveCostPerUnit, 9);
    expect(info.totalCost).toBeCloseTo(plain.totalCost, 9);
  });

  it('продажа: город вне расчёта в разбивке по городам, но не в плане, лучшем городе и профите', async () => {
    const plain = await calc();
    const info = await calc('&infoCities=Caerleon');
    const row = info.patientSell.byCity.find((c) => c.city === 'Caerleon');
    expect(row).toMatchObject({ inactive: true, avgSellPrice: 5000 });
    expect(row.avgDailyVolume).toBeGreaterThan(0);
    expect(info.patientSell.plan.cities.map((c) => c.city)).toEqual(['Martlock']);
    expect(info.patientSell.bestCity.city).toBe('Martlock');
    expect(info.patientSell.profitPerUnit).toBeCloseTo(plain.patientSell.profitPerUnit, 9);
    expect(info.patientSell.avgSellPrice).toBeCloseTo(plain.patientSell.avgSellPrice, 9);
  });

  it('мгновенная продажа: цены города вне расчёта в таблице, лучшая цена — среди активных', async () => {
    upsertPriceSnapshots(jugDb, [{ item_id: 'T4_MAIN_SWORD', city: 'Caerleon', quality: 1, sell_price_min: 5200, sell_price_min_date: iso(NOW - 60000), buy_price_max: 5000, buy_price_max_date: iso(NOW - 60000) }], NOW);
    upsertPriceSnapshots(jugDb, [{ item_id: 'T4_MAIN_SWORD', city: 'Martlock', quality: 1, sell_price_min: 4200, sell_price_min_date: iso(NOW - 60000), buy_price_max: 3800, buy_price_max_date: iso(NOW - 60000) }], NOW);
    const info = await calc('&infoCities=Caerleon');
    expect(info.sellPrices.find((c) => c.city === 'Caerleon')).toMatchObject({ inactive: true, buyMax: 5000 });
    expect(info.bestSell.city).toBe('Martlock');
  });

  it('город из cities не дублируется в infoCities', async () => {
    const d = await calc('&infoCities=Martlock,Caerleon');
    expect(d.sellPrices.filter((c) => c.city === 'Martlock')).toHaveLength(1);
    expect(d.sellPrices.find((c) => c.city === 'Martlock').inactive).toBeUndefined();
  });
});
