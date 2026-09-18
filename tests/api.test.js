// API-тесты через supertest (без реального порта). Внешний AODP подменён: тесты детерминированы и не ходят в сеть.
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

const require = createRequire(import.meta.url);
// Уровни мастерок в тестах пишутся во временный файл, а не в data/user-masteries.json пользователя.
const masteriesFile = path.join(os.tmpdir(), `albion-masteries-test-${process.pid}.json`);
process.env.USER_MASTERIES_PATH = masteriesFile;
const { app } = require('../server.js');

const CITIES = ['Fort Sterling', 'Bridgewatch', 'Lymhurst', 'Martlock', 'Thetford'];
const NOW = () => new Date().toISOString().slice(0, 19);

// Ответ AODP: по каждому запрошенному предмету — запись в каждом городе. Цена покупки растёт с тиром,
// зачарованием и качеством (иначе у примерочной нет выбора "дороже — больше IP"); цена продажи фиксирована.
function fakeAodp(url) {
  const u = String(url);
  const ids = decodeURIComponent(u.split('/prices/')[1].split('?')[0]).split(',');
  const qualities = (new URL(u).searchParams.get('qualities') || '1').split(',').map(Number);
  const records = [];
  for (const id of ids) {
    const tier = Number((id.match(/^T(\d)_/) || [])[1]) || 4;
    const enchant = Number((id.match(/@(\d)$/) || [])[1]) || 0;
    for (const city of CITIES) {
      for (const quality of qualities) {
        const price = 100 * tier + 400 * enchant + 30 * quality;
        records.push({
          item_id: id, city, quality,
          sell_price_min: price, sell_price_min_date: NOW(), sell_price_max: price, sell_price_max_date: NOW(),
          buy_price_min: 1, buy_price_min_date: NOW(), buy_price_max: 500, buy_price_max_date: NOW(),
        });
      }
    }
  }
  return records;
}

beforeAll(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({
    ok: true, status: 200, json: async () => fakeAodp(url),
  }));
});
afterAll(() => {
  vi.restoreAllMocks();
  fs.rmSync(masteriesFile, { force: true });
});

describe('статика и справочники', () => {
  it.each(['/', '/scanners.html', '/craft.html', '/refine.html', '/fitting-room.html', '/masteries.html', '/js/common.js', '/style.css'])(
    '%s отдаётся', async (p) => {
      const res = await request(app).get(p);
      expect(res.status).toBe(200);
    });
  it('/api/items — каталог (ресурсы + гир)', async () => {
    const res = await request(app).get('/api/items');
    expect(res.body.length).toBeGreaterThan(500);
    expect(res.body.find((i) => i.id === 'T4_MAIN_SWORD')).toBeTruthy();
  });
  it('/api/refining-meta — типы ресурсов и пресеты RRR', async () => {
    const res = await request(app).get('/api/refining-meta');
    expect(res.body.resourceTypes).toHaveLength(5);
    expect(res.body.rrrPresets.length).toBeGreaterThan(0);
  });
});

describe('мастерки', () => {
  it('дерево: 29 категорий, 101 специализация, уровней нет', async () => {
    const res = await request(app).get('/api/masteries');
    expect(res.body.masteries).toHaveLength(29);
    expect(res.body.specializations).toHaveLength(101);
    expect(res.body.levels).toEqual({ masteries: {}, specializations: {} });
  });
  it('сохранение: уровень ограничивается 200, неизвестные id игнорируются, 0 удаляет', async () => {
    let res = await request(app).post('/api/masteries').send({ specializations: { COMBAT_SWORDS_SWORD: 999, NOPE: 5 }, masteries: { COMBAT_SWORDS: 20 } });
    expect(res.body.specializations).toEqual({ COMBAT_SWORDS_SWORD: 200 });
    expect(res.body.masteries).toEqual({ COMBAT_SWORDS: 20 });
    res = await request(app).post('/api/masteries').send({ specializations: { COMBAT_SWORDS_SWORD: 0 }, masteries: { COMBAT_SWORDS: 0 } });
    expect(res.body.specializations).toEqual({});
    expect(res.body.masteries).toEqual({});
  });
});

describe('валидация запросов', () => {
  it('refining-calc: неверный тип ресурса и тир', async () => {
    expect((await request(app).get('/api/refining-calc?type=NOPE&tier=4')).status).toBe(400);
    expect((await request(app).get('/api/refining-calc?type=ORE&tier=9')).status).toBe(400);
  });
  it('craft-bulk-plan и craft-calc без предмета — 404 с JSON', async () => {
    for (const url of ['/api/craft-bulk-plan', '/api/craft-calc?item=NOPE']) {
      const res = await request(app).get(url);
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/no recipe/);
    }
  });
  const fitBase = 'head=HEAD_PLATE_SET1&chest=ARMOR_PLATE_SET1&shoes=SHOES_PLATE_SET1&cape=CAPE&targetIP=900';
  it('примерочная: не хватает слотов, двуручное + левая рука, одноручное без левой руки, чужой слот', async () => {
    const cases = [
      ['/api/fitting-room?targetIP=900', /нужно выбрать/],
      [`/api/fitting-room?weapon=2H_BOW&offhand=OFF_SHIELD&${fitBase}`, /двуручное/],
      [`/api/fitting-room?weapon=MAIN_SWORD&${fitBase}`, /левую руку/],
      [`/api/fitting-room?weapon=HEAD_PLATE_SET1&offhand=OFF_SHIELD&${fitBase}`, /не подходит/],
      ['/api/fitting-room?weapon=MAIN_SWORD&offhand=OFF_SHIELD&head=HEAD_PLATE_SET1&chest=ARMOR_PLATE_SET1&shoes=SHOES_PLATE_SET1&cape=CAPE&targetIP=abc', /targetIP/],
    ];
    for (const [url, re] of cases) {
      const res = await request(app).get(url);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(re);
    }
  });
});

describe('расчёты с подменённым AODP', () => {
  it('craft-calc: налог 8% / 4% и профит после налога', async () => {
    const free = (await request(app).get('/api/craft-calc?item=T4_MAIN_SWORD&premium=false')).body;
    const prem = (await request(app).get('/api/craft-calc?item=T4_MAIN_SWORD&premium=true')).body;
    expect(free.taxRate).toBe(0.08);
    expect(prem.taxRate).toBe(0.04);
    expect(free.bestSell.price).toBe(500);
    expect(free.netSellPrice).toBeCloseTo(460, 6);
    expect(prem.netSellPrice).toBeCloseTo(480, 6);
    expect(free.profitPerUnit).toBeCloseTo(460 - free.effectiveCostPerUnit, 6);
  });
  it('refining-calc: профит по городам считается после налога', async () => {
    const res = (await request(app).get('/api/refining-calc?type=ORE&tier=4&rrr=none&premium=true')).body;
    expect(res.taxRate).toBe(0.04);
    const row = res.perCity[0];
    expect(row.netOutputSell).toBeCloseTo(row.outputSell * 0.96, 6);
    expect(row.profit).toBeCloseTo(row.netOutputSell - row.effectiveCost, 6);
  });
  it('примерочная: комбинации в окне IP, цена растёт от первого варианта к последнему', async () => {
    const q = 'weapon=MAIN_SWORD&offhand=OFF_SHIELD&head=HEAD_PLATE_SET1&chest=ARMOR_PLATE_SET1&shoes=SHOES_PLATE_SET1&cape=CAPE&targetIP=900&tolMinus=30&tolPlus=100&variants=5';
    const res = (await request(app).get(`/api/fitting-room?${q}`)).body;
    expect(res.unreachable).toBe(false);
    expect(res.variants.length).toBeGreaterThan(0);
    for (const v of res.variants) {
      expect(v.avgIP).toBeGreaterThanOrEqual(870);
      expect(v.avgIP).toBeLessThanOrEqual(1000);
      expect(Object.keys(v.slots).sort()).toEqual(['cape', 'chest', 'head', 'offhand', 'shoes', 'weapon']);
    }
    const prices = res.variants.map((v) => v.totalPrice);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });
  it('примерочная: недостижимая цель', async () => {
    const q = 'weapon=MAIN_SWORD&offhand=OFF_SHIELD&head=HEAD_PLATE_SET1&chest=ARMOR_PLATE_SET1&shoes=SHOES_PLATE_SET1&cape=CAPE&targetIP=9999';
    const res = (await request(app).get(`/api/fitting-room?${q}`)).body;
    expect(res.unreachable).toBe(true);
    expect(res.variants).toEqual([]);
  });
});
