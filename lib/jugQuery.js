// Чтение «кувшина» в ТОМ ЖЕ формате, что отдаёт живой AODP (записи цен и ряды истории): так все проверенные расчёты
// (cityStats, computePatientSell, marginSellStats…) работают с кувшином без переписывания и без второй копии логики,
// которая могла бы разойтись по честности с живым путём. Сам скан при этом не делает ни одного запроса к AODP.
const { getMeta } = require('./jugStore');

const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
const IN_LIST_LIMIT = 500; // SQLite: не больше ~32 тыс. параметров, но читаем порциями, чтобы не раздувать запрос

function chunked(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Цены: [{ item_id, city, quality, sell_price_min, sell_price_min_date, buy_price_max, buy_price_max_date, _fetchedAt }].
// ids — id для запроса (как в AODP: T4_MAIN_SWORD@1), cities — необязательный список городов (с пробелом или без).
// Пустая цена/дата в базе хранится как NULL, а «живой» формат AODP говорит 0 и 0001-01-01 — возвращаем его же.
function readPrices(db, ids, { cities = null, qualities = null } = {}) {
  const allowed = cities ? new Set(cities.map(norm)) : null;
  const wantQ = qualities ? new Set(qualities.map(Number)) : null;
  const out = [];
  for (const part of chunked(ids, IN_LIST_LIMIT)) {
    const marks = part.map(() => '?').join(',');
    for (const r of db.prepare(`SELECT * FROM prices WHERE query_id IN (${marks})`).all(...part)) {
      if (allowed && !allowed.has(norm(r.city))) continue;
      if (wantQ && !wantQ.has(r.quality)) continue;
      out.push({
        item_id: r.query_id, city: r.city, quality: r.quality,
        sell_price_min: r.sell_price_min ?? 0, sell_price_min_date: r.sell_price_min_date ?? '0001-01-01T00:00:00',
        buy_price_max: r.buy_price_max ?? 0, buy_price_max_date: r.buy_price_max_date ?? '0001-01-01T00:00:00',
        _fetchedAt: r.fetched_at,
      });
    }
  }
  return out;
}

// История: [{ location, item_id, quality, data: [{ item_count, avg_price, timestamp }], _fetchedAt }] — только точки за последние
// `hours` часов (короткие окна 12ч/24ч/72ч агрегируются из тех же 7-дневных данных кувшина, отдельного запроса не нужно).
function readHistory(db, ids, hours, { locations = null, qualities = null, now = Date.now() } = {}) {
  const allowed = locations ? new Set(locations.map(norm)) : null;
  const wantQ = qualities ? new Set(qualities.map(Number)) : null;
  const since = new Date(now - hours * 3600 * 1000).toISOString().slice(0, 19); // ts в базе — «2026-08-03T00:00:00»
  const series = new Map();
  for (const part of chunked(ids, IN_LIST_LIMIT)) {
    const marks = part.map(() => '?').join(',');
    const rows = db.prepare(`SELECT item_id, location, quality, ts, item_count, avg_price, fetched_at FROM history
      WHERE item_id IN (${marks}) AND ts >= ? ORDER BY item_id, location, quality, ts`).all(...part, since);
    for (const r of rows) {
      if (allowed && !allowed.has(norm(r.location))) continue;
      if (wantQ && !wantQ.has(r.quality)) continue;
      const key = `${r.item_id}|${r.location}|${r.quality}`;
      let s = series.get(key);
      if (!s) { s = { location: r.location, item_id: r.item_id, quality: r.quality, data: [], _fetchedAt: r.fetched_at }; series.set(key, s); }
      s.data.push({ item_count: r.item_count, avg_price: r.avg_price, timestamp: r.ts });
      if (r.fetched_at < s._fetchedAt) s._fetchedAt = r.fetched_at; // возраст ряда — по самой старой точке
    }
  }
  return [...series.values()];
}

// Свежесть кувшина целиком: когда был последний проход цен/истории и полный проход, возраст самой старой цены.
function jugFreshness(db, now = Date.now()) {
  const num = (k) => { const v = getMeta(db, k); return v === null ? null : Number(v); };
  const oldest = db.prepare('SELECT MIN(fetched_at) AS t FROM prices').get().t;
  return {
    lastPricePass: num('lastPricePass'), lastHistoryPass: num('lastHistoryPass'), lastFullPass: num('lastFullPass'),
    oldestPriceAgeMinutes: oldest === null ? null : Math.round((now - Number(oldest)) / 60000),
  };
}

module.exports = { readPrices, readHistory, jugFreshness };
