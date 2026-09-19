import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const { openJug, inTransaction, upsertPriceSnapshots, upsertHistoryBatch, setMeta, getMeta, jugStats } = require('../lib/jugStore.js');

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
