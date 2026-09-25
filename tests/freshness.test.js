// Свежесть данных для позиций крафт-листа/стека: /api/freshness (где у калькулятора совсем нет данных) и /api/freshness/refresh
// (живой запрос к AODP по конкретным id, запись в кувшин). Идея: пользователь идёт в игру, открывает предмет на рынке (клиент
// AODP его сканирует), возвращается и жмёт «Обновить» — сайт подтягивает настоящие данные, не дожидаясь своего часа краулера.
// Критерий — ровно тот же, что использует сам калькулятор (materialPriceQuotes для материалов, patientSell.byCity для самого
// предмета), никакого своего порога «устарело»: сканированием чинится только отсутствие данных, а не их возраст.
import { createRequire } from 'node:module';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

process.env.JUG_DB_PATH = ':memory:';
process.env.DISABLE_RATE_LIMIT = 'true';
process.env.DISABLE_JUG_CRAWLER = 'true';
process.env.AODP_RATE_PER_MINUTE = '1000000';
const require = createRequire(import.meta.url);
const { app, jugDb, resetCaches } = require('../server.js');
const { upsertPriceSnapshots, upsertHistoryBatch } = require('../lib/jugStore.js');

const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString().slice(0, 19);
const DAY = 86400000;

function seedPrice(id, city, price, ageMs, quality = 1) {
  upsertPriceSnapshots(jugDb, [{ item_id: id, city, quality, sell_price_min: price, sell_price_min_date: iso(NOW - ageMs), buy_price_max: 0, buy_price_max_date: '0001-01-01T00:00:00' }], NOW);
}
function seedHistory(id, city, ageMs, quality = 1) {
  upsertHistoryBatch(jugDb, [{ item_id: id, location: city, quality, data: [{ item_count: 5, avg_price: 100, timestamp: iso(NOW - ageMs) }] }], NOW);
}

beforeEach(() => {
  jugDb.exec('DELETE FROM prices');
  jugDb.exec('DELETE FROM history');
  jugDb.exec('DELETE FROM manual_prices');
  resetCaches();
});

describe('GET /api/freshness — материал (kind=material, окно «Истории сырья»)', () => {
  it('без ids — 400', async () => {
    const res = await request(app).get('/api/freshness');
    expect(res.status).toBe(400);
  });

  it('есть котировка (даже старая) — данные есть, в списке нет', async () => {
    seedPrice('T4_CLOTH', 'Martlock', 100, 9 * DAY);                    // котировка не протухает сама — калькулятор возьмёт и такую
    const res = await request(app).get('/api/freshness?ids=T4_CLOTH&cities=Martlock');
    expect(res.body.cities).toEqual(['Martlock']);
    expect(res.body.items[0].stale).toBe(false);
    expect(res.body.items[0].byCity.Martlock.stale).toBe(false);
  });

  it('котировки нет, но сделка в окне «Истории сырья» есть — данные есть', async () => {
    seedHistory('T4_CLOTH', 'Martlock', 3600 * 1000, 1);
    const res = await request(app).get('/api/freshness?ids=T4_CLOTH&cities=Martlock&materialHours=24');
    expect(res.body.items[0].stale).toBe(false);
  });

  it('ни котировки, ни сделки в окне — нет данных', async () => {
    const res = await request(app).get('/api/freshness?ids=T5_LEATHER&cities=Lymhurst');
    expect(res.body.items[0].stale).toBe(true);
    expect(res.body.items[0].byCity.Lymhurst.stale).toBe(true);
  });

  it('сделка была, но за пределами окна «Истории сырья», котировки нет — нет данных (окно короче, чем возраст сделки)', async () => {
    seedHistory('T4_CLOTH', 'Martlock', 2 * DAY, 1);
    const res = await request(app).get('/api/freshness?ids=T4_CLOTH&cities=Martlock&materialHours=24');   // сделке 2 дня, окно — 1 день
    expect(res.body.items[0].stale).toBe(true);
    const wider = await request(app).get('/api/freshness?ids=T4_CLOTH&cities=Martlock&materialHours=72'); // а с окном в 3 дня — уже видно
    expect(wider.body.items[0].stale).toBe(false);
  });

  it('«Строго по окну» (экспериментально): цена ордера старше окна «История сырья» больше не считается данными; свежая и вписанная своя — считаются', async () => {
    seedPrice('T4_CLOTH', 'Martlock', 100, 2 * DAY);                                                       // ценник двухдневный, сделок нет
    const loose = await request(app).get('/api/freshness?ids=T4_CLOTH&cities=Martlock&materialHours=24');
    expect(loose.body.items[0].stale).toBe(false);                                                         // как раньше — годится любая цена
    const strict = await request(app).get('/api/freshness?ids=T4_CLOTH&cities=Martlock&materialHours=24&strictMaterials=true');
    expect(strict.body.items[0].stale).toBe(true);
    const wide = await request(app).get('/api/freshness?ids=T4_CLOTH&cities=Martlock&materialHours=72&strictMaterials=true');
    expect(wide.body.items[0].stale).toBe(false);                                                          // окно шире возраста цены
    seedPrice('T4_CLOTH', 'Martlock', 100, 3600 * 1000);                                                   // свежая цена
    const fresh = await request(app).get('/api/freshness?ids=T4_CLOTH&cities=Martlock&materialHours=24&strictMaterials=true');
    expect(fresh.body.items[0].stale).toBe(false);
  });

  it('свежо в одном городе, нет данных в другом — видно по каждому городу отдельно', async () => {
    seedPrice('T4_CLOTH', 'Martlock', 100, 3600 * 1000);
    const res = await request(app).get('/api/freshness?ids=T4_CLOTH&cities=Martlock,Lymhurst');
    expect(res.body.items[0].stale).toBe(true);                        // хоть один город без данных — есть что обновить
    expect(res.body.items[0].byCity.Martlock.stale).toBe(false);
    expect(res.body.items[0].byCity.Lymhurst.stale).toBe(true);
  });

  it('без cities — все семь городов по умолчанию', async () => {
    const res = await request(app).get('/api/freshness?ids=T8_GHOST_ITEM');
    expect(res.body.cities).toHaveLength(7);
    expect(Object.keys(res.body.items[0].byCity)).toEqual(res.body.cities);
  });

  it('несколько id и дубликаты — по одной строке на уникальный id, порядок как во входе', async () => {
    seedPrice('T4_CLOTH', 'Martlock', 100, 3600 * 1000);
    const res = await request(app).get('/api/freshness?ids=T4_CLOTH,T5_LEATHER,T4_CLOTH');
    expect(res.body.items.map((x) => x.id)).toEqual(['T4_CLOTH', 'T5_LEATHER']);
  });
});

describe('GET /api/freshness — сам предмет (kind=self, окно «Истории гира», patientSell.byCity)', () => {
  it('свежий ценник ордера, сделок не было — данные есть (запасная цена калькулятора: скан в игре присылает ордера, не сделки)', async () => {
    seedPrice('T6_CAPE@1', 'Martlock', 5000, 2 * 3600 * 1000, 1);        // ценник — 2 часа назад
    const res = await request(app).get('/api/freshness?ids=T6_CAPE@1&cities=Martlock&kinds=self&qualities=1&days=1');
    expect(res.body.items[0].stale).toBe(false);
  });

  it('ценник старше окна «Истории гира» и сделок нет — нет данных; окно шире — данные есть', async () => {
    seedPrice('T6_CAPE@1', 'Martlock', 5000, 2 * DAY, 1);                // ценник — 2 дня назад
    const narrow = await request(app).get('/api/freshness?ids=T6_CAPE@1&cities=Martlock&kinds=self&qualities=1&days=1');
    expect(narrow.body.items[0].stale).toBe(true);
    const wide = await request(app).get('/api/freshness?ids=T6_CAPE@1&cities=Martlock&kinds=self&qualities=1&days=3');
    expect(wide.body.items[0].stale).toBe(false);
  });

  it('ценник другого качества не считается: у нужного качества ордеров нет — нет данных', async () => {
    seedPrice('T6_CAPE@1', 'Martlock', 5000, 3600 * 1000, 3);            // свежий, но качество 3
    const res = await request(app).get('/api/freshness?ids=T6_CAPE@1&cities=Martlock&kinds=self&qualities=4&days=1');
    expect(res.body.items[0].stale).toBe(true);
  });

  it('сделка в окне «Истории гира» есть — данные есть, ценник не нужен', async () => {
    seedHistory('T6_CAPE@1', 'Martlock', 3600 * 1000, 1);
    const res = await request(app).get('/api/freshness?ids=T6_CAPE@1&cities=Martlock&kinds=self&qualities=1&days=1');
    expect(res.body.items[0].stale).toBe(false);
  });

  it('сделка за пределами окна «Истории гира» — нет данных, а с более широким окном — уже есть', async () => {
    seedHistory('T6_CAPE@1', 'Martlock', 2 * DAY, 1);
    const narrow = await request(app).get('/api/freshness?ids=T6_CAPE@1&cities=Martlock&kinds=self&qualities=1&days=1');
    expect(narrow.body.items[0].stale).toBe(true);
    const wide = await request(app).get('/api/freshness?ids=T6_CAPE@1&cities=Martlock&kinds=self&qualities=1&days=3');
    expect(wide.body.items[0].stale).toBe(false);
  });

  it('качество — своё: сделка качества 1 не считается за нужное качество 4', async () => {
    seedHistory('T6_CAPE@1', 'Martlock', 3600 * 1000, 1);
    const res = await request(app).get('/api/freshness?ids=T6_CAPE@1&cities=Martlock&kinds=self&qualities=4&days=3');
    expect(res.body.items[0].quality).toBe(4);
    expect(res.body.items[0].stale).toBe(true);
  });

  it('kinds по умолчанию (не указано) — считается материалом, не предметом', async () => {
    seedPrice('T6_CAPE@1', 'Martlock', 5000, 3600 * 1000, 1);            // только ценник — для материала этого достаточно
    const res = await request(app).get('/api/freshness?ids=T6_CAPE@1&cities=Martlock&qualities=1');
    expect(res.body.items[0].stale).toBe(false);
  });
});

describe('вписанная цена (для игры без клиента AODP — с телефона)', () => {
  it('вписанная цена — тоже полноценные данные для калькулятора: снимает «нет данных» во всех городах разом', async () => {
    const res1 = await request(app).get('/api/freshness?ids=T4_HEAD_LEATHER_SET3@3&cities=Martlock,Caerleon&kinds=self&qualities=4&days=3');
    expect(res1.body.items[0].stale).toBe(true);
    expect(res1.body.items[0].manual).toBeNull();
    await request(app).post('/api/manual-price').send({ id: 'T4_HEAD_LEATHER_SET3@3', quality: 4, price: 88000 });
    const res2 = await request(app).get('/api/freshness?ids=T4_HEAD_LEATHER_SET3@3&cities=Martlock,Caerleon&kinds=self&qualities=4&days=3');
    expect(res2.body.items[0].stale).toBe(false);
    expect(res2.body.items[0].byCity.Martlock.stale).toBe(false);
    expect(res2.body.items[0].byCity.Caerleon.stale).toBe(false);        // своя цена не привязана к городу — действует на все разом
    expect(res2.body.items[0].manual).toMatchObject({ price: 88000 });
  });

  it('своя цена сохраняется под своим качеством — на другое качество того же предмета не действует', async () => {
    await request(app).post('/api/manual-price').send({ id: 'T4_HEAD_LEATHER_SET3@3', quality: 4, price: 88000 });
    const otherQuality = await request(app).get('/api/freshness?ids=T4_HEAD_LEATHER_SET3@3&cities=Martlock&kinds=self&qualities=3&days=3');
    expect(otherQuality.body.items[0].stale).toBe(true);
    expect(otherQuality.body.items[0].manual).toBeNull();
  });
});

describe('окна «Истории сырья»/«Истории гира»: свои значения и границы', () => {
  it('materialHours — своё значение уважается', async () => {
    seedHistory('T4_CLOTH', 'Martlock', 5 * 3600 * 1000, 1);             // сделка — 5 часов назад
    const short = await request(app).get('/api/freshness?ids=T4_CLOTH&cities=Martlock&materialHours=1');
    expect(short.body.items[0].stale).toBe(true);
    const long = await request(app).get('/api/freshness?ids=T4_CLOTH&cities=Martlock&materialHours=12');
    expect(long.body.items[0].stale).toBe(false);
  });

  it('нечисло и отрицательное — умолчание (24ч у materialHours, 7д у days)', async () => {
    seedHistory('T4_CLOTH', 'Martlock', 12 * 3600 * 1000, 1);
    const bad = await request(app).get('/api/freshness?ids=T4_CLOTH&cities=Martlock&materialHours=NaN');
    expect(bad.body.items[0].stale).toBe(false);                         // умолчание 24ч > 12ч — данные есть
    const neg = await request(app).get('/api/freshness?ids=T4_CLOTH&cities=Martlock&materialHours=-5');
    expect(neg.body.items[0].stale).toBe(false);
  });

  it('за пределами границ — обрезается (materialHours 1–240ч, days 1ч–30д)', async () => {
    seedHistory('T4_CLOTH', 'Martlock', 200 * 3600 * 1000, 1);           // сделка 200 часов назад
    const huge = await request(app).get('/api/freshness?ids=T4_CLOTH&cities=Martlock&materialHours=99999');
    expect(huge.body.items[0].stale).toBe(false);                        // обрезано до 240ч (10 дней) — сделка внутри
  });
});

describe('POST /api/freshness/refresh', () => {
  const install = () => vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes('/history/')) {
      const ids = decodeURIComponent(u.split('/history/')[1].split('?')[0]).split(',');
      return { ok: true, status: 200, json: async () => ids.flatMap((id) => [{ item_id: id, location: 'Martlock', quality: 1, data: [{ item_count: 9, avg_price: 777, timestamp: iso(NOW) }] }]) };
    }
    const ids = decodeURIComponent(u.split('/prices/')[1].split('?')[0]).split(',');
    return { ok: true, status: 200, json: async () => ids.flatMap((id) => [{ item_id: id, city: 'Martlock', quality: 1, sell_price_min: 555, sell_price_min_date: iso(NOW), buy_price_max: 0, buy_price_max_date: '0001-01-01T00:00:00' }]) };
  });

  it('живьём тянет цену и историю, пишет в кувшин — материал сразу виден по котировке', async () => {
    install();
    const res = await request(app).post('/api/freshness/refresh').send({ ids: ['T4_CLOTH'], cities: ['Martlock'] });
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ id: 'T4_CLOTH', stale: false });
    // и в самой базе — тоже видно (следующий обычный запрос увидит то же самое)
    const after = await request(app).get('/api/freshness?ids=T4_CLOTH&cities=Martlock');
    expect(after.body.items[0].stale).toBe(false);
  });

  it('kinds=self — пересчитывает по «Истории гира», а не по «Истории сырья»', async () => {
    install();                                                           // AODP отдаёт сделку в Martlock (истории), не только ценник
    const res = await request(app).post('/api/freshness/refresh').send({ ids: ['T6_CAPE@1'], cities: ['Martlock'], kinds: { 'T6_CAPE@1': 'self' }, qualities: { 'T6_CAPE@1': 1 }, days: 3 });
    expect(res.body.items[0]).toMatchObject({ id: 'T6_CAPE@1', quality: 1, stale: false });
  });

  it('id не из каталога кувшина отсекается; если ни одного известного — 400', async () => {
    install();
    const res = await request(app).post('/api/freshness/refresh').send({ ids: ['NOT_A_REAL_ITEM_XYZ'] });
    expect(res.status).toBe(400);
  });

  it('AODP недоступен — 502 с понятной ошибкой, а не падение сервера', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({ ok: false, status: 503 }));
    const res = await request(app).post('/api/freshness/refresh').send({ ids: ['T4_CLOTH'] });
    expect(res.status).toBe(502);
    expect(res.body.error).toBeTruthy();
  });

  it('без ids — 400', async () => {
    install();
    const res = await request(app).post('/api/freshness/refresh').send({});
    expect(res.status).toBe(400);
  });

  // Баг: «Обновить» — это явная просьба «спроси AODP прямо сейчас», а не рутинный запрос калькулятора с общим 5-минутным
  // кэшем (тот же предмет+качество мог недавно спросить кто угодно другой на сайте) — второй клик по «Обновить» подряд
  // должен снова дойти до AODP, а не молча вернуть тот же ответ, что и первый (resetCaches() в beforeEach тут не при делах —
  // он чистит кэш МЕЖДУ тестами, а не между двумя вызовами внутри одного).
  it('«Обновить» не берёт свой же 5-минутный кэш калькулятора — второй клик подряд снова бьёт в AODP', async () => {
    const fetchSpy = install();
    await request(app).post('/api/freshness/refresh').send({ ids: ['T4_CLOTH'], cities: ['Martlock'] });
    const callsAfterFirst = fetchSpy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);
    await request(app).post('/api/freshness/refresh').send({ ids: ['T4_CLOTH'], cities: ['Martlock'] });
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);   // не из кэша — сходил в AODP заново
  });
});
