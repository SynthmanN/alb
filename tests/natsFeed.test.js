// Живой поток NATS (lib/natsFeed.js) — только чистая логика (парсинг ордера, сопоставление города, запись в кувшин
// «только если лучше уже известного»); саму сетевую подписку (startNatsFeed) не тестируем — это интеграция с внешним
// сервером, аналогично тому, что живые запросы к AODP через fetch тоже не тестируются напрямую.
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const { applyOrder, orderToPriceRow, applyHistory, historyToSeries, ticksToIso, LOCATION_NAMES } = require('../lib/natsFeed.js');
const { openJug, upsertPriceSnapshots } = require('../lib/jugStore.js');

const order = (over = {}) => ({
  ItemTypeId: 'T4_METALBAR', LocationId: 7, QualityLevel: 1, EnchantmentLevel: 0, UnitPriceSilver: 300, Amount: 1, AuctionType: 'offer', ...over,
});
const catalog = new Set(['T4_METALBAR', 'T4_RUNE', 'T4_CAPE@2']);

describe('orderToPriceRow', () => {
  it('offer → sell_price_min; request → buy_price_max', () => {
    expect(orderToPriceRow(order(), catalog)).toMatchObject({ item_id: 'T4_METALBAR', city: 'Thetford', quality: 1, sell_price_min: 300 });
    expect(orderToPriceRow(order({ AuctionType: 'request', UnitPriceSilver: 250 }), catalog)).toMatchObject({ buy_price_max: 250 });
  });
  it('город не сопоставлен (LocationId вне LOCATION_NAMES) — null, ничего не пишем наугад', () => {
    expect(orderToPriceRow(order({ LocationId: 999999 }), catalog)).toBeNull();
  });
  it('предмета нет в каталоге сайта — null', () => {
    expect(orderToPriceRow(order({ ItemTypeId: 'SOME_JUNK_ITEM' }), catalog)).toBeNull();
  });
  it('цена 0 или отрицательное количество — null (не сигнал о цене)', () => {
    expect(orderToPriceRow(order({ UnitPriceSilver: 0 }), catalog)).toBeNull();
  });
  it('зачарование уже в ItemTypeId (@N), как и у остального сайта', () => {
    expect(orderToPriceRow(order({ ItemTypeId: 'T4_CAPE@2', AuctionType: 'request', UnitPriceSilver: 5000 }), catalog)).toMatchObject({ item_id: 'T4_CAPE@2', buy_price_max: 5000 });
  });
});

describe('LOCATION_NAMES', () => {
  it('все семь городов + Чёрный Рынок — с albionfreemarket.com/pricecheck (город за раз, код читается из URL)', () => {
    expect(LOCATION_NAMES).toEqual({
      3003: 'Black Market', 5003: 'Brecilien', 2004: 'Bridgewatch', 3005: 'Caerleon', 4002: 'Fort Sterling', 1002: 'Lymhurst', 3008: 'Martlock', 7: 'Thetford',
    });
  });
});

describe('applyOrder — пишет в кувшин, только если ордер лучше уже известного', () => {
  it('город пустой — просто пишет цену', () => {
    const db = openJug();
    expect(applyOrder(db, order({ UnitPriceSilver: 300 }), catalog)).toBe(true);
    expect(db.prepare('SELECT * FROM prices').get()).toMatchObject({ query_id: 'T4_METALBAR', city: 'Thetford', sell_price_min: 300 });
  });
  it('новый ордер ДОРОЖЕ уже известной sell_price_min — не трогаем (не сигнал о более выгодной цене)', () => {
    const db = openJug();
    upsertPriceSnapshots(db, [{ item_id: 'T4_METALBAR', city: 'Thetford', quality: 1, sell_price_min: 250, sell_price_min_date: '2026-01-01T10:00:00', buy_price_max: null, buy_price_max_date: null }]);
    expect(applyOrder(db, order({ UnitPriceSilver: 300 }), catalog)).toBe(false);
    expect(db.prepare('SELECT sell_price_min FROM prices').get().sell_price_min).toBe(250);
  });
  it('новый ордер ДЕШЕВЛЕ уже известной sell_price_min — обновляет', () => {
    const db = openJug();
    upsertPriceSnapshots(db, [{ item_id: 'T4_METALBAR', city: 'Thetford', quality: 1, sell_price_min: 300, sell_price_min_date: '2026-01-01T10:00:00', buy_price_max: 200, buy_price_max_date: '2026-01-01T09:00:00' }]);
    expect(applyOrder(db, order({ UnitPriceSilver: 250 }), catalog)).toBe(true);
    const row = db.prepare('SELECT * FROM prices').get();
    expect(row.sell_price_min).toBe(250);
    expect(row.buy_price_max).toBe(200);   // вторая половина строки (buy) сохранилась нетронутой
  });
  it('request дороже уже известной buy_price_max — обновляет; дешевле — не трогает', () => {
    const db = openJug();
    upsertPriceSnapshots(db, [{ item_id: 'T4_METALBAR', city: 'Thetford', quality: 1, sell_price_min: 300, sell_price_min_date: '2026-01-01T10:00:00', buy_price_max: 200, buy_price_max_date: '2026-01-01T09:00:00' }]);
    expect(applyOrder(db, order({ AuctionType: 'request', UnitPriceSilver: 180 }), catalog)).toBe(false);
    expect(applyOrder(db, order({ AuctionType: 'request', UnitPriceSilver: 220 }), catalog)).toBe(true);
    const row = db.prepare('SELECT * FROM prices').get();
    expect(row.buy_price_max).toBe(220);
    expect(row.sell_price_min).toBe(300);   // вторая половина строки (sell) сохранилась нетронутой
  });
});

// История сделок (markethistories.deduped): сообщение снято с живого потока, тики .NET, час = 36e9 тиков.
const TICKS_2026_09_28_12 = 639261936000000000;      // 2026-09-28T12:00:00 UTC
const HOUR = 36000000000;
const NOW = Date.parse('2026-09-28T20:30:00Z');
const hist = (over = {}) => ({
  AlbionId: 666, LocationId: 7, QualityLevel: 2, Timescale: 0, AlbionIdString: 'T4_METALBAR',
  MarketHistories: [
    { ItemAmount: 9, SilverAmount: 631847, Timestamp: TICKS_2026_09_28_12 },
    { ItemAmount: 6, SilverAmount: 415408, Timestamp: TICKS_2026_09_28_12 - 5 * HOUR },
  ], ...over,
});

describe('ticksToIso', () => {
  it('тики .NET → время как у REST, без миллисекунд', () => {
    expect(ticksToIso(TICKS_2026_09_28_12)).toBe('2026-09-28T12:00:00');
    expect(ticksToIso(TICKS_2026_09_28_12 - 5 * HOUR)).toBe('2026-09-28T07:00:00');
  });
});

describe('historyToSeries', () => {
  it('почасовые точки: цена = сумма / штуки с округлением вниз (как у REST), город и id — строками', () => {
    expect(historyToSeries(hist(), catalog)).toEqual({
      item_id: 'T4_METALBAR', location: 'Thetford', quality: 2,
      data: [{ timestamp: '2026-09-28T12:00:00', item_count: 9, avg_price: 70205 }, { timestamp: '2026-09-28T07:00:00', item_count: 6, avg_price: 69234 }],
    });
  });
  it('6-часовые корзины (Timescale 1 и 2) не пишем: удвоили бы оборот рядом с почасовыми точками', () => {
    expect(historyToSeries(hist({ Timescale: 1 }), catalog)).toBeNull();
    expect(historyToSeries(hist({ Timescale: 2 }), catalog)).toBeNull();
  });
  it('чужой город, предмет вне каталога, нет строкового id, пустой ответ — null', () => {
    expect(historyToSeries(hist({ LocationId: 999999 }), catalog)).toBeNull();
    expect(historyToSeries(hist({ AlbionIdString: 'SOME_JUNK' }), catalog)).toBeNull();
    expect(historyToSeries(hist({ AlbionIdString: undefined }), catalog)).toBeNull();
    expect(historyToSeries(hist({ MarketHistories: [] }), catalog)).toBeNull();
    expect(historyToSeries(hist({ QualityLevel: 0 }), catalog)).toBeNull();
  });
  it('точки без сделок или без серебра пропускаются', () => {
    const r = historyToSeries(hist({ MarketHistories: [{ ItemAmount: 0, SilverAmount: 0, Timestamp: TICKS_2026_09_28_12 }, { ItemAmount: 3, SilverAmount: 900, Timestamp: TICKS_2026_09_28_12 - HOUR }] }), catalog);
    expect(r.data).toEqual([{ timestamp: '2026-09-28T11:00:00', item_count: 3, avg_price: 300 }]);
  });
});

describe('applyHistory — пишет почасовые точки в кувшин', () => {
  const rows = (db) => db.prepare('SELECT ts, item_count, avg_price FROM history ORDER BY ts').all();
  it('пишет новые часы', () => {
    const db = openJug();
    expect(applyHistory(db, hist(), catalog, NOW)).toBe(2);
    expect(rows(db)).toEqual([{ ts: '2026-09-28T07:00:00', item_count: 6, avg_price: 69234 }, { ts: '2026-09-28T12:00:00', item_count: 9, avg_price: 70205 }]);
  });
  it('уже известный час не затирается меньшим числом сделок, но обновляется равным или большим', () => {
    const db = openJug();
    applyHistory(db, hist(), catalog, NOW);
    const older = hist({ MarketHistories: [{ ItemAmount: 4, SilverAmount: 100, Timestamp: TICKS_2026_09_28_12 }] });
    expect(applyHistory(db, older, catalog, NOW)).toBe(0);
    expect(rows(db).find((r) => r.ts === '2026-09-28T12:00:00')).toMatchObject({ item_count: 9, avg_price: 70205 });
    const fuller = hist({ MarketHistories: [{ ItemAmount: 12, SilverAmount: 840104, Timestamp: TICKS_2026_09_28_12 }] });
    expect(applyHistory(db, fuller, catalog, NOW)).toBe(1);
    expect(rows(db).find((r) => r.ts === '2026-09-28T12:00:00')).toMatchObject({ item_count: 12, avg_price: 70008 });
  });
  it('точки старше окна истории (10 дней) не пишутся', () => {
    const db = openJug();
    const old = hist({ MarketHistories: [{ ItemAmount: 5, SilverAmount: 500, Timestamp: TICKS_2026_09_28_12 - 300 * HOUR }] });
    expect(applyHistory(db, old, catalog, NOW)).toBe(0);
    expect(rows(db)).toEqual([]);
  });
  it('не относящееся к каталогу — ничего не пишет', () => {
    const db = openJug();
    expect(applyHistory(db, hist({ AlbionIdString: 'SOME_JUNK' }), catalog, NOW)).toBe(0);
  });
});
