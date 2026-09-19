// Аудит честности калькулятора крафта и объединённого скана маржи и ликвидности (читает кувшин).
// Запуск: npm run audit:craft (отдельно от обычного npm test).
//
// Методика — независимые слои, каждый ловит свой класс ошибок:
//  1. Золотые числа: ожидаемые значения считаются в тесте вручную, без обращения к формулам сервера.
//  2. Сверка инструментов: строка объединённого скана (кувшин) и калькулятор (живой AODP) по тем же параметрам обязаны дать одну и ту же себестоимость и профит.
//  3. Свойства: то, что должно выполняться при любых ценах рынка (знак профита, сумма плана, монотонность).
//  4. Ролевой цикл: скан → калькулятор → план продажи → «конкурент сбил цену» → пересчёт; обещанный профит = реализованному.
//  5. Стресс-кейсы: нет ликвидности, убыток, охотничьи плащи, разные количества.
// Рынок AODP подменён детерминированными данными: результат не зависит от живых цен.
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

const require = createRequire(import.meta.url);
process.env.USER_MASTERIES_PATH = path.join(os.tmpdir(), `albion-audit-masteries-${process.pid}.json`);
process.env.DISABLE_RATE_LIMIT = 'true';
process.env.JUG_DB_PATH = ':memory:';
process.env.AODP_RATE_PER_MINUTE = '1000000'; // подменённый AODP не ждёт очереди в регуляторе бюджета
const { app, resetCaches, returnFactor, jugDb } = require('../server.js');
const { crawlPricesOnce, crawlHistoryOnce } = require('../lib/jugCrawler.js');
const RECIPES = require('../data/recipes.json');
const TRAVEL_WEIGHTS = require('../data/travel-weights.json');

const ITEM = 'T4_MAIN_SWORD';
const TAX = 0.08;
const FEE = 0.025;
const CITIES = ['Fort Sterling', 'Bridgewatch', 'Lymhurst', 'Martlock', 'Thetford'];
const NOW = () => new Date().toISOString().slice(0, 19);

// --- Детерминированный рынок ---------------------------------------------------------------------------------------
// materialPrice: цена любого материала (sell_price_min во всех городах); history: id -> город -> { price, dailyVolume }.
// Записи цен и ряды истории детерминированного рынка (общие для подменённого fetch и для прогрева кувшина).
function marketPrices(market, ids, qualities) {
  const records = [];
  for (const id of ids) {
    for (const city of CITIES) {
      for (const quality of qualities) {
        const sells = market.finished[id]?.[city];
        // Готовый гир без записи в market.finished в этом городе не продаётся вовсе (иначе калькулятор «купил бы» его по цене материала).
        const noOffer = !sells && RECIPES[id];
        records.push({
          item_id: id, city, quality,
          sell_price_min: sells ? sells.price * 1.05 : noOffer ? 0 : market.materialPrice, sell_price_min_date: NOW(),
          buy_price_max: sells ? sells.price * 0.9 : 0, buy_price_max_date: NOW(),
        });
      }
    }
  }
  return records;
}
const TODAY_TS = () => `${new Date().toISOString().slice(0, 10)}T00:00:00`;
function marketHistory(market, ids, { materials = false } = {}) {
  const out = [];
  for (const id of ids) {
    for (const [city, m] of Object.entries(market.finished[id] || {})) {
      out.push({ item_id: id, location: city, quality: 1, data: [{ item_count: m.dailyVolume * 7, avg_price: m.price, timestamp: TODAY_TS() }] });
    }
    // Материалы кувшина: оборот огромный (закупка не узкое место), цена — рыночная; в живом AODP-моке истории материалов нет.
    if (materials && !market.finished[id]) {
      for (const city of CITIES) out.push({ item_id: id, location: city, quality: 1, data: [{ item_count: 7_000_000, avg_price: market.materialPrice, timestamp: TODAY_TS() }] });
    }
  }
  return out;
}

let currentMarket = { materialPrice: 100, finished: {} };
// finished: { [itemId@ench]: { [city]: { price, dailyVolume } } } — сделки за 7 дней (объём/день × 7 в истории)
function installMarket({ materialPrice = 100, finished = {} }) {
  currentMarket = { materialPrice, finished };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes('/history/')) {
      const ids = decodeURIComponent(u.split('/history/')[1].split('?')[0]).split(',');
      return { ok: true, status: 200, json: async () => marketHistory(currentMarket, ids).map(({ data, ...rest }) => ({ ...rest, data: data.map(({ timestamp, ...p }) => p) })) };
    }
    const ids = decodeURIComponent(u.split('/prices/')[1].split('?')[0]).split(',');
    const qualities = (new URL(u).searchParams.get('qualities') || '1').split(',').map(Number);
    return { ok: true, status: 200, json: async () => marketPrices(currentMarket, ids, qualities) };
  });
}

// Объединённый скан читает кувшин: прогреваем его тем же детерминированным рынком через настоящие функции краулера.
async function warmJug() {
  jugDb.exec('DELETE FROM prices');
  jugDb.exec('DELETE FROM history');
  const ids = [ITEM, ...RECIPES[ITEM].resources.map((r) => r.resource)];
  await crawlPricesOnce({ db: jugDb, ids, fetchPrices: async (chunk) => marketPrices(currentMarket, chunk, [1, 2, 3, 4, 5]) });
  await crawlHistoryOnce({ db: jugDb, ids, fetchHistory: async (chunk) => marketHistory(currentMarket, chunk, { materials: true }) });
  resetCaches();
}
beforeEach(() => resetCaches());

const recipe = RECIPES[ITEM];
// себестоимость меча вручную: Σ цена материала × количество (RRR 0, серебра в рецепте нет)
const costByHand = (price) => recipe.resources.reduce((sum, r) => sum + price * r.count, 0) + (recipe.silver || 0);

describe('1. золотые числа калькулятора (считаем на бумаге)', () => {
  it('себестоимость = Σ цена × количество; продажа в Sell Order — после налога 8% и сбора 2.5%', async () => {
    const cost = costByHand(100);                                                    // 24 материала × 100
    expect(cost).toBe(2400);
    installMarket({ materialPrice: 100, finished: { [ITEM]: { Lymhurst: { price: 4000, dailyVolume: 10 } } } });
    const d = (await request(app).get(`/api/craft-calc?item=${ITEM}&quantity=100&cities=${CITIES.join(',')}`)).body;
    expect(d.effectiveCostPerUnit).toBeCloseTo(cost, 6);
    expect(d.patientSell.avgSellPrice).toBeCloseTo(4000, 6);
    expect(d.patientSell.netSellPrice).toBeCloseTo(4000 * (1 - TAX - FEE), 6);      // 3580
    expect(d.patientSell.profitPerUnit).toBeCloseTo(3580 - 2400, 6);                 // 1180
    expect(d.patientSell.daysToSellBatch).toBeCloseTo(100 / (10 * 0.25), 6);         // 100 шт при 10 в день × доле рынка 25%
  });
  it('возврат RRR уменьшает закупку и цену только возвращаемых материалов', async () => {
    installMarket({ materialPrice: 100 });
    const d = (await request(app).get(`/api/craft-calc?item=T4_CAPEITEM_AVALON&quantity=100&rrr=city_bonus`)).body;
    for (const r of d.recipe) expect(r.neededToBuy).toBe(Math.ceil(r.count * 100 * returnFactor(RECIPES.T4_CAPEITEM_AVALON.resources.find((x) => x.resource === r.resource), d.rrrPreset.rrr)));
  });
});

describe('2. находка: профит не считается наивным средним по убыточным городам', () => {
  it('меч T4: объёмный убыточный рынок не переворачивает знак профита прибыльного', async () => {
    installMarket({
      materialPrice: 100,
      finished: { [ITEM]: { Martlock: { price: 1500, dailyVolume: 200 }, Lymhurst: { price: 4000, dailyVolume: 10 } } }, // Martlock: убыток
    });
    const d = (await request(app).get(`/api/craft-calc?item=${ITEM}&quantity=1000&cities=${CITIES.join(',')}`)).body;
    const naive = d.patientSell.marketAvgPrice * (1 - TAX - FEE) - d.effectiveCostPerUnit;
    expect(naive).toBeLessThan(0);                                       // так «врал» наивный расчёт: минус
    expect(d.patientSell.profitPerUnit).toBeGreaterThan(0);              // честный план: продаём только в Lymhurst
    expect(d.patientSell.planCities).toEqual(['Lymhurst']);
    expect(d.patientSell.skippedCities).toEqual(['Martlock']);
    expect(d.patientSell.daysToSellBatch).toBeCloseTo(1000 / (10 * 0.25), 6);   // срок — по обороту ПРИБЫЛЬНЫХ городов
  });
  it('то же честное правило — в «Сравнении по качеству» и «Сравнении по тирам»', async () => {
    installMarket({ materialPrice: 100, finished: { [ITEM]: { Martlock: { price: 1500, dailyVolume: 200 }, Lymhurst: { price: 4000, dailyVolume: 10 } } } });
    const d = (await request(app).get(`/api/craft-calc?item=${ITEM}&quantity=1000`)).body;
    const q1 = d.qualityComparison.find((q) => q.quality === 1);
    expect(q1.profitPerUnit).toBeCloseTo(d.patientSell.profitPerUnit, 6);
    expect(q1.avgDailyVolume).toBe(10);
    const cur = d.tierComparison.find((t) => t.isCurrent);
    expect(cur.patient.profitPerUnit).toBeCloseTo(d.patientSell.profitPerUnit, 6);
  });
});

describe('3. находка: скан маржи не завышает дневной профит (весь оборот ≠ прибыльный оборот)', () => {
  it('dailyProfit считается только по обороту прибыльных городов', async () => {
    installMarket({
      materialPrice: 100,
      finished: { [ITEM]: { Martlock: { price: 1500, dailyVolume: 200 }, Lymhurst: { price: 4000, dailyVolume: 10 } } },
    });
    await warmJug();
    const scan = (await request(app).get(`/api/unified-scan?mode=patient&category=weapon&days=7&liquidity=sum&marketShare=1&minDaily=1&quantity=100&cities=${CITIES.join(',')}`)).body;
    const row = scan.results.find((r) => r.itemId === ITEM && r.enchant === 0);
    expect(row).toBeTruthy();
    const netUnit = 4000 * (1 - TAX - FEE) - 2400;                      // прибыльный только Lymhurst
    expect(row.profitPerUnit).toBeCloseTo(netUnit, 6);
    expect(row.dailyVolume).toBe(10);                                   // оборот прибыльных городов
    expect(row.marketDailyVolume).toBe(210);                            // весь оборот — только справочно
    expect(row.dailyProfit).toBeCloseTo(netUnit * 10, 6);               // а не netUnit × 210 (завышение в 21 раз)
  });
});

describe('4. сверка инструментов: скан маржи ↔ калькулятор', () => {
  it('строка скана и калькулятор по тем же параметрам дают одинаковые себестоимость и профит', async () => {
    installMarket({
      materialPrice: 250,
      finished: { [ITEM]: { Thetford: { price: 9000, dailyVolume: 30 }, Bridgewatch: { price: 8000, dailyVolume: 20 } } },
    });
    await warmJug();
    const scan = (await request(app).get(`/api/unified-scan?mode=patient&category=weapon&days=7&liquidity=sum&minDaily=1&quantity=100&cities=${CITIES.join(',')}`)).body;
    const row = scan.results.find((r) => r.itemId === ITEM && r.enchant === 0);
    expect(row).toBeTruthy();
    const calc = (await request(app).get(`/api/craft-calc?item=${ITEM}&quantity=100&quality=${row.quality}&days=7&cities=${CITIES.join(',')}`)).body;
    expect(calc.effectiveCostPerUnit).toBeCloseTo(row.cost, 6);
    expect(calc.patientSell.avgSellPrice).toBeCloseTo(row.avgSellPrice, 6);
    expect(calc.patientSell.profitPerUnit).toBeCloseTo(row.profitPerUnit, 6);
    expect(calc.patientSell.avgDailyVolume).toBeCloseTo(row.dailyVolume, 6);
  });
});

describe('5. телепорт: нет молчаливых нулей', () => {
  it('для каждого материала каждого рецепта и каждого готового предмета в базе есть вес', () => {
    const missing = [];
    for (const [id, r] of Object.entries(RECIPES)) {
      if (!TRAVEL_WEIGHTS[id]) missing.push(id);
      for (const m of r.resources) if (!TRAVEL_WEIGHTS[m.resource]) missing.push(m.resource);
    }
    expect([...new Set(missing)]).toEqual([]);
  });
  it('материал без веса перечисляется в teleport.unweighted, а не считается бесплатным молча', async () => {
    installMarket({ materialPrice: 100, finished: { [ITEM]: { Lymhurst: { price: 4000, dailyVolume: 10 } } } });
    const saved = TRAVEL_WEIGHTS.T4_LEATHER;
    delete TRAVEL_WEIGHTS.T4_LEATHER;                                    // имитируем «данных о весе нет»
    try {
      const d = (await request(app).get(`/api/craft-calc?item=${ITEM}&quantity=10&teleport=true&cities=${CITIES.join(',')}`)).body;
      expect(d.teleport.unweighted).toContain('T4 Кожа (IV)');
      expect(d.teleport.materialLegs.map((l) => l.resource)).not.toContain('T4_LEATHER');
    } finally { TRAVEL_WEIGHTS.T4_LEATHER = saved; }
  });
});

describe('6. Setup Fee: свой ордер стоит 2.5% сверх налога', () => {
  it('во всех терпеливых расчётах чистая цена = цена × (1 − налог − 2.5%); с премиумом налог 4%', async () => {
    installMarket({ materialPrice: 100, finished: { [ITEM]: { Lymhurst: { price: 10000, dailyVolume: 10 } } } });
    const free = (await request(app).get(`/api/craft-calc?item=${ITEM}&quantity=10&cities=${CITIES.join(',')}`)).body;
    const prem = (await request(app).get(`/api/craft-calc?item=${ITEM}&quantity=10&premium=true&cities=${CITIES.join(',')}`)).body;
    expect(free.patientSell.netSellPrice).toBeCloseTo(10000 * (1 - 0.08 - 0.025), 6);
    expect(prem.patientSell.netSellPrice).toBeCloseTo(10000 * (1 - 0.04 - 0.025), 6);
    expect(free.setupFeeRate).toBe(0.025);
  });
});

describe('7. ролевой цикл: скан → калькулятор → план → «конкурент сбил цену» → пересчёт', () => {
  const market = (lymhurstPrice) => ({
    materialPrice: 150,                                                  // себестоимость меча 3600 — все три города прибыльны
    finished: { [ITEM]: { Lymhurst: { price: lymhurstPrice, dailyVolume: 40 }, Martlock: { price: 7000, dailyVolume: 20 }, Thetford: { price: 6800, dailyVolume: 20 } } },
  });
  const realized = (plan, prices, cost) => plan.reduce((sum, c) => sum + c.qty * (prices[c.city] * (1 - TAX - FEE) - cost), 0);

  it('обещанный профит плана = реализованному по тем же ценам; после «перебивания» цены пересчёт совпадает с реализованным', async () => {
    installMarket(market(8000));
    await warmJug();
    const scan = (await request(app).get(`/api/unified-scan?mode=patient&category=weapon&days=7&minDaily=1&quantity=400&cities=${CITIES.join(',')}`)).body;
    const pick = scan.results.find((r) => r.itemId === ITEM && r.enchant === 0);
    expect(pick).toBeTruthy();                                            // игрок выбрал находку в скане

    let calc = (await request(app).get(`/api/craft-calc?item=${ITEM}&quantity=400&quality=${pick.quality}&priceTolerance=20&cities=${CITIES.join(',')}`)).body;
    const cost = calc.effectiveCostPerUnit;
    let plan = calc.patientSell.plan;
    expect(plan.cities.reduce((s, c) => s + c.qty, 0)).toBe(400);         // сумма плана = партия
    const promised = plan.avgPrice * (1 - TAX - FEE) * 400 - cost * 400;
    expect(realized(plan.cities, { Lymhurst: 8000, Martlock: 7000, Thetford: 6800 }, cost)).toBeCloseTo(promised, 4);

    // Конкурент сбил цену в Lymhurst на 25%: игрок открывает калькулятор снова и получает новый план
    resetCaches();
    installMarket(market(6000));
    calc = (await request(app).get(`/api/craft-calc?item=${ITEM}&quantity=400&quality=${pick.quality}&priceTolerance=20&cities=${CITIES.join(',')}`)).body;
    plan = calc.patientSell.plan;
    const prices = { Lymhurst: 6000, Martlock: 7000, Thetford: 6800 };
    const promised2 = plan.avgPrice * (1 - TAX - FEE) * 400 - calc.effectiveCostPerUnit * 400;
    expect(realized(plan.cities, prices, calc.effectiveCostPerUnit)).toBeCloseTo(promised2, 4);
    expect(promised2).toBeLessThan(promised);                              // цена упала — обещанный профит упал, а не остался прежним
    expect(plan.cities.reduce((s, c) => s + c.qty, 0)).toBe(400);
  });
});

describe('8. стресс-кейсы', () => {
  it('нет ликвидности: профит не выдумывается (patientSell = null), инструмент не падает', async () => {
    installMarket({ materialPrice: 100, finished: {} });
    const d = (await request(app).get(`/api/craft-calc?item=${ITEM}&quantity=10`)).body;
    expect(d.patientSell).toBeNull();
    expect(d.effectiveCostPerUnit).toBeGreaterThan(0);
  });
  it('себестоимость выше цены продажи: честный минус, а не ноль и не пропуск', async () => {
    installMarket({ materialPrice: 5000, finished: { [ITEM]: { Lymhurst: { price: 2000, dailyVolume: 10 } } } });
    const d = (await request(app).get(`/api/craft-calc?item=${ITEM}&quantity=10&cities=${CITIES.join(',')}`)).body;
    expect(d.patientSell.profitPerUnit).toBeLessThan(0);
    expect(d.patientSell.profitPerUnit).toBeCloseTo(2000 * 0.895 - d.effectiveCostPerUnit, 6);
  });
  it.each([1, 100000])('количество %i: срок и суммы масштабируются линейно, цена за штуку не меняется', async (qty) => {
    installMarket({ materialPrice: 100, finished: { [ITEM]: { Lymhurst: { price: 4000, dailyVolume: 10 } } } });
    const d = (await request(app).get(`/api/craft-calc?item=${ITEM}&quantity=${qty}&cities=${CITIES.join(',')}`)).body;
    expect(d.patientSell.profitPerUnit).toBeCloseTo(1180, 6);
    expect(d.patientSell.daysToSellBatch).toBeCloseTo(qty / (10 * 0.25), 6);
  });
  it('охотничий плащ .2: считается как «обычный плащ + герб + энергия, затем руны/души» — материалы рецепта без зачарования', async () => {
    installMarket({ materialPrice: 100 });
    const d = (await request(app).get('/api/craft-calc?item=T4_CAPEITEM_AVALON&enchant=2&quantity=10')).body;
    expect(d.enchantAfterCraft.forced).toBe(true);
    expect(d.recipe.every((r) => !r.enchanted)).toBe(true);
    expect(d.enchantAfterCraft.steps).toHaveLength(2);
  });
});
