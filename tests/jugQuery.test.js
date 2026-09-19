import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const { openJug, upsertPriceSnapshots, upsertHistoryBatch, setMeta } = require('../lib/jugStore.js');
const { readPrices, readHistory, jugFreshness } = require('../lib/jugQuery.js');

const NOW = Date.parse('2026-08-10T12:00:00Z');
const price = (over = {}) => ({
  item_id: 'T4_MAIN_SWORD', city: 'Fort Sterling', quality: 1, sell_price_min: 1000, sell_price_min_date: '2026-08-10T11:00:00',
  buy_price_max: 800, buy_price_max_date: '2026-08-10T10:00:00', ...over,
});
const series = (over = {}) => ({
  location: 'Fort Sterling', item_id: 'T4_MAIN_SWORD', quality: 1,
  data: [
    { timestamp: '2026-08-03T00:00:00', item_count: 5, avg_price: 900 },
    { timestamp: '2026-08-09T00:00:00', item_count: 7, avg_price: 1000 },
    { timestamp: '2026-08-10T00:00:00', item_count: 3, avg_price: 1100 },
  ], ...over,
});

describe('кувшин: чтение в формате живого AODP', () => {
  it('цены: те же поля, что у AODP; пустая цена = 0, пустая дата = 0001-01-01; время получения — _fetchedAt', () => {
    const db = openJug();
    upsertPriceSnapshots(db, [price({ _fetchedAt: 555 }), price({ city: 'Martlock', sell_price_min: 0, sell_price_min_date: '0001-01-01T00:00:00', buy_price_max: 0, buy_price_max_date: '0001-01-01T00:00:00' })], 1);
    const rows = readPrices(db, ['T4_MAIN_SWORD']);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.city === 'Fort Sterling')).toMatchObject({ item_id: 'T4_MAIN_SWORD', quality: 1, sell_price_min: 1000, buy_price_max: 800, _fetchedAt: 555 });
    expect(rows.find((r) => r.city === 'Martlock')).toMatchObject({ sell_price_min: 0, sell_price_min_date: '0001-01-01T00:00:00', buy_price_max: 0 });
  });

  it('цены: фильтр по городам (с пробелом и без), качествам и списку id', () => {
    const db = openJug();
    upsertPriceSnapshots(db, [price(), price({ city: 'Martlock' }), price({ quality: 2 }), price({ item_id: 'T5_MAIN_SWORD' })]);
    expect(readPrices(db, ['T4_MAIN_SWORD'], { cities: ['FortSterling'], qualities: [1] })).toHaveLength(1);
    expect(readPrices(db, ['T4_MAIN_SWORD'], { cities: ['Fort Sterling', 'Martlock'] })).toHaveLength(3);
    expect(readPrices(db, ['NOPE'])).toEqual([]);
  });

  it('история: ряды по городу и качеству; окно отрезает старые точки, короткие окна берутся из тех же данных', () => {
    const db = openJug();
    upsertHistoryBatch(db, [series(), series({ location: 'Martlock' }), series({ quality: 2 })], 1);
    const week = readHistory(db, ['T4_MAIN_SWORD'], 8 * 24, { now: NOW });
    expect(week).toHaveLength(3);
    expect(week.find((s) => s.location === 'Fort Sterling' && s.quality === 1).data.map((p) => p.item_count)).toEqual([5, 7, 3]);
    const day = readHistory(db, ['T4_MAIN_SWORD'], 48, { now: NOW });
    expect(day[0].data.map((p) => p.timestamp)).toEqual(['2026-08-09T00:00:00', '2026-08-10T00:00:00']);
    expect(readHistory(db, ['T4_MAIN_SWORD'], 1, { now: NOW })).toEqual([]);   // за последний час точек нет
  });

  it('история: фильтры по городам и качествам; формат подходит для cityStats как у живого AODP', () => {
    const db = openJug();
    upsertHistoryBatch(db, [series(), series({ location: 'Martlock' }), series({ quality: 2 })], 1);
    const only = readHistory(db, ['T4_MAIN_SWORD'], 8 * 24, { now: NOW, locations: ['FortSterling'], qualities: [1] });
    expect(only).toHaveLength(1);
    expect(only[0]).toMatchObject({ location: 'Fort Sterling', item_id: 'T4_MAIN_SWORD', quality: 1 });
    expect(only[0].data[0]).toEqual({ item_count: 5, avg_price: 900, timestamp: '2026-08-03T00:00:00' });
  });

  it('свежесть ряда истории — по самой старой точке', () => {
    const db = openJug();
    upsertHistoryBatch(db, [series({ _fetchedAt: 100 })], 1);
    upsertHistoryBatch(db, [series({ data: [{ timestamp: '2026-08-10T00:00:00', item_count: 4, avg_price: 1100 }], _fetchedAt: 900 })], 1);
    expect(readHistory(db, ['T4_MAIN_SWORD'], 8 * 24, { now: NOW })[0]._fetchedAt).toBe(100);
  });

  it('свежесть кувшина: метки проходов и возраст самой старой цены', () => {
    const db = openJug();
    expect(jugFreshness(db, NOW)).toEqual({ lastPricePass: null, lastHistoryPass: null, lastFullPass: null, oldestPriceAgeMinutes: null });
    upsertPriceSnapshots(db, [price({ _fetchedAt: NOW - 10 * 60000 }), price({ city: 'Martlock', _fetchedAt: NOW - 3 * 60000 })]);
    setMeta(db, 'lastPricePass', NOW - 1000);
    expect(jugFreshness(db, NOW)).toMatchObject({ lastPricePass: NOW - 1000, oldestPriceAgeMinutes: 10 });
  });
});
