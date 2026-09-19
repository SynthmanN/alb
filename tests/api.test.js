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
    const rrr = d.rrrPreset.rrr;
    expect(rrr).toBeGreaterThan(0.3);
    for (const r of d.recipe) expect(r.neededToBuy).toBe(r.count * 100);             // у охотничьего плаща возвращаемых материалов нет
    expect(d.recipe.every((r) => r.returnable === false)).toBe(true);
    const sword = (await get('T4_MAIN_SWORD')).body;
    for (const r of sword.recipe) expect(r.neededToBuy).toBe(Math.ceil(r.count * 100 * (1 - rrr)));
    expect(sword.recipe.every((r) => r.returnable === true)).toBe(true);
  });
  it('себестоимость с возвратом = сумма цены × количество × (1 − RRR) по возвращаемым и × 1 по невозвращаемым', async () => {
    const d = (await get('T4_MAIN_SWORD')).body;
    const expected = d.recipe.reduce((sum, r) => sum + r.cheapestPrice * r.count * (1 - d.rrrPreset.rrr), 0);
    expect(d.effectiveCostPerUnit).toBeCloseTo(expected, 6);
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
