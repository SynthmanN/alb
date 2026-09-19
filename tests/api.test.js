// API-тесты через supertest (без реального порта). Внешний AODP подменён: тесты детерминированы и не ходят в сеть.
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';

const require = createRequire(import.meta.url);
// Уровни мастерок в тестах пишутся во временный файл, а не в data/user-masteries.json пользователя.
const masteriesFile = path.join(os.tmpdir(), `albion-masteries-test-${process.pid}.json`);
process.env.USER_MASTERIES_PATH = masteriesFile;
process.env.DISABLE_RATE_LIMIT = 'true'; // десятки запросов с одного IP за секунды — норма для тестов
process.env.JUG_DB_PATH = ':memory:'; // тесты не трогают реальную базу кувшина
process.env.AODP_RATE_PER_MINUTE = '1000000'; // подменённый AODP не должен ждать своей очереди в регуляторе бюджета
const { app, resetCaches, jugDb } = require('../server.js');
const { upsertPriceSnapshots, upsertHistoryBatch } = require('../lib/jugStore.js');
const RECIPES_DATA = require('../data/recipes.json');

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

// Сырьё, полуфабрикаты и руны калькулятор читает из кувшина (а не из AODP): в тестах кувшин засеян тем же «миром», что и подменённый AODP.
const RAW_TYPES = ['WOOD', 'ORE', 'FIBER', 'HIDE', 'ROCK'];
const REFINED_TYPES = ['PLANKS', 'METALBAR', 'CLOTH', 'LEATHER', 'STONEBLOCK'];
function materialWorldIds() {
  const ids = new Set();
  const addWithEnchants = (base) => {
    ids.add(base);
    const tier = Number(base.match(/^T(\d)_/)[1]);
    if (tier >= 4) for (let e = 1; e <= (base.includes('ROCK') || base.includes('STONEBLOCK') ? 3 : 4); e++) ids.add(`${base}_LEVEL${e}@${e}`);
  };
  for (const rec of Object.values(RECIPES_DATA)) for (const r of rec.resources) ids.add(r.resource);
  for (let tier = 2; tier <= 8; tier++) for (const t of [...RAW_TYPES, ...REFINED_TYPES]) addWithEnchants(`T${tier}_${t}`);
  for (const id of [...ids]) if (/^T\d_(WOOD|ORE|FIBER|HIDE|ROCK|PLANKS|METALBAR|CLOTH|LEATHER|STONEBLOCK)$/.test(id)) addWithEnchants(id);
  for (let tier = 4; tier <= 8; tier++) for (const k of ['RUNE', 'SOUL', 'RELIC']) ids.add(`T${tier}_${k}`);
  return [...ids];
}
const worldPrice = (id) => 100 * (Number((id.match(/^T(\d)_/) || [])[1]) || 4) + 400 * (Number((id.match(/@(\d)$/) || [])[1]) || 0) + 30;
function priceRow(id, price, city) {
  return { item_id: id, city, quality: 1, sell_price_min: price, sell_price_min_date: NOW(), buy_price_max: 1, buy_price_max_date: NOW() };
}
function seedJugWorld() {
  jugDb.exec('DELETE FROM prices');
  jugDb.exec('DELETE FROM history');
  const rows = [];
  for (const id of materialWorldIds()) for (const city of CITIES) rows.push(priceRow(id, worldPrice(id), city));
  upsertPriceSnapshots(jugDb, rows);
}
// Свои цены в кувшине: setJug({ T4_METALBAR: 400 }, { cities: ['Martlock'] }); history — { T4_METALBAR: { avg: 130, count: 600 } } — сделки за последний час.
function setJug(prices, { cities = CITIES, history = {} } = {}) {
  upsertPriceSnapshots(jugDb, Object.entries(prices).flatMap(([id, price]) => cities.map((city) => priceRow(id, price, city))));
  for (const [id, h] of Object.entries(history)) {
    upsertHistoryBatch(jugDb, cities.map((city) => ({ item_id: id, location: city.replace(/\s+/g, ''), quality: 1, data: [{ item_count: h.count, avg_price: h.avg, timestamp: new Date(Date.now() - 3600000).toISOString().slice(0, 19) }] })));
  }
}

// Все материалы мира — по одной цене в выбранных городах (материалы «по 10»)
function setJugAll(price, cities) { setJug(Object.fromEntries(materialWorldIds().map((id) => [id, price])), { cities }); }
const FEE = 1.025;   // комиссия 2.5% за свой Buy Order — входит в цену материалов

// Перед каждым тестом: чистые кэши сервера и «стандартный» подменённый AODP (отдельные тесты ниже подменяют его по-своему).
beforeEach(() => {
  resetCaches();
  seedJugWorld();
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
    const visitor = request.agent(app); // агент держит cookie сессии между вызовами
    let res = await visitor.post('/api/masteries').send({ specializations: { COMBAT_SWORDS_SWORD: 999, NOPE: 5 }, masteries: { COMBAT_SWORDS: 20 } });
    expect(res.body.specializations).toEqual({ COMBAT_SWORDS_SWORD: 200 });
    expect(res.body.masteries).toEqual({ COMBAT_SWORDS: 20 });
    res = await visitor.post('/api/masteries').send({ specializations: { COMBAT_SWORDS_SWORD: 0 }, masteries: { COMBAT_SWORDS: 0 } });
    expect(res.body.specializations).toEqual({});
    expect(res.body.masteries).toEqual({});
  });
  it('заголовки безопасности стоят и на страницах, и на API; по http cookie без Secure', async () => {
    for (const url of ['/', '/api/masteries']) {
      const res = await request(app).get(url);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    }
    expect(String((await request(app).get('/api/masteries')).headers['set-cookie'])).not.toMatch(/Secure/);
  });
  it('первый визит получает cookie сессии (HttpOnly, SameSite=Lax), повторный — нет', async () => {
    const first = await request(app).get('/api/masteries');
    const cookie = String(first.headers['set-cookie']);
    expect(cookie).toMatch(/^sid=[0-9a-f-]{36};/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    const again = await request(app).get('/api/masteries').set('Cookie', cookie.split(';')[0]);
    expect(again.headers['set-cookie']).toBeUndefined();
  });
  it('уровни разных посетителей не смешиваются; поддельный sid заменяется новым', async () => {
    const alice = request.agent(app);
    const bob = request.agent(app);
    await alice.post('/api/masteries').send({ masteries: { COMBAT_SWORDS: 50 } });
    await bob.post('/api/masteries').send({ masteries: { COMBAT_SWORDS: 7 } });
    expect((await alice.get('/api/masteries')).body.levels.masteries).toEqual({ COMBAT_SWORDS: 50 });
    expect((await bob.get('/api/masteries')).body.levels.masteries).toEqual({ COMBAT_SWORDS: 7 });
    const forged = await request(app).get('/api/masteries').set('Cookie', 'sid=../../etc/passwd');
    expect(String(forged.headers['set-cookie'])).toMatch(/^sid=[0-9a-f-]{36};/);
    expect(forged.body.levels).toEqual({ masteries: {}, specializations: {} });
  });
  it('файл старого формата (общие уровни) достаётся первому посетителю и не теряется', async () => {
    fs.writeFileSync(masteriesFile, JSON.stringify({ masteries: { COMBAT_SWORDS: 33 }, specializations: {} }));
    const owner = request.agent(app);
    expect((await owner.get('/api/masteries')).body.levels.masteries).toEqual({ COMBAT_SWORDS: 33 });
    expect(JSON.parse(fs.readFileSync(masteriesFile, 'utf8')).sessions).toBeDefined(); // перенесено в новый формат
    expect((await request(app).get('/api/masteries')).body.levels.masteries).toEqual({}); // чужой посетитель их не видит
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
      expect(res.body.error).toMatch(/не найден рецепт/);
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

describe('Чёрный Рынок: налог', () => {
  // Мок AODP: в городах продажа за 100, на БМ покупка за 1000 — прибыль зависит только от налога БМ.
  function bmFake(url) {
    const u = String(url);
    const ids = decodeURIComponent(u.split('/prices/')[1].split('?')[0]).split(',');
    const now = new Date().toISOString().slice(0, 19);
    const records = [];
    for (const id of ids) {
      records.push({ item_id: id, city: 'Martlock', quality: 1, sell_price_min: 100, sell_price_min_date: now, buy_price_max: 1, buy_price_max_date: now });
      records.push({ item_id: id, city: 'Black Market', quality: 1, sell_price_min: 0, sell_price_min_date: '0001-01-01T00:00:00', buy_price_max: 1000, buy_price_max_date: now });
    }
    return records;
  }
  it('профит считается после 10.5% без премиума и 6.5% с премиумом', async () => {
    const isHistory = (u) => String(u).includes('/history/');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({
      ok: true, status: 200,
      json: async () => (isHistory(url)
        ? decodeURIComponent(String(url).split('/history/')[1].split('?')[0]).split(',').map((id) => ({ item_id: id, location: 'Black Market', data: [{ item_count: 50, avg_price: 1000 }] }))
        : bmFake(url)),
    }));
    const free = (await request(app).get('/api/bm-opportunities?cities=Martlock&premium=false')).body;
    const prem = (await request(app).get('/api/bm-opportunities?cities=Martlock&premium=true')).body;
    expect(free[0].bmTaxRate).toBeCloseTo(0.105, 10);
    expect(free[0].profit).toBeCloseTo(1000 * (1 - 0.105) - 100, 6);
    expect(prem[0].bmTaxRate).toBeCloseTo(0.065, 10);
    expect(prem[0].profit).toBeCloseTo(1000 * (1 - 0.065) - 100, 6);
  });
});

describe('охотничьи плащи', () => {
  const families = ['AVALON', 'DEMON', 'HERETIC', 'KEEPER', 'MORGANA', 'SMUGGLER', 'UNDEAD'];
  it('в каталоге все 7 семейств × T4–T8 со слотом «плащ (охотник)»', async () => {
    const items = (await request(app).get('/api/items')).body;
    const hunter = items.filter((i) => i.slot === 'плащ (охотник)');
    expect(hunter).toHaveLength(35);
    for (const fam of families) {
      expect(hunter.filter((i) => i.id.endsWith(`_CAPEITEM_${fam}`)).map((i) => i.tier).sort()).toEqual([4, 5, 6, 7, 8]);
    }
  });
  it('у Авалонского плаща есть рецепт: обычный плащ + герб + жетон', async () => {
    const res = (await request(app).get('/api/craft-calc?item=T8_CAPEITEM_AVALON')).body;
    expect(res.recipe.map((r) => r.resource)).toEqual(['T8_CAPE', 'T8_CAPEITEM_AVALON_BP', 'QUESTITEM_TOKEN_AVALON']);
    expect(res.recipe.every((r) => r.resourceName && r.resourceName !== r.resource)).toBe(true); // названия есть у всех материалов
  });
  it('примерочная принимает охотничий плащ в слоте плаща', async () => {
    const q = 'weapon=MAIN_SWORD&offhand=OFF_SHIELD&head=HEAD_PLATE_SET1&chest=ARMOR_PLATE_SET1&shoes=SHOES_PLATE_SET1&cape=CAPEITEM_AVALON&targetIP=900&tolMinus=30&tolPlus=100';
    const res = await request(app).get(`/api/fitting-room?${q}`);
    expect(res.status).toBe(200);
    expect(res.body.variants.length).toBeGreaterThan(0);
  });
});

describe('калькулятор крафта: зачарование после крафта', () => {
  const get = (q) => request(app).get(`/api/craft-calc?item=T4_MAIN_SWORD&quantity=10&${q}`);
  it('шаги зачарования: руна и душа, по 288 на вещь для одноручного, себестоимость = база + материалы', async () => {
    const d = (await get('enchant=2&enchantAfterCraft=true')).body;
    const e = d.enchantAfterCraft;
    expect(e.targetLevel).toBe(2);
    expect(e.capped).toBe(false);
    expect(e.steps.map((st) => st.materialId)).toEqual(['T4_RUNE', 'T4_SOUL']);
    expect(e.steps.every((st) => st.count === 288)).toBe(true);
    expect(e.stepsCostPerUnit).toBeCloseTo(e.steps.reduce((sum, st) => sum + st.cheapestPrice * 288, 0), 6);
    expect(d.effectiveCostPerUnit).toBeCloseTo(e.baseCostPerUnit + e.stepsCostPerUnit, 6);
    expect(['craft', 'buy']).toContain(e.baseSource);
  });
  it('.4 не поддерживается: считаем до .3 и помечаем capped', async () => {
    const e = (await get('enchant=4&enchantAfterCraft=true')).body.enchantAfterCraft;
    expect(e.capped).toBe(true);
    expect(e.targetLevel).toBe(3);
    expect(e.steps).toHaveLength(3);
  });
  it('без галочки блока зачарования нет', async () => {
    expect((await get('enchant=2')).body.enchantAfterCraft).toBeNull();
  });
});

describe('калькулятор крафта: сравнение по тирам', () => {
  it('все тиры семейства; T2/T3 считаются без зачарования с пометкой; текущий отмечен', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true, status: 200, json: async () => fakeAodp(url) }));
    const d = (await request(app).get('/api/craft-calc?item=T5_MAIN_SWORD&enchant=2&quantity=1')).body;
    const t = d.tierComparison;
    expect(t.map((r) => r.tier)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(t.filter((r) => r.isCurrent).map((r) => r.itemId)).toEqual(['T5_MAIN_SWORD']);
    expect(t.find((r) => r.tier === 3)).toMatchObject({ enchant: 0, enchantCapped: true });
    expect(t.find((r) => r.tier === 6)).toMatchObject({ enchant: 2, enchantCapped: false });
    const cur = t.find((r) => r.isCurrent);
    expect(cur.cost).toBeCloseTo(d.effectiveCostPerUnit, 6);           // совпадает с основным расчётом
    expect(d.marketShare).toBe(0.25);                                  // доля рынка по умолчанию
    expect(cur.profitPerUnit).toBeCloseTo(cur.netSellPrice - cur.cost, 6);
  });
});

describe('калькулятор крафта: охотничий плащ .3 — только после крафта', () => {
  it('зачарование принудительно после крафта: база .0 + руны/души/реликвии, материалы рецепта без зачарования', async () => {
    const d = (await request(app).get('/api/craft-calc?item=T4_CAPEITEM_AVALON&enchant=3&quantity=10')).body;
    expect(d.enchantAfterCraft.forced).toBe(true);
    expect(d.enchantAfterCraft.steps.map((s) => s.materialId)).toEqual(['T4_RUNE', 'T4_SOUL', 'T4_RELIC']);
    expect(d.recipe.every((r) => r.enchanted === false)).toBe(true);           // обычный плащ .0 + герб + энергия
    expect(d.recipe.map((r) => r.queryId)).toEqual(['T4_CAPE', 'T4_CAPEITEM_AVALON_BP', 'QUESTITEM_TOKEN_AVALON']);
    expect(d.enchantAfterCraft.steps.every((s) => s.count === 96)).toBe(true);
  });
  it('обычный меч .3 без галочки — прямой крафт из зачарованного сырья, блока зачарования нет', async () => {
    const d = (await request(app).get('/api/craft-calc?item=T4_MAIN_SWORD&enchant=3&quantity=10')).body;
    expect(d.enchantAfterCraft).toBeNull();
    expect(d.recipe.every((r) => r.enchanted === true)).toBe(true);
  });
  it('в разбивке материалов есть цены по городам, от дешёвых к дорогим', async () => {
    const d = (await request(app).get('/api/craft-calc?item=T4_MAIN_SWORD&quantity=1')).body;
    const prices = d.recipe[0].cityPrices.map((c) => c.price);
    expect(prices.length).toBeGreaterThan(1);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });
});

describe('калькулятор крафта: потолок и полоса цены (бывший «План крупной партии»)', () => {
  it('без параметров sellPlan нет; с потолком и полосой — проходит ли потолок и профит в полосе после налога', async () => {
    const plain = (await request(app).get('/api/craft-calc?item=T4_MAIN_SWORD&quantity=10')).body;
    expect(plain.sellPlan).toBeNull();
    const d = (await request(app).get('/api/craft-calc?item=T4_MAIN_SWORD&quantity=10&ceiling=1&sellLow=120000&sellHigh=100000')).body;
    const sp = d.sellPlan;
    expect(sp.withinCeiling).toBe(false);                       // потолок 1 серебро — заведомо не проходит
    expect([sp.sellLow, sp.sellHigh]).toEqual([100000, 120000]); // перепутанные границы меняются местами
    expect(sp.profitLow).toBeCloseTo(100000 * 0.92 - d.effectiveCostPerUnit, 6);
    expect(sp.totalHigh).toBeCloseTo((120000 * 0.92 - d.effectiveCostPerUnit) * 10, 6);
  });
});

describe('сканер возможностей: минимальная абсолютная прибыль', () => {
  const now = new Date().toISOString().slice(0, 19);
  it('позиции с прибылью на штуку ниже порога отсекаются, дорогие остаются', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/history/')) {
        const ids = decodeURIComponent(u.split('/history/')[1].split('?')[0]).split(',');
        return { ok: true, status: 200, json: async () => ids.map((id) => ({ item_id: id, location: 'Martlock', quality: 1, data: [{ item_count: 500, avg_price: 100 }] })) };
      }
      const ids = decodeURIComponent(u.split('/prices/')[1].split('?')[0]).split(',');
      // дешёвое сырьё T4_WOOD: 10 → 30 (+200%, но +17 после налога); дорогое T4_MAIN_SWORD: 10000 → 13000
      const rec = (id, city, sell, buy) => ({ item_id: id, city, quality: 1, sell_price_min: sell, sell_price_min_date: now, buy_price_max: buy, buy_price_max_date: now });
      const out = ids.flatMap((id) => (id === 'T4_WOOD' ? [rec(id, 'Martlock', 10, 0), rec(id, 'Lymhurst', 0, 30)]
        : id === 'T4_MAIN_SWORD' ? [rec(id, 'Martlock', 10000, 0), rec(id, 'Lymhurst', 0, 13000)] : []));
      return { ok: true, status: 200, json: async () => out };
    });
    const all = (await request(app).get('/api/opportunities?minProfit=0')).body.map((r) => r.itemId);
    expect(all).toContain('T4_WOOD');
    expect(all).toContain('T4_MAIN_SWORD');
    const filtered = (await request(app).get('/api/opportunities?minProfit=100')).body.map((r) => r.itemId);
    expect(filtered).not.toContain('T4_WOOD');
    expect(filtered).toContain('T4_MAIN_SWORD');
  });
});

describe('калькулятор крафта: возврат ресурсов при закупке', () => {
  const get = (item, extra = '') => request(app).get(`/api/craft-calc?item=${item}&quantity=100&rrr=city_bonus${extra}`);
  it('количество к закупке уменьшено на возврат у обычных материалов и не уменьшено у герба/жетона/плаща', async () => {
    const d = (await get('T4_CAPEITEM_AVALON')).body;
    for (const r of d.recipe) expect(r.neededToBuy).toBe(r.count * 100);             // у охотничьего плаща возвращаемых материалов нет
    expect(d.recipe.every((r) => r.returnable === false)).toBe(true);
    const sword = (await get('T4_MAIN_SWORD')).body;
    for (const r of sword.recipe) {
      expect(r.rrr).toBeGreaterThan(0.15);                                           // у каждого материала своя ставка (город покупки × тип ресурса)
      expect(r.neededToBuy).toBe(Math.ceil(r.count * 100 * (1 - r.rrr)));
    }
    expect(sword.recipe.every((r) => r.returnable === true)).toBe(true);
  });
  it('себестоимость с возвратом = сумма цены × количество × (1 − RRR) по возвращаемым и × 1 по невозвращаемым', async () => {
    const d = (await get('T4_MAIN_SWORD')).body;
    const expected = d.recipe.reduce((sum, r) => sum + r.cheapestPrice * r.count * (1 - r.rrr), 0);
    // в тестовом рынке готовый меч дешевле материалов — для формулы берём именно стоимость крафта из блока «купить или скрафтить»
    expect(d.baseChoice.baseCraftCostPerUnit).toBeCloseTo(expected, 6);
  });
});

describe('калькулятор крафта: цена сырья — средняя по сделкам за своё окно', () => {
  // Материалы — в кувшине: везде по 100, у слитков ещё и история сделок (600 шт по средней 130), если historyForMaterials.
  const install = (historyForMaterials) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/history/')) return { ok: true, status: 200, json: async () => [] };
      const ids = decodeURIComponent(u.split('/prices/')[1].split('?')[0]).split(',');
      return { ok: true, status: 200, json: async () => ids.map((id) => ({ item_id: id, city: 'Martlock', quality: 1, sell_price_min: id === 'T4_MAIN_SWORD' ? 0 : 100, sell_price_min_date: NOW(), buy_price_max: 0, buy_price_max_date: NOW() })) };
    });
    setJugAll(100, ['Martlock']);
    if (historyForMaterials) setJug({ T4_METALBAR: 100 }, { cities: ['Martlock'], history: { T4_METALBAR: { avg: 130, count: 600 } } });
  };
  const get = (extra = '') => request(app).get(`/api/craft-calc?item=T4_MAIN_SWORD&quantity=10&cities=Martlock&gearRrr=none${extra}`);

  it('сырьё с историей сделок — по средней цене за окно (priceSource: history), не по цене одного лота; окно возвращается в ответе', async () => {
    install(true);
    const d = (await get('&materialHours=48')).body;
    const bar = d.recipe.find((r) => r.resource === 'T4_METALBAR');
    expect(bar.priceSource).toBe('history');
    expect(bar.cheapestPrice).toBeCloseTo(130 * FEE, 6);                         // средняя по сделкам 130 + комиссия 2.5% за свой Buy Order
    expect(d.materialHours).toBe(48);
    const leather = d.recipe.find((r) => r.resource === 'T4_LEATHER');
    expect(leather.priceSource).toBe('quote');                                    // сделок нет — текущая котировка, помечено
    expect(leather.cheapestPrice).toBeCloseTo(100 * FEE, 6);
    expect(d.baseChoice.baseCraftCostPerUnit).toBeCloseTo((16 * 130 + 8 * 100) * FEE, 6);
  });

  it('окно по умолчанию — 24 ч и не привязано к «Истории» продажи готового предмета', async () => {
    install(true);
    const d = (await get('&days=7')).body;
    expect(d.materialHours).toBe(24);
  });
});

describe('калькулятор крафта: возврат при крафте гира — ставка выбирается, а не угадывается по городу', () => {
  const get = (extra) => request(app).get(`/api/craft-calc?item=T4_MAIN_SWORD&quantity=100${extra}`);
  it('по умолчанию 24.8% (город с бонусом предмета) у всех возвращаемых материалов; пресеты и своя ставка; невозвращаемое — без возврата', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true, status: 200, json: async () => fakeAodp(url) }));
    const rate = (r) => r.rrr;
    const byDefault = (await get('')).body;
    for (const r of byDefault.recipe) expect(rate(r)).toBeCloseTo(1 - 1 / 1.33, 9);
    expect(byDefault.rrrPreset.rrr).toBeCloseTo(1 - 1 / 1.33, 9);
    expect(byDefault.recipe.every((r) => r.cityBonus === false)).toBe(true);           // «★ бонус города» для гира больше нет
    for (const [id, bonus] of [['none', 0], ['city', 18], ['city_focus', 77], ['city_bonus_focus', 92]]) {
      const d = (await get(`&gearRrr=${id}`)).body;
      for (const r of d.recipe) expect(r.rrr).toBeCloseTo(bonus === 0 ? 0 : 1 - 1 / (1 + bonus / 100), 9);
    }
    const custom = (await get('&gearRrr=none&gearRrrCustom=10')).body;                 // своя ставка главнее пресета
    for (const r of custom.recipe) expect(r.rrr).toBeCloseTo(0.1, 9);
    expect(custom.rrrPreset.label).toContain('своя ставка');
    const capped = (await get('&gearRrrCustom=150')).body;                               // потолок 95%
    expect(capped.recipe[0].rrr).toBeCloseTo(0.95, 9);
    const cape = (await get('&gearRrr=none').then(() => request(app).get('/api/craft-calc?item=T4_CAPEITEM_AVALON&quantity=100&gearRrrCustom=30'))).body;
    expect(cape.recipe.every((r) => r.rrr === 0)).toBe(true);                            // герб, плащ, жетоны не возвращаются никогда
  });
  it('город закупки материала выбирается просто по минимальной цене (возврат от места покупки не зависит)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const ids = decodeURIComponent(String(url).split('/prices/')[1].split('?')[0]).split(',');
      return { ok: true, status: 200, json: async () => ids.flatMap((id) => (id === 'T4_METALBAR'
        ? [{ item_id: id, city: 'Bridgewatch', quality: 1, sell_price_min: 99, sell_price_min_date: NOW(), buy_price_max: 0, buy_price_max_date: NOW() },
           { item_id: id, city: 'Thetford', quality: 1, sell_price_min: 101, sell_price_min_date: NOW(), buy_price_max: 0, buy_price_max_date: NOW() }]
        : [{ item_id: id, city: 'Martlock', quality: 1, sell_price_min: 100, sell_price_min_date: NOW(), buy_price_max: 0, buy_price_max_date: NOW() }])) };
    });
    const d = (await request(app).get('/api/craft-calc?item=T4_MAIN_SWORD&quantity=10&cities=Bridgewatch,Thetford,Martlock&gearRrr=city_bonus')).body;
    expect(d.recipe.find((r) => r.resource === 'T4_METALBAR').cheapestCity).toBe('Bridgewatch');   // 99 < 101, бонус Thetford для гира не действует
  });
  it('настройки возврата гира отдаются в /api/refining-meta для построения списка', async () => {
    const meta = (await request(app).get('/api/refining-meta')).body;
    expect(meta.gearRrrPresets.map((p) => p.id)).toEqual(['none', 'city', 'city_bonus', 'city_focus', 'city_bonus_focus']);
    expect(meta.gearRrrPresets.find((p) => p.id === 'city_bonus').rrr).toBeCloseTo(0.248, 3);
  });
  it('refining-calc: возврат считается в каждом городе отдельно — спец-бонус только в городе своего ресурса', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true, status: 200, json: async () => fakeAodp(url) }));
    const d = (await request(app).get('/api/refining-calc?type=ORE&tier=4&royalBonus=true&focus=false&cities=Thetford,Martlock')).body;
    const rate = (city) => d.perCity.find((c) => c.city === city).rrr;
    expect(rate('Thetford')).toBeCloseTo(1 - 1 / 1.58, 9);       // Thetford — город руды
    expect(rate('Martlock')).toBeCloseTo(1 - 1 / 1.18, 9);       // в Martlock руда получает только базу
    expect(d.rrrLabel).toContain('бонус города: да');
  });
});

describe('калькулятор крафта: галочка «зачаровать после крафта» на предмете без зачарования', () => {
  it('на .0-предмете галочка ничего не меняет; выбор «купить готовый или скрафтить» есть всегда (baseChoice)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true, status: 200, json: async () => fakeAodp(url) }));
    const plain = (await request(app).get('/api/craft-calc?item=T4_MAIN_SWORD&quantity=100&enchant=0')).body;
    const flagged = (await request(app).get('/api/craft-calc?item=T4_MAIN_SWORD&quantity=100&enchant=0&enchantAfterCraft=true')).body;
    expect(flagged.effectiveCostPerUnit).toBe(plain.effectiveCostPerUnit);
    expect(flagged.profitPerUnit).toBe(plain.profitPerUnit);
    expect(plain.enchantAfterCraft).toBeNull();
    expect(flagged.enchantAfterCraft).toBeNull();
    expect(plain.baseChoice).toMatchObject({ targetLevel: 0 });
    expect(plain.baseChoice.steps).toEqual([]);
    // в тестовом рынке готовый меч (≈430) дешевле крафта (≈6500) — берём готовый
    expect(plain.baseChoice.baseSource).toBe('buy');
    expect(plain.effectiveCostPerUnit).toBeCloseTo(plain.baseChoice.baseBuy.price, 6);
    expect(plain.hasAllMaterialPrices).toBe(true);
  });
  it('строка текущего тира в сравнении по тирам совпадает с итогом калькулятора (та же стоимость базы)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true, status: 200, json: async () => fakeAodp(url) }));
    const d = (await request(app).get('/api/craft-calc?item=T4_MAIN_SWORD&quantity=1&enchant=0')).body;
    const cur = d.tierComparison.find((t) => t.isCurrent);
    expect(cur.cost).toBeCloseTo(d.effectiveCostPerUnit, 6);
  });
});

describe('калькулятор крафта: Чёрный Рынок и индекс профита в плане продажи', () => {
  // материалы по 10 (меч = 24 материала → 240), готовый меч не продаётся; история — Martlock и Чёрный Рынок
  const install = () => vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes('/history/')) {
      const ids = decodeURIComponent(u.split('/history/')[1].split('?')[0]).split(',');
      const locs = new URL(u).searchParams.get('locations').split(',');
      const out = [];
      for (const id of ids) {
        if (id !== 'T4_MAIN_SWORD') continue;
        if (locs.includes('Martlock')) out.push({ item_id: id, location: 'Martlock', quality: 1, data: [{ item_count: 700, avg_price: 1000 }] });
        if (locs.includes('BlackMarket')) out.push({ item_id: id, location: 'Black Market', quality: 1, data: [{ item_count: 700, avg_price: 1100 }] });
      }
      return { ok: true, status: 200, json: async () => out };
    }
    const ids = decodeURIComponent(u.split('/prices/')[1].split('?')[0]).split(',');
    const records = ids.flatMap((id) => [{ item_id: id, city: 'Martlock', quality: 1, sell_price_min: id === 'T4_MAIN_SWORD' ? 0 : 10, sell_price_min_date: NOW(), buy_price_max: 0, buy_price_max_date: NOW() }]);
    return { ok: true, status: 200, json: async () => records };
  });
  const get = (extra = '') => request(app).get(`/api/craft-calc?item=T4_MAIN_SWORD&quantity=100&cities=Martlock${extra}`);
  beforeEach(() => setJugAll(10, ['Martlock']));

  it('без галочки ЧР в плане нет; с ней — ещё один «город» со своим налогом 10.5% (налог + Setup Fee), без второго сбора', async () => {
    install();
    const plain = (await get()).body.patientSell;
    expect(plain.byCity.map((c) => c.city)).toEqual(['Martlock']);
    const d = (await get('&blackMarket=true')).body;
    expect(d.blackMarket).toBe(true);
    const bm = d.patientSell.byCity.find((c) => c.blackMarket);
    const martlock = d.patientSell.byCity.find((c) => !c.blackMarket);
    expect(bm.city).toBe('Black Market');
    expect(bm.taxRate).toBeCloseTo(0.105, 9);
    expect(bm.netPrice).toBeCloseTo(1100 * (1 - 0.105), 6);
    expect(martlock.taxRate).toBeCloseTo(0.105, 9);                // у обычного города налог 8% + сбор 2.5% — те же 10.5%
    const premium = (await get('&blackMarket=true&premium=true')).body.patientSell.byCity.find((c) => c.blackMarket);
    expect(premium.taxRate).toBeCloseTo(0.065, 9);                 // с премиумом 4% + 2.5%
  });

  it('индекс профита города = профит% × log2(2 + оборот); план по умолчанию — все прибыльные города, партия по индексу; чистая цена — по налогу каждого', async () => {
    install();
    const d = (await get('&blackMarket=true&premium=true')).body;
    const ps = d.patientSell;
    const cost = d.effectiveCostPerUnit;
    for (const c of ps.byCity) {
      const expectedIndex = ((c.profitPerUnit / cost) * 100) * Math.log2(2 + c.avgDailyVolume);
      expect(c.profitIndex).toBeCloseTo(expectedIndex, 6);
    }
    expect(ps.plan.strategy).toBe('maxProfit');
    expect(ps.plan.cities.reduce((s, c) => s + c.qty, 0)).toBe(100);
    expect(ps.plan.cities.map((c) => c.city).sort()).toEqual(['Black Market', 'Martlock']);
    const planNet = ps.plan.cities.reduce((s, c) => s + c.qty * ps.byCity.find((b) => b.city === c.city).netPrice, 0) / 100;
    expect(ps.plan.netPricePerUnit).toBeCloseTo(planNet, 6);
    expect(ps.plan.profitPerUnit).toBeCloseTo(planNet - cost, 6);
  });
});

describe('калькулятор крафта: мгновенная продажа и Чёрный Рынок', () => {
  // меч продаётся в Buy Order: Martlock 3000, Чёрный Рынок 3300; материалы по 10
  const install = () => vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes('/history/')) return { ok: true, status: 200, json: async () => [] };
    const ids = decodeURIComponent(u.split('/prices/')[1].split('?')[0]).split(',');
    const locs = new URL(u).searchParams.get('locations').split(',');
    const out = [];
    for (const id of ids) {
      const sword = id === 'T4_MAIN_SWORD';
      out.push({ item_id: id, city: 'Martlock', quality: 1, sell_price_min: sword ? 0 : 10, sell_price_min_date: NOW(), buy_price_max: sword ? 3000 : 0, buy_price_max_date: NOW() });
      if (sword && locs.includes('BlackMarket')) out.push({ item_id: id, city: 'Black Market', quality: 1, sell_price_min: 0, sell_price_min_date: NOW(), buy_price_max: 3300, buy_price_max_date: NOW() });
    }
    return { ok: true, status: 200, json: async () => out };
  });
  const get = (extra = '') => request(app).get(`/api/craft-calc?item=T4_MAIN_SWORD&quantity=10&cities=Martlock${extra}`);
  beforeEach(() => setJugAll(10, ['Martlock']));

  it('без галочки ЧР мгновенная продажа — только обычные города; с галочкой — лучшая цена ПОСЛЕ налога, с пометкой и своей ставкой', async () => {
    install();
    const plain = (await get()).body;
    expect(plain.bestSell).toMatchObject({ city: 'Martlock', price: 3000, blackMarket: false });
    expect(plain.netSellPrice).toBeCloseTo(3000 * 0.92, 6);
    const withBm = (await get('&blackMarket=true')).body;
    expect(withBm.bestSell).toMatchObject({ city: 'Black Market', price: 3300, blackMarket: true });
    expect(withBm.bestSell.taxRate).toBeCloseTo(0.105, 9);
    expect(withBm.netSellPrice).toBeCloseTo(3300 * (1 - 0.105), 6);          // 2953.5 > 2760
    expect(withBm.sellPrices.map((p) => p.city)).toEqual(['Martlock', 'Black Market']);
    expect(withBm.profitPerUnit).toBeGreaterThan(plain.profitPerUnit);
  });

  it('ЧР с более высокой ценой, но большим налогом не выигрывает у города, где «на руки» больше', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/history/')) return { ok: true, status: 200, json: async () => [] };
      const ids = decodeURIComponent(u.split('/prices/')[1].split('?')[0]).split(',');
      return { ok: true, status: 200, json: async () => ids.flatMap((id) => {
        const sword = id === 'T4_MAIN_SWORD';
        return [
          { item_id: id, city: 'Martlock', quality: 1, sell_price_min: sword ? 0 : 10, sell_price_min_date: NOW(), buy_price_max: sword ? 3000 : 0, buy_price_max_date: NOW() },
          ...(sword ? [{ item_id: id, city: 'Black Market', quality: 1, sell_price_min: 0, sell_price_min_date: NOW(), buy_price_max: 3050, buy_price_max_date: NOW() }] : []),
        ];
      }) };
    });
    const d = (await get('&blackMarket=true')).body;                          // ЧР: 3050·0.895 = 2729.75 < Martlock: 3000·0.92 = 2760
    expect(d.bestSell).toMatchObject({ city: 'Martlock', blackMarket: false });
    expect(d.netSellPrice).toBeCloseTo(2760, 6);
  });
});

describe('план продажи «максимизировать профит»: maxProfitCityAllocation', () => {
  const { maxProfitCityAllocation } = require('../server.js');
  const city = (name, vol, profit, index) => ({ city: name, avgPrice: 1000, avgDailyVolume: vol, profitPerUnit: profit, profitIndex: index });
  it('партию первым берёт лучший ИНДЕКС (а не лучшая маржа), но не больше разумной вместимости; сумма = партия', () => {
    const plan = maxProfitCityAllocation([city('A', 20, 2000, 200), city('B', 10, 500, 300), city('C', 10, 1000, 100)], 100, { marketShare: 1 });
    const q = Object.fromEntries(plan.cities.map((c) => [c.city, c.qty]));
    expect(q).toEqual({ B: 37, A: 63 });                          // вместимость B = 10·2.5·1.5 = 37, остальное — A (вместимость 75)
    expect(plan.cities.reduce((s, c) => s + c.qty, 0)).toBe(100);
    expect(plan.excluded.map((e) => e.city)).toEqual(['C']);
  });
  it('тонкий рынок (меньше 1 сделки в день или <2% от самого ликвидного) в план не входит', () => {
    const plan = maxProfitCityAllocation([city('A', 300, 100, 50), city('B', 0.5, 5000, 999), city('C', 5, 100, 10)], 100, { marketShare: 1 });
    expect(plan.cities.map((c) => c.city)).not.toContain('B');
    expect(plan.cities.map((c) => c.city)).not.toContain('C');   // 5 < 2% от 300 = 6
    expect(plan.excluded.find((e) => e.city === 'B').reason).toMatch(/тонкий/);
  });
  it('если все города тонкие — план не пустой: берётся самый ликвидный', () => {
    const plan = maxProfitCityAllocation([city('A', 0.4, 100, 5), city('B', 0.8, 100, 5)], 10, { marketShare: 1 });
    expect(plan.cities.map((c) => c.city)).toEqual(['B']);
    expect(plan.cities[0].qty).toBe(10);
  });
  it('нет городов с оборотом — пустой план без падения', () => {
    expect(maxProfitCityAllocation([city('A', 0, 100, 5)], 10).cities).toEqual([]);
  });
});

describe('калькулятор крафта: многогородовой план', () => {
  it('план закупки по материалам и план продажи есть в ответе, допуск возвращается', async () => {
    const d = (await request(app).get('/api/craft-calc?item=T4_MAIN_SWORD&quantity=100&priceTolerance=8')).body;
    expect(d.priceTolerance).toBeCloseTo(0.08, 6);
    if (d.acquire) {
      for (const r of d.acquire.byResource) if (r.plan) {
        expect(r.plan.cities.reduce((sum, c) => sum + c.qty, 0)).toBe(r.needed);
        expect(r.plan.cities.every((c) => c.tolerance >= 0.08)).toBe(true);
      }
    }
    if (d.patientSell && d.patientSell.plan && d.patientSell.plan.cities.length) {
      expect(d.patientSell.plan.cities.reduce((sum, c) => sum + c.qty, 0)).toBe(100);
    }
  });
});

describe('свои значения: период истории и допуск цены', () => {
  it('период истории можно задать своим (дни 0.5–30), допуск по умолчанию 2%', async () => {
    const d = (await request(app).get('/api/craft-calc?item=T4_MAIN_SWORD&quantity=10&days=10')).body;
    expect(d.patientSell === null || d.patientSell.days === 10).toBe(true);
    expect(d.priceTolerance).toBeCloseTo(0.02, 6);
    const clamped = (await request(app).get('/api/craft-calc?item=T4_MAIN_SWORD&quantity=10&days=999')).body;
    expect(clamped.patientSell === null || clamped.patientSell.days === 30).toBe(true);
  });
  it('часы для сканеров тоже свои: 1–720', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true, status: 200, json: async () => (String(url).includes('/history/') ? [] : fakeAodp(url)) }));
    const res = await request(app).get('/api/enchant-opportunities?hours=48&cities=Martlock');
    expect(res.status).toBe(200);
  });
});

describe('калькулятор крафта: купить готовый материал или переработать самому', () => {
  // Сырьё и предыдущий тир по 100; готовый слиток T4 — по параметру. Переработка: 2×руда + 1×слиток T3 = 300 × (1 − ставка).
  const install = (barPrice) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/history/')) return { ok: true, status: 200, json: async () => [] };
      const ids = decodeURIComponent(u.split('/prices/')[1].split('?')[0]).split(',');
      return { ok: true, status: 200, json: async () => ids.map((id) => ({ item_id: id, city: 'Martlock', quality: 1, sell_price_min: id === 'T4_MAIN_SWORD' ? 0 : 100, sell_price_min_date: NOW(), buy_price_max: 0, buy_price_max_date: NOW() })) };
    });
    setJugAll(100, ['Martlock']);
    setJug({ T4_METALBAR: barPrice }, { cities: ['Martlock'] });
  };
  const get = (extra = '') => request(app).get(`/api/craft-calc?item=T4_MAIN_SWORD&quantity=10&cities=Martlock&gearRrr=none${extra}`);
  const bar = (d) => d.recipe.find((r) => r.resource === 'T4_METALBAR');

  it('слиток дорогой (400) — выгоднее переработать: цена 300 × (1 − 36.7%), источник refine, компоненты и цена покупки в ответе', async () => {
    install(400);
    const d = (await get()).body;
    expect(d.refineRate).toBeCloseTo(0.367, 3);
    expect(bar(d)).toMatchObject({ materialSource: 'refine', priceSource: 'refine' });
    expect(bar(d).buyPrice).toBeCloseTo(400 * FEE, 6);
    expect(bar(d).cheapestPrice).toBeCloseTo(300 * FEE * (1 - 0.367), 1);          // 2 × 100 + 1 × 100, комиссия 2.5%, возврат переработки
    expect(bar(d).refineOption.components.map((c) => c.id)).toEqual(['T4_ORE', 'T3_METALBAR']);
    expect(d.baseChoice.baseCraftCostPerUnit).toBeCloseTo((16 * 300 * (1 - 0.367) + 8 * 100) * FEE, 0);
  });
  it('слиток дешёвый (150) — покупаем готовый, но вариант переработки отдаётся для пересчёта в интерфейсе', async () => {
    install(150);
    const d = (await get()).body;
    expect(bar(d)).toMatchObject({ materialSource: 'buy', buyCity: 'Martlock' });
    expect(bar(d).cheapestPrice).toBeCloseTo(150 * FEE, 6);
    expect(bar(d).refineOption.price).toBeCloseTo(300 * FEE * (1 - 0.367), 1);
  });
  it('своя ставка переработки меняет решение: 0% — переработка стоит 300 и проигрывает покупке за 250; 50% — 150 и выигрывает', async () => {
    install(250);
    expect(bar((await get('&refineRrrCustom=0')).body).materialSource).toBe('buy');
    const half = (await get('&refineRrrCustom=50')).body;
    expect(half.refineRate).toBe(0.5);
    expect(bar(half)).toMatchObject({ materialSource: 'refine' });
    expect(bar(half).cheapestPrice).toBeCloseTo(150 * FEE, 6);
  });
  it('пресет ставки переработки: none — без возврата', async () => {
    install(250);
    const d = (await get('&refineRrr=none')).body;
    expect(d.refineRate).toBe(0);
    expect(bar(d).materialSource).toBe('buy');
  });
  it('план закупки: при переработке вместо готового слитка — сырьё и материал предыдущего тира в количестве «без остатка» (нужно × состав × (1 − возврат переработки))', async () => {
    install(400);
    const d = (await get()).body;
    const rows = d.acquire.byResource.filter((r) => r.parent === 'T4_METALBAR');
    expect(rows.map((r) => [r.queryId, r.role, r.source])).toEqual([['T4_ORE', 'raw', 'refine'], ['T3_METALBAR', 'prev', 'refine']]);
    expect(rows[0].needed).toBe(Math.ceil(160 * 2 * (1 - d.refineRate)));      // 16 слитков × 10 шт, без возврата гира (gearRrr=none)
    expect(rows[1].needed).toBe(Math.ceil(160 * 1 * (1 - d.refineRate)));
    expect(rows[0].resourceName).toBe('T4 Руда (IV) (сырьё → T4 Слитки (IV))');    // строка называется по тому, что реально покупается, а не по целевому полуфабрикату
    expect(rows[1].resourceName).toBe('T3 Слитки (III) (полуфабрикат пред. тира → T4 Слитки (IV))');
    expect(d.acquire.byResource.some((r) => r.resource === 'T4_METALBAR')).toBe(false);   // готового слитка в плане нет
  });
  it('план закупки: если дешевле готовый — одна строка на сам материал', async () => {
    install(150);
    const rows = (await get()).body.acquire.byResource.filter((r) => r.parent === 'T4_METALBAR');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ resource: 'T4_METALBAR', source: 'buy', needed: 160 });
  });
  it('у невозвращаемых и нерафинируемых материалов (герб, жетон) вариант переработки не строится', async () => {
    install(400);
    const d = (await get()).body;
    expect(d.recipe.filter((r) => !/METALBAR|LEATHER|PLANKS|CLOTH|STONEBLOCK/.test(r.resource)).every((r) => r.refineOption === null || r.refineOption === undefined)).toBe(true);
  });
});

describe('GET /api/item-groups — группы оружия по игровой классификации', () => {
  it('«Лук», «Боевой лук» и «Длинный лук» — одна группа «Луки»; каждое семейство оружия ровно в одной группе', async () => {
    const { weapon } = (await request(app).get('/api/item-groups')).body;
    const bows = weapon.find((g) => g.id === 'COMBAT_BOWS');
    expect(bows.title).toBe('Луки');
    expect(bows.families).toEqual(expect.arrayContaining(['2H_BOW', '2H_WARBOW', '2H_LONGBOW']));
    expect(weapon.find((g) => g.id === 'COMBAT_SWORDS').families).toEqual(expect.arrayContaining(['MAIN_SWORD', '2H_CLAYMORE', '2H_DUALSWORD']));
    const all = weapon.flatMap((g) => g.families);
    expect(new Set(all).size).toBe(all.length);                                         // семейство не лежит в двух группах
    const { ITEMS } = require('../data/items');
    const families = new Set(ITEMS.filter((i) => i.category === 'weapon').map((i) => i.id.replace(/^T\d+_/, '')));
    expect(new Set(all)).toEqual(families);                                             // всё оружие каталога куда-то попало
    expect(weapon).toHaveLength(20);
  });
});

describe('калькулятор крафта: цена материала в заголовке = цена в плане закупки (многогород + комиссия)', () => {
  it('партия больше оборота дешёвого города: заголовочная цена — средняя по плану из нескольких городов с комиссией, и она ровно совпадает с ценой плана закупки', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true, status: 200, json: async () => (String(url).includes('/history/') ? [] : fakeAodp(url).map((r) => ({ ...r, sell_price_min: r.item_id === 'T4_MAIN_SWORD' ? 0 : r.sell_price_min }))) }));
    setJugAll(50, ['Martlock', 'Lymhurst']);
    setJug({ T4_METALBAR: 100 }, { cities: ['Martlock'], history: { T4_METALBAR: { avg: 100, count: 5000 } } });    // дёшево, но рынок втрое-вдесятеро тоньше
    setJug({ T4_METALBAR: 108 }, { cities: ['Lymhurst'], history: { T4_METALBAR: { avg: 108, count: 60000 } } });   // чуть дороже, зато оборот огромный
    const res = (await request(app).get('/api/craft-calc?item=T4_MAIN_SWORD&quantity=500&cities=Martlock,Lymhurst&gearRrr=none&refineRrr=none&marketShare=0.25&priceTolerance=10')).body;
    const bar = res.recipe.find((r) => r.resource === 'T4_METALBAR');
    const row = res.acquire.byResource.find((r) => r.resource === 'T4_METALBAR');
    expect(bar.materialSource).toBe('buy');
    expect(row.plan.cities.length).toBe(2);                                          // в один город партию не купить — план разносит по двум
    expect(row.plan.avgPrice).toBeGreaterThan(100 * 1.025);                          // средняя дороже самого дешёвого города
    expect(bar.cheapestPrice).toBeCloseTo(row.plan.avgPrice, 6);                     // заголовок и план — одна и та же цифра, не «близкая»
  });
});
