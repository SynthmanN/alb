// Публичный живой поток AODP (NATS) — отдельно от краулера, который ходит по расписанию за REST. Смысл: REST-API самого
// AODP заметно отстаёт (проверено на реальных данных — обычный материал показывал цену трёхчасовой давности), а NATS
// рассылает то, что игроки прислали, почти сразу. Слушаем постоянно (сообщение, отправленное до подписки, теряется
// безвозвратно — у NATS нет истории), но пишем в кувшин только то, что относится к нашему каталогу — остальной
// глобальный поток (у AODP это сотни сообщений в секунду) не нужен и не хранится.
// Пока только ЦЕНЫ (marketorders.deduped) — история сделок (markethistories.deduped) требует ещё одного справочника:
// там предмет идёт по числовому AlbionId (внутренний id игры), не по строковому «T4_METALBAR», а такого соответствия
// в проекте пока нет (нужно тянуть из ao-bin-dumps отдельно, items.json там ~24Мб и без явного числового id в выборке
// не проверялось) — сделано как понятная следующая задача, не как часть этого захода.
// Публичный адрес и топик — из официальной документации AODP (albion-online-data.com/developer):
// nats://public:thenewalbiondata@nats.albion-online-data.com:34222 (Европа), топик marketorders.deduped.
const { connect, StringCodec } = require('nats');

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

  return nc;
}

module.exports = { startNatsFeed, applyOrder, orderToPriceRow, LOCATION_NAMES };
