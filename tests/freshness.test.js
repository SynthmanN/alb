// Свежесть данных для позиций крафт-листа/стека: /api/freshness (что устарело или без данных) и /api/freshness/refresh (живой
// запрос к AODP по конкретным id, запись в кувшин). Идея: пользователь идёт в игру, открывает предмет на рынке (клиент AODP
// его сканирует), возвращается и жмёт «Обновить» — сайт подтягивает настоящие свежие данные, не дожидаясь своего часа краулера.
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

function seedPrice(id, city, price, ageMs) {
  upsertPriceSnapshots(jugDb, [{ item_id: id, city, quality: 1, sell_price_min: price, sell_price_min_date: iso(NOW - ageMs), buy_price_max: 0, buy_price_max_date: '0001-01-01T00:00:00' }], NOW);
}
function seedHistory(id, city, ageMs) {
  upsertHistoryBatch(jugDb, [{ item_id: id, location: city, quality: 1, data: [{ item_count: 5, avg_price: 100, timestamp: iso(NOW - ageMs) }] }], NOW);
}

beforeEach(() => {
  jugDb.exec('DELETE FROM prices');
  jugDb.exec('DELETE FROM history');
  resetCaches();
});

describe('GET /api/freshness', () => {
  it('без ids — 400', async () => {
    const res = await request(app).get('/api/freshness');
    expect(res.status).toBe(400);
  });

  it('свежая цена (моложе 3 дней) — не устарело, возраст в минутах', async () => {
    seedPrice('T4_CLOTH', 'Martlock', 100, 3 * 3600 * 1000);           // 3 часа назад
    const res = await request(app).get('/api/freshness?ids=T4_CLOTH&cities=Martlock');
    expect(res.body.staleDays).toBe(3);
    expect(res.body.items[0]).toMatchObject({ id: 'T4_CLOTH', stale: false });
    expect(res.body.items[0].priceAgeMinutes).toBeCloseTo(180, 0);
    expect(res.body.items[0].historyAgeDays).toBeNull();
  });

  it('цена старше 3 дней и истории нет вообще — устарело', async () => {
    seedPrice('T5_LEATHER', 'Lymhurst', 50, 4 * DAY);
    const res = await request(app).get('/api/freshness?ids=T5_LEATHER&cities=Lymhurst');
    expect(res.body.items[0]).toMatchObject({ stale: true });
    expect(res.body.items[0].priceAgeMinutes).toBeCloseTo(4 * 1440, 0);
  });

  it('цена устарела, но сделка была вчера — не устарело (берётся самый свежий из двух сигналов)', async () => {
    seedPrice('T6_RUNE', 'Thetford', 200, 10 * DAY);
    seedHistory('T6_RUNE', 'Thetford', DAY);
    const res = await request(app).get('/api/freshness?ids=T6_RUNE&cities=Thetford');
    expect(res.body.items[0]).toMatchObject({ stale: false });
    expect(res.body.items[0].historyAgeDays).toBeCloseTo(1, 0);
  });

  it('совсем без данных — устарело, возраст null', async () => {
    const res = await request(app).get('/api/freshness?ids=T8_GHOST_ITEM');
    expect(res.body.items[0]).toEqual({ id: 'T8_GHOST_ITEM', priceAgeMinutes: null, historyAgeDays: null, stale: true });
  });

  it('несколько id и дубликаты — по одной строке на уникальный id, порядок как во входе', async () => {
    seedPrice('T4_CLOTH', 'Martlock', 100, 3600 * 1000);
    const res = await request(app).get('/api/freshness?ids=T4_CLOTH,T5_LEATHER,T4_CLOTH');
    expect(res.body.items.map((x) => x.id)).toEqual(['T4_CLOTH', 'T5_LEATHER']);
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

  it('живьём тянет цену и историю, пишет в кувшин и отдаёт уже свежий возраст', async () => {
    install();
    seedPrice('T4_CLOTH', 'Martlock', 100, 10 * DAY);                  // было старое
    const res = await request(app).post('/api/freshness/refresh').send({ ids: ['T4_CLOTH'], cities: ['Martlock'] });
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ id: 'T4_CLOTH', stale: false });
    expect(res.body.items[0].priceAgeMinutes).toBeLessThan(2);
    expect(res.body.items[0].historyAgeDays).toBeLessThan(1);
    // и в самой базе — тоже свежее (следующий обычный запрос увидит то же самое)
    const after = await request(app).get('/api/freshness?ids=T4_CLOTH&cities=Martlock');
    expect(after.body.items[0].stale).toBe(false);
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
});
