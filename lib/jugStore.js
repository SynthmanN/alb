// Хранилище «кувшина»: локальная база (встроенный node:sqlite) с ценами и историей сделок AODP, которую фоном наполняет краулер.
// На каждой строке — fetched_at (когда данные получены), чтобы свежесть была честной, а не «на глаз».
const { DatabaseSync } = require('node:sqlite');

// Сколько часов истории хранит кувшин (и сколько запрашивает краулер): 10 дней. Окно скана обычно короче (3 дня); остаток нужен, чтобы
// заполнить «пустые ячейки» (город × комбинация без сделок в окне) — см. unified-scan.
const HISTORY_WINDOW_HOURS = 10 * 24;

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
-- Цены, вписанные пользователем там, где у AODP данных нет (например, герб или сердце): общие для всех, всегда помечаются как недостоверные;
-- применяются, только пока по предмету нет цены AODP, и живут не дольше 10 дней. Не привязаны к городу.
CREATE TABLE IF NOT EXISTS manual_prices (
  query_id TEXT NOT NULL,
  quality INTEGER NOT NULL,
  price INTEGER NOT NULL,
  entered_at INTEGER NOT NULL,
  PRIMARY KEY (query_id, quality)
);
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

// Время получения: если на записи есть _fetchedAt (момент РЕАЛЬНОГО похода в AODP, а не «сейчас», когда ответ отдан из кэша),
// берём его; переданный fetchedAt — только запасной вариант. Иначе кувшин выдавал бы двухминутные данные за только что полученные.
const stampOf = (row, fallback) => (Number.isFinite(row._fetchedAt) ? row._fetchedAt : fallback);

// records — ответ /stats/prices: [{ item_id, city, quality, sell_price_min, sell_price_min_date, buy_price_max, buy_price_max_date }]
function upsertPriceSnapshots(db, records, fetchedAt = Date.now()) {
  const stmt = db.prepare(`INSERT INTO prices (query_id, city, quality, sell_price_min, sell_price_min_date, buy_price_max, buy_price_max_date, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (query_id, city, quality) DO UPDATE SET sell_price_min = excluded.sell_price_min, sell_price_min_date = excluded.sell_price_min_date,
      buy_price_max = excluded.buy_price_max, buy_price_max_date = excluded.buy_price_max_date, fetched_at = excluded.fetched_at`);
  return inTransaction(db, () => {
    for (const r of records) {
      stmt.run(r.item_id, r.city, r.quality, nullIfEmpty(r.sell_price_min), nullIfEpoch(r.sell_price_min_date),
        nullIfEmpty(r.buy_price_max), nullIfEpoch(r.buy_price_max_date), stampOf(r, fetchedAt));
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
        stmt.run(s.item_id, s.location, s.quality, point.timestamp, Math.round(point.item_count), Math.round(point.avg_price), stampOf(s, fetchedAt));
        rows++;
      }
    }
    return rows;
  });
}

// Убирает строки предметов, которых нет в текущем каталоге (каталог менялся: например, AODP отвечает нулевыми ценами даже на
// несуществующие id вроде T2_2H_BOW@1, и такой мусор не должен попасть в выдачу сканера). Возвращает число удалённых строк.
function pruneToCatalog(db, ids) {
  const valid = new Set(ids);
  const removed = { prices: 0, history: 0 };
  return inTransaction(db, () => {
    for (const { id } of db.prepare('SELECT DISTINCT query_id AS id FROM prices').all()) {
      if (!valid.has(id)) removed.prices += Number(db.prepare('DELETE FROM prices WHERE query_id = ?').run(id).changes);
    }
    for (const { id } of db.prepare('SELECT DISTINCT item_id AS id FROM history').all()) {
      if (!valid.has(id)) removed.history += Number(db.prepare('DELETE FROM history WHERE item_id = ?').run(id).changes);
    }
    return removed;
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

// Удаляет историю старше окна хранения (с запасом в сутки): без этого база росла бы бесконечно.
function pruneOldHistory(db, hoursKept = HISTORY_WINDOW_HOURS, now = Date.now()) {
  const before = new Date(now - (hoursKept + 24) * 3600 * 1000).toISOString().slice(0, 19);
  return Number(db.prepare('DELETE FROM history WHERE ts < ?').run(before).changes);
}

const MANUAL_PRICE_TTL_MS = 10 * 24 * 3600 * 1000;
// price = 0 или пусто — убрать вписанную цену
function setManualPrice(db, queryId, quality, price, now = Date.now()) {
  if (!(price > 0)) { db.prepare('DELETE FROM manual_prices WHERE query_id = ? AND quality = ?').run(queryId, quality); return; }
  db.prepare('INSERT INTO manual_prices (query_id, quality, price, entered_at) VALUES (?, ?, ?, ?) ON CONFLICT (query_id, quality) DO UPDATE SET price = excluded.price, entered_at = excluded.entered_at')
    .run(queryId, quality, Math.round(price), now);
}
// Вписанные цены по списку id (просроченные — старше 10 дней — удаляются): { 'id|quality': { price, enteredAt } }
function getManualPrices(db, ids, now = Date.now()) {
  db.prepare('DELETE FROM manual_prices WHERE entered_at < ?').run(now - MANUAL_PRICE_TTL_MS);
  const out = {};
  const list = [...new Set(ids)];
  for (let i = 0; i < list.length; i += 500) {
    const part = list.slice(i, i + 500);
    const rows = db.prepare(`SELECT query_id, quality, price, entered_at FROM manual_prices WHERE query_id IN (${part.map(() => '?').join(',')})`).all(...part);
    for (const r of rows) out[`${r.query_id}|${r.quality}`] = { price: r.price, enteredAt: r.entered_at };
  }
  return out;
}

module.exports = { MANUAL_PRICE_TTL_MS, setManualPrice, getManualPrices, HISTORY_WINDOW_HOURS, pruneOldHistory, openJug, inTransaction, upsertPriceSnapshots, upsertHistoryBatch, pruneToCatalog, setMeta, getMeta, jugStats };
