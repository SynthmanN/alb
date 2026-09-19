// Хранилище «кувшина»: локальная база (встроенный node:sqlite) с ценами и историей сделок AODP, которую фоном наполняет краулер.
// На каждой строке — fetched_at (когда данные получены), чтобы свежесть была честной, а не «на глаз».
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS prices (
  query_id TEXT NOT NULL,
  city TEXT NOT NULL,
  quality INTEGER NOT NULL,
  sell_price_min INTEGER,
  sell_price_min_date TEXT,
  buy_price_max INTEGER,
  buy_price_max_date TEXT,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (query_id, city, quality)
);
CREATE TABLE IF NOT EXISTS history (
  item_id TEXT NOT NULL,
  location TEXT NOT NULL,
  quality INTEGER NOT NULL,
  ts TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  avg_price INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (item_id, location, quality, ts)
);
CREATE INDEX IF NOT EXISTS history_item ON history (item_id, quality);
CREATE TABLE IF NOT EXISTS crawl_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

function openJug(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(SCHEMA);
  return db;
}

// Массовая запись — ВСЕГДА в одной явной транзакции: без неё каждая строка становится отдельной транзакцией с fsync,
// и 5000 строк на диске вместо 13 мс занимают ~15 секунд (одноядерный VPS уходит в 100% I/O wait).
function inTransaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const nullIfEmpty = (v) => (v === undefined || v === null || v === 0 ? null : v);
const nullIfEpoch = (d) => (!d || String(d).startsWith('0001') ? null : d);

// records — ответ /stats/prices: [{ item_id, city, quality, sell_price_min, sell_price_min_date, buy_price_max, buy_price_max_date }]
function upsertPriceSnapshots(db, records, fetchedAt = Date.now()) {
  const stmt = db.prepare(`INSERT INTO prices (query_id, city, quality, sell_price_min, sell_price_min_date, buy_price_max, buy_price_max_date, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (query_id, city, quality) DO UPDATE SET sell_price_min = excluded.sell_price_min, sell_price_min_date = excluded.sell_price_min_date,
      buy_price_max = excluded.buy_price_max, buy_price_max_date = excluded.buy_price_max_date, fetched_at = excluded.fetched_at`);
  return inTransaction(db, () => {
    for (const r of records) {
      stmt.run(r.item_id, r.city, r.quality, nullIfEmpty(r.sell_price_min), nullIfEpoch(r.sell_price_min_date),
        nullIfEmpty(r.buy_price_max), nullIfEpoch(r.buy_price_max_date), fetchedAt);
    }
    return records.length;
  });
}

// seriesList — ответ /stats/history: [{ location, item_id, quality, data: [{ item_count, avg_price, timestamp }] }].
// Весь чанк (все города и качества сразу) пишется одной транзакцией.
function upsertHistoryBatch(db, seriesList, fetchedAt = Date.now()) {
  const stmt = db.prepare(`INSERT INTO history (item_id, location, quality, ts, item_count, avg_price, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (item_id, location, quality, ts) DO UPDATE SET item_count = excluded.item_count, avg_price = excluded.avg_price, fetched_at = excluded.fetched_at`);
  return inTransaction(db, () => {
    let rows = 0;
    for (const s of seriesList) {
      for (const point of s.data || []) {
        stmt.run(s.item_id, s.location, s.quality, point.timestamp, Math.round(point.item_count), Math.round(point.avg_price), fetchedAt);
        rows++;
      }
    }
    return rows;
  });
}

function setMeta(db, key, value) {
  db.prepare('INSERT INTO crawl_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, String(value));
}
function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM crawl_meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

function jugStats(db) {
  const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  const asNumber = (v) => (v === null ? null : Number(v));
  return {
    priceRows: count('prices'),
    historyRows: count('history'),
    lastPricePass: asNumber(getMeta(db, 'lastPricePass')),
    lastHistoryPass: asNumber(getMeta(db, 'lastHistoryPass')),
    lastFullPass: asNumber(getMeta(db, 'lastFullPass')),
  };
}

module.exports = { openJug, inTransaction, upsertPriceSnapshots, upsertHistoryBatch, setMeta, getMeta, jugStats };
