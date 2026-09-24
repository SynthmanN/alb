// Живой поток NATS (lib/natsFeed.js) — только чистая логика (парсинг ордера, сопоставление города, запись в кувшин
// «только если лучше уже известного»); саму сетевую подписку (startNatsFeed) не тестируем — это интеграция с внешним
// сервером, аналогично тому, что живые запросы к AODP через fetch тоже не тестируются напрямую.
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const { applyOrder, orderToPriceRow, LOCATION_NAMES } = require('../lib/natsFeed.js');
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
