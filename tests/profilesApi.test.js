// Профили крафта на сервере: личные (по cookie-сессии sid), создание/замена/удаление, проверка формы.
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

const file = path.join(os.tmpdir(), `albion-profiles-test-${process.pid}.json`);
process.env.USER_PROFILES_PATH = file;
process.env.JUG_DB_PATH = ':memory:';
process.env.DISABLE_RATE_LIMIT = 'true';
process.env.DISABLE_JUG_CRAWLER = 'true';
const require = createRequire(import.meta.url);
const { app } = require('../server.js');

const prof = (name = 'ROI 5.0% · 25.09.2026 14:05') => ({ name, savedAt: 1000, roi: 5, faction: 'MARTLOCK', items: [{ itemId: 'T4_CAPEITEM_FW_MARTLOCK', enchant: 2, quality: 4, quantity: 30, on: true }] });

afterAll(() => { fs.rmSync(file, { force: true }); });

describe('/api/profiles', () => {
  it('сохранить, получить, переименовать (замена), удалить; новые — вперёд списка', async () => {
    const a = request.agent(app);
    expect((await a.get('/api/profiles')).body).toEqual({ profiles: [] });
    expect((await a.put('/api/profiles/p1').send(prof())).body.ok).toBe(true);
    await a.put('/api/profiles/p2').send(prof('второй'));
    expect((await a.get('/api/profiles')).body.profiles.map((p) => p.id)).toEqual(['p2', 'p1']);
    await a.put('/api/profiles/p1').send(prof('Плащи на неделю'));
    const list = (await a.get('/api/profiles')).body.profiles;
    expect(list.map((p) => [p.id, p.name])).toEqual([['p2', 'второй'], ['p1', 'Плащи на неделю']]);
    expect(list[1]).toMatchObject({ savedAt: 1000, roi: 5, faction: 'MARTLOCK' });
    expect(list[1].items[0]).toMatchObject({ quantity: 30 });
    expect((await a.delete('/api/profiles/p2')).body).toEqual({ ok: true, removed: 1 });
    expect((await a.get('/api/profiles')).body.profiles.map((p) => p.id)).toEqual(['p1']);
  });
  it('профили личные: другой посетитель (другая cookie) их не видит', async () => {
    const a = request.agent(app);
    await a.put('/api/profiles/mine').send(prof('мой'));
    const other = request.agent(app);
    expect((await other.get('/api/profiles')).body.profiles).toEqual([]);
    expect((await a.get('/api/profiles')).body.profiles.map((p) => p.id)).toContain('mine');
  });
  it('форма проверяется: id, название, список позиций', async () => {
    const a = request.agent(app);
    expect((await a.put('/api/profiles/bad id!').send(prof())).status).toBe(400);
    expect((await a.put('/api/profiles/x').send({ ...prof(), name: '  ' })).status).toBe(400);
    expect((await a.put('/api/profiles/x').send({ ...prof(), items: 'нет' })).status).toBe(400);
    expect((await a.put('/api/profiles/x').send({ ...prof(), items: [{ quantity: 1 }] })).status).toBe(400);
    expect((await a.get('/api/profiles')).body.profiles).toEqual([]);
    expect((await a.delete('/api/profiles/несуществующий')).body.removed).toBe(0);
  });
});
