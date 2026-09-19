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
const { app, resetCaches } = require('../server.js');

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

// Перед каждым тестом: чистые кэши сервера и «стандартный» подменённый AODP (отдельные тесты ниже подменяют его по-своему).
beforeEach(() => {
  resetCaches();
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

describe('сканер крафта: качество готового предмета', () => {
  const now = new Date().toISOString().slice(0, 19);
  const isHistory = (u) => String(u).includes('/history/');
  it('берёт лучшее качество по ликвидности: у Обычного нет сделок, у Отличного есть', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (isHistory(u)) {
        const ids = decodeURIComponent(u.split('/history/')[1].split('?')[0]).split(',');
        return { ok: true, status: 200, json: async () => ids.flatMap((id) => [
          { item_id: id, location: 'Martlock', quality: 1, data: [] },
          { item_id: id, location: 'Martlock', quality: 4, data: [{ item_count: 500, avg_price: 1000 }] },
        ]) };
      }
      const ids = decodeURIComponent(u.split('/prices/')[1].split('?')[0]).split(',');
      const qualities = (new URL(u).searchParams.get('qualities') || '1').split(',').map(Number);
      const records = ids.flatMap((id) => qualities.map((quality) => ({
        item_id: id, city: 'Martlock', quality,
        sell_price_min: 1, sell_price_min_date: now,           // материалы стоят по 1 — себестоимость ничтожна
        buy_price_max: id.includes('_MAIN_SWORD') ? 1000 : 0, buy_price_max_date: now,
      })));
      return { ok: true, status: 200, json: async () => records };
    });
    const res = (await request(app).get('/api/craft-opportunities?hours=24&cities=Martlock')).body;
    const sword = res.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(sword).toBeTruthy();
    expect(sword.quality).toBe(4); // Обычное (1) тоже «продаётся» по цене, но объёма у него нет — оно отсеивается
    expect(sword.volume).toBe(500);
    expect(res.filter((r) => r.itemId === 'T4_MAIN_SWORD')).toHaveLength(1); // одна строка на предмет
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
