// Публичный живой поток AODP (NATS) — отдельно от краулера, который ходит по расписанию за REST. Смысл: REST-API самого
// AODP заметно отстаёт (проверено на реальных данных — обычный материал показывал цену трёхчасовой давности), а NATS
// рассылает то, что игроки прислали, почти сразу. Слушаем постоянно (сообщение, отправленное до подписки, теряется
// безвозвратно — у NATS нет истории), но пишем в кувшин только то, что относится к нашему каталогу — остальной
// глобальный поток (у AODP это сотни сообщений в секунду) не нужен и не хранится.
// Два топика: цены (marketorders.deduped) и история сделок (markethistories.deduped). История приходит, когда игрок в
// игре открыл график предмета (скан списка присылает только ордера), — оборот и средняя цена появляются сразу, не ждут
// опроса REST. Числовой справочник AlbionId не нужен: в каждом сообщении истории есть и строковый AlbionIdString.
// Публичный адрес и топик — из официальной документации AODP (albion-online-data.com/developer):
// nats://public:thenewalbiondata@nats.albion-online-data.com:34222 (Европа), топики marketorders.deduped и markethistories.deduped.
const { connect, StringCodec } = require('nats');
const { HISTORY_WINDOW_HOURS, inTransaction } = require('./jugStore');

const NATS_URL = process.env.NATS_URL || 'nats://nats.albion-online-data.com:34222';
const NATS_USER = 'public';
const NATS_PASS = 'thenewalbiondata';

// Соответствие числового LocationId (как приходит в сыром сообщении NATS) названию города, которое использует остальной
// сайт (то же, что отдаёт REST AODP — CITY_DISPLAY в server.js). Источник — albionfreemarket.com/pricecheck: там в URL
// (?c=...) города зашифрованы теми же числовыми кодами; включая по одному городу за раз и читая, как меняется код в
// адресной строке, пользователь получил все восемь напрямую от того же сервиса, что и мы читаем через NATS, — надёжнее
// подобранной по цене догадки. Ей, к слову, эта сверка и поймала на ошибке: первая попытка (сверка с ценой REST на
// живом потоке) перепутала местами 7 и 4002 — Fort Sterling и Thetford совпали по цене случайно у одного из проверенных
// предметов, что и предупреждали пометки «дешёвые предметы для сверки не годятся» в первых черновиках этой таблицы.
const LOCATION_NAMES = {
  3003: 'Black Market',
  5003: 'Brecilien',
  2004: 'Bridgewatch',
  3005: 'Caerleon',
  4002: 'Fort Sterling',
  1002: 'Lymhurst',
  3008: 'Martlock',
  7: 'Thetford',
};

// MarketOrder (marketorders.deduped) → строка для upsertPriceSnapshots, либо null — если город не сопоставлен, предмета
// нет в нашем каталоге, или количество ушло в минус (истёкший/удалённый ордер — не сигнал о цене).
// AuctionType: 'offer' — предмет выставлен на продажу (кандидат в sell_price_min, «по этой цене можно купить»);
// 'request' — запрос на покупку (кандидат в buy_price_max, «по этой цене можно продать мгновенно»).
function orderToPriceRow(order, catalogSet) {
  if (!order || typeof order.ItemTypeId !== 'string') return null;
  const city = LOCATION_NAMES[order.LocationId];
  if (!city) return null;
  if (!catalogSet.has(order.ItemTypeId)) return null;
  if (!(order.UnitPriceSilver > 0)) return null;
  const now = new Date().toISOString().slice(0, 19);
  const row = { item_id: order.ItemTypeId, city, quality: order.QualityLevel };
  if (order.AuctionType === 'offer') { row.sell_price_min = order.UnitPriceSilver; row.sell_price_min_date = now; }
  else if (order.AuctionType === 'request') { row.buy_price_max = order.UnitPriceSilver; row.buy_price_max_date = now; }
  else return null;
  return row;
}

// Читает текущую цену из кувшина (для сохранения второй половины строки — sell/buy живут в одной строке на пару
// город+качество, upsertPriceSnapshots переписывает обе разом) и применяет ордер, только если он ЛУЧШЕ уже известного:
// ниже текущего sell_price_min или выше текущего buy_price_max. Один случайный ордер не обязательно самый дешёвый/дорогой
// на рынке — NATS шлёт отдельные ордера, а не готовый агрегат, как REST; наивная перезапись любой ценой из потока могла
// бы испортить уже верную (более дешёвую) цену, случайно попавшуюся в сообщении позже.
function applyOrder(db, order, catalogSet) {
  const row = orderToPriceRow(order, catalogSet);
  if (!row) return false;
  const existing = db.prepare('SELECT sell_price_min, sell_price_min_date, buy_price_max, buy_price_max_date FROM prices WHERE query_id = ? AND city = ? AND quality = ?')
    .get(row.item_id, row.city, row.quality);
  if (row.sell_price_min !== undefined) {
    if (existing && existing.sell_price_min && existing.sell_price_min <= row.sell_price_min) return false;   // не лучше того, что уже знаем — не трогаем
    row.buy_price_max = existing ? existing.buy_price_max : null;
    row.buy_price_max_date = existing ? existing.buy_price_max_date : null;
  } else {
    if (existing && existing.buy_price_max && existing.buy_price_max >= row.buy_price_max) return false;
    row.sell_price_min = existing ? existing.sell_price_min : null;
    row.sell_price_min_date = existing ? existing.sell_price_min_date : null;
  }
  db.prepare(`INSERT INTO prices (query_id, city, quality, sell_price_min, sell_price_min_date, buy_price_max, buy_price_max_date, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (query_id, city, quality) DO UPDATE SET sell_price_min = excluded.sell_price_min, sell_price_min_date = excluded.sell_price_min_date,
      buy_price_max = excluded.buy_price_max, buy_price_max_date = excluded.buy_price_max_date, fetched_at = excluded.fetched_at`)
    .run(row.item_id, row.city, row.quality, row.sell_price_min ?? null, row.sell_price_min_date ?? null, row.buy_price_max ?? null, row.buy_price_max_date ?? null, Date.now());
  return true;
}

// .NET-тики (100 нс от 0001-01-01) → ISO-время без миллисекунд, как у REST (2026-09-28T19:00:00).
const TICKS_AT_UNIX_EPOCH = 621355968000000000;
const ticksToIso = (ticks) => new Date((Number(ticks) - TICKS_AT_UNIX_EPOCH) / 1e4).toISOString().slice(0, 19);

// MarketHistory (markethistories.deduped) → серия для записи в таблицу history, либо null. Берём только Timescale 0 —
// ПОЧАСОВЫЕ точки за сутки: они совпадают с почасовой историей REST (проверено на живом потоке: тот же час, то же
// число сделок, цена = SilverAmount / ItemAmount, округление вниз). Timescale 1 и 2 — 6-часовые корзины за неделю и
// месяц: в таблице они лежали бы рядом с почасовыми точками того же времени и удваивали оборот, поэтому не пишем.
// SilverAmount — сумма серебра за все сделки часа, ItemAmount — сколько штук продано.
function historyToSeries(msg, catalogSet) {
  if (!msg || msg.Timescale !== 0 || typeof msg.AlbionIdString !== 'string' || !Array.isArray(msg.MarketHistories)) return null;
  const location = LOCATION_NAMES[msg.LocationId];
  if (!location || !catalogSet.has(msg.AlbionIdString)) return null;
  const quality = Number(msg.QualityLevel);
  if (!(quality >= 1 && quality <= 5)) return null;
  const data = [];
  for (const h of msg.MarketHistories) {
    if (!h || !(h.ItemAmount > 0) || !(h.SilverAmount > 0)) continue;
    data.push({ timestamp: ticksToIso(h.Timestamp), item_count: h.ItemAmount, avg_price: Math.floor(h.SilverAmount / h.ItemAmount) });
  }
  return data.length ? { item_id: msg.AlbionIdString, location, quality, data } : null;
}

// Пишет почасовые точки. Уже известный час не затираем меньшим числом сделок: в течение часа счёт только растёт, а
// сообщение могло быть снято раньше того, что уже лежит в кувшине (от REST или другого игрока). Возвращает число строк.
function applyHistory(db, msg, catalogSet, now = Date.now()) {
  const series = historyToSeries(msg, catalogSet);
  if (!series) return 0;
  const oldest = new Date(now - HISTORY_WINDOW_HOURS * 3600 * 1000).toISOString().slice(0, 19);
  const stmt = db.prepare(`INSERT INTO history (item_id, location, quality, ts, item_count, avg_price, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (item_id, location, quality, ts) DO UPDATE SET item_count = excluded.item_count, avg_price = excluded.avg_price, fetched_at = excluded.fetched_at
    WHERE excluded.item_count >= history.item_count`);
  return inTransaction(db, () => {
    let rows = 0;
    for (const p of series.data) {
      if (p.timestamp < oldest) continue;
      rows += Number(stmt.run(series.item_id, series.location, series.quality, p.timestamp, p.item_count, p.avg_price, now).changes);
    }
    return rows;
  });
}

// Подключается к публичному NATS AODP и постоянно пишет в кувшин то, что относится к каталогу сайта. Не бросает
// исключения наружу — сеть недоступна или сервер NATS отвалился, сайт должен продолжать работать на REST-опросе
// краулера как раньше, просто без «мгновенных» обновлений. getCatalog() — функция (не готовый Set), чтобы каталог
// подхватывал изменения (buildJugCatalog кэшируется в server.js и может обновиться).
async function startNatsFeed(db, getCatalog, { log = console } = {}) {
  const sc = StringCodec();
  let nc;
  try {
    nc = await connect({ servers: NATS_URL, user: NATS_USER, pass: NATS_PASS, reconnect: true, maxReconnectAttempts: -1 });
  } catch (err) {
    log.error('NATS: не удалось подключиться —', err.message, '— живые обновления в окне свежести работать не будут, сайт продолжит на обычном опросе AODP');
    return null;
  }
  log.info('NATS: подключено,', nc.getServer());

  (async () => {
    for await (const status of nc.status()) log.warn('NATS: статус соединения —', status.type);
  })().catch(() => {});

  (async () => {
    const sub = nc.subscribe('marketorders.deduped');
    for await (const m of sub) {
      let data;
      try { data = JSON.parse(sc.decode(m.data)); } catch { continue; }
      try { applyOrder(db, data, getCatalog()); } catch (err) { log.error('NATS: ошибка записи ордера —', err.message); }
    }
  })().catch((err) => log.error('NATS: подписка на marketorders прервалась —', err.message));

  (async () => {
    const sub = nc.subscribe('markethistories.deduped');
    for await (const m of sub) {
      let data;
      try { data = JSON.parse(sc.decode(m.data)); } catch { continue; }
      try { applyHistory(db, data, getCatalog()); } catch (err) { log.error('NATS: ошибка записи истории —', err.message); }
    }
  })().catch((err) => log.error('NATS: подписка на markethistories прервалась —', err.message));

  return nc;
}

module.exports = { startNatsFeed, applyOrder, orderToPriceRow, applyHistory, historyToSeries, ticksToIso, LOCATION_NAMES };
