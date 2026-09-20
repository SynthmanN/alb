import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const { openJug, inTransaction, upsertPriceSnapshots, upsertHistoryBatch, pruneToCatalog, setMeta, getMeta, jugStats } = require('../lib/jugStore.js');

const price = (over = {}) => ({
  item_id: 'T4_MAIN_SWORD', city: 'Lymhurst', quality: 1, sell_price_min: 1000, sell_price_min_date: '2026-01-01T10:00:00',
  buy_price_max: 800, buy_price_max_date: '2026-01-01T09:00:00', ...over,
});

describe('кувшин: хранилище', () => {
  it('цены: запись, повторная запись обновляет строку, а не дублирует', () => {
    const db = openJug();
    upsertPriceSnapshots(db, [price(), price({ city: 'Martlock' })], 1000);
    upsertPriceSnapshots(db, [price({ sell_price_min: 900 })], 2000);
    const rows = db.prepare('SELECT * FROM prices ORDER BY city').all();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ city: 'Lymhurst', sell_price_min: 900, fetched_at: 2000 });
    expect(rows[1].fetched_at).toBe(1000);
  });

  it('пустые цены и «нулевые» даты AODP хранятся как NULL, а не как цена 0 или год 0001', () => {
    const db = openJug();
    upsertPriceSnapshots(db, [price({ sell_price_min: 0, sell_price_min_date: '0001-01-01T00:00:00', buy_price_max: 0, buy_price_max_date: '0001-01-01T00:00:00' })]);
    expect(db.prepare('SELECT * FROM prices').get()).toMatchObject({ sell_price_min: null, sell_price_min_date: null, buy_price_max: null, buy_price_max_date: null });
  });

  it('история: точки по городам и качествам, повтор обновляет точку', () => {
    const db = openJug();
    const series = (count) => [{ location: 'Lymhurst', item_id: 'T4_MAIN_SWORD', quality: 1, data: [{ timestamp: '2026-01-01T00:00:00', item_count: count, avg_price: 1000 }, { timestamp: '2026-01-02T00:00:00', item_count: 5, avg_price: 1100 }] }];
    expect(upsertHistoryBatch(db, series(3), 1)).toBe(2);
    upsertHistoryBatch(db, series(7), 2);
    const rows = db.prepare('SELECT * FROM history ORDER BY ts').all();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ item_count: 7, fetched_at: 2 });
  });

  it('время получения берётся с записи (_fetchedAt — момент реального похода в AODP), а не «сейчас»; запасной вариант — аргумент', () => {
    const db = openJug();
    upsertPriceSnapshots(db, [price({ _fetchedAt: 111 }), price({ city: 'Martlock' })], 999);
    const rows = db.prepare('SELECT city, fetched_at FROM prices ORDER BY city').all();
    expect(rows.find((r) => r.city === 'Lymhurst').fetched_at).toBe(111);
    expect(rows.find((r) => r.city === 'Martlock').fetched_at).toBe(999);
    upsertHistoryBatch(db, [{ location: 'Lymhurst', item_id: 'X', quality: 1, _fetchedAt: 222, data: [{ timestamp: '2026-01-01T00:00:00', item_count: 1, avg_price: 10 }] }], 999);
    expect(db.prepare('SELECT fetched_at FROM history').get().fetched_at).toBe(222);
  });

  it('pruneToCatalog удаляет строки предметов вне каталога и не трогает остальные', () => {
    const db = openJug();
    upsertPriceSnapshots(db, [price({ item_id: 'T4_A' }), price({ item_id: 'T2_A@1' }), price({ item_id: 'T2_A@2' })]);
    upsertHistoryBatch(db, [{ location: 'Lymhurst', item_id: 'T2_A@1', quality: 1, data: [{ timestamp: '2026-01-01T00:00:00', item_count: 1, avg_price: 10 }] }]);
    expect(pruneToCatalog(db, ['T4_A'])).toEqual({ prices: 2, history: 1 });
    expect(db.prepare('SELECT query_id FROM prices').all().map((r) => r.query_id)).toEqual(['T4_A']);
    expect(jugStats(db).historyRows).toBe(0);
  });

  it('транзакция откатывается целиком при ошибке', () => {
    const db = openJug();
    expect(() => inTransaction(db, () => {
      upsertPriceSnapshots(db, [price()]);        // вложенный BEGIN упадёт — внешняя транзакция откатится
    })).toThrow();
    expect(jugStats(db).priceRows).toBe(0);
  });

  it('мета и статистика: числа читаются как числа, пустое — null', () => {
    const db = openJug();
    expect(jugStats(db)).toEqual({ priceRows: 0, historyRows: 0, lastPricePass: null, lastHistoryPass: null, lastFullPass: null });
    setMeta(db, 'lastPricePass', 12345);
    setMeta(db, 'lastPricePass', 12346);
    expect(getMeta(db, 'lastPricePass')).toBe('12346');
    expect(jugStats(db).lastPricePass).toBe(12346);
  });

  it('база в файле переживает переоткрытие; массовая запись в транзакции быстрая', () => {
    const file = path.join(os.tmpdir(), `jug-test-${process.pid}.db`);
    for (const ext of ['', '-wal', '-shm']) fs.rmSync(file + ext, { force: true });
    try {
      const db = openJug(file);
      const records = Array.from({ length: 5000 }, (_, i) => price({ item_id: `T4_ITEM_${i}` }));
      const started = Date.now();
      upsertPriceSnapshots(db, records);
      expect(Date.now() - started).toBeLessThan(3000);      // без транзакции это ~15 секунд
      db.close();
      expect(jugStats(openJug(file)).priceRows).toBe(5000);
    } finally {
      for (const ext of ['', '-wal', '-shm']) fs.rmSync(file + ext, { force: true });
    }
  });
});

describe('кувшин: вписанные цены (общие, недостоверные, живут 10 дней)', () => {
  const { openJug, setManualPrice, getManualPrices, MANUAL_PRICE_TTL_MS } = require('../lib/jugStore.js');
  it('запись, чтение по id, обновление, удаление нулём; старше 10 дней — исчезает', () => {
    const db = openJug();
    const now = 1_000_000_000_000;
    setManualPrice(db, 'T7_CAPEITEM_FW_LYMHURST_BP', 1, 30000, now);
    setManualPrice(db, 'T1_FACTION_FOREST_TOKEN_1', 1, 12000.4, now - 1000);
    expect(getManualPrices(db, ['T7_CAPEITEM_FW_LYMHURST_BP', 'T1_FACTION_FOREST_TOKEN_1', 'X'], now)).toEqual({
      'T7_CAPEITEM_FW_LYMHURST_BP|1': { price: 30000, enteredAt: now }, 'T1_FACTION_FOREST_TOKEN_1|1': { price: 12000, enteredAt: now - 1000 },
    });
    setManualPrice(db, 'T7_CAPEITEM_FW_LYMHURST_BP', 1, 31000, now + 5);
    expect(getManualPrices(db, ['T7_CAPEITEM_FW_LYMHURST_BP'], now + 5)['T7_CAPEITEM_FW_LYMHURST_BP|1'].price).toBe(31000);
    setManualPrice(db, 'T7_CAPEITEM_FW_LYMHURST_BP', 1, 0, now + 6);
    expect(getManualPrices(db, ['T7_CAPEITEM_FW_LYMHURST_BP'], now + 6)).toEqual({});
    expect(getManualPrices(db, ['T1_FACTION_FOREST_TOKEN_1'], now + MANUAL_PRICE_TTL_MS + 10)).toEqual({});   // прошло 10 дней
  });
});
