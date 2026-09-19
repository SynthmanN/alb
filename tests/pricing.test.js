// Юнит-тесты чистой логики: формулы IP и мастерок, штрафы скора, налог, статистика истории, подбор экипировки.
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const {
  planCityAllocation, returnFactor, computeAcquireTime, requiresEnchantAfterCraft, cityPriceList, marginSellStats, premiumPaybackDays, enchantVariants, computeSellThreshold, teleportDistance, teleportStackCost, planCraftTeleport, allocateBudget, computePatientSell, enchantMaterialId, ENCHANT_MATERIAL_COUNT, gearEnchantId, mapLimit, itemIP, baseIPForTier, maxEnchantForGear, masteryIPBonus, familyIdOf, paretoFrontier, findCheapestOutfits,
  freshnessDecay, opportunityScore, scaledMinVolume, getSalesTaxRate, getBmTaxRate,
  quoteAgeMinutes, dealAgeMinutes, normLocation, totalVolume, cityStats, computeBulkPlan,
} = require('../server.js');
const RECIPES = require('../data/recipes.json');
const { RRR_PRESETS, rrrFromBonus } = require('../data/refining');
const NO_RRR = { royalBonus: false, focus: false };

describe('Item Power', () => {
  it('база по тиру: T2=500, +100 за тир', () => {
    expect(baseIPForTier(2)).toBe(500);
    expect(baseIPForTier(4)).toBe(700);
    expect(baseIPForTier(8)).toBe(1100);
  });
  it('зачарование +100 за уровень, качество 0/10/20/50/100', () => {
    expect(itemIP(4, 0, 1)).toBe(700);
    expect(itemIP(4, 1, 1)).toBe(800);
    expect(itemIP(4, 0, 2)).toBe(710);
    expect(itemIP(4, 0, 4)).toBe(750);
    expect(itemIP(8, 4, 5)).toBe(1600);
  });
  it('T2/T3 не зачаровываются', () => {
    expect(maxEnchantForGear(3)).toBe(0);
    expect(maxEnchantForGear(4)).toBe(4);
  });
  it('семейство — id без тира', () => {
    expect(familyIdOf('T4_MAIN_SWORD')).toBe('MAIN_SWORD');
    expect(familyIdOf('T8_2H_CLAYMORE')).toBe('2H_CLAYMORE');
  });
});

describe('бонус мастерок', () => {
  const levels = { masteries: { COMBAT_SWORDS: 50 }, specializations: { COMBAT_SWORDS_SWORD: 100 } };
  it('(0.2·(мастерство+спец) + 2·спец) на T4', () => {
    expect(masteryIPBonus('MAIN_SWORD', 4, levels)).toBeCloseTo(0.2 * 150 + 2 * 100, 6); // 230
  });
  it('надбавка по тиру: T6 = +10%', () => {
    expect(masteryIPBonus('MAIN_SWORD', 6, levels)).toBeCloseTo(230 * 1.1, 6);
  });
  it('до T4 бонуса нет; плащи и неизвестные вещи вне дерева', () => {
    expect(masteryIPBonus('MAIN_SWORD', 3, levels)).toBe(0);
    expect(masteryIPBonus('CAPE', 4, levels)).toBe(0);
    expect(masteryIPBonus('MAIN_SWORD', 4, { masteries: {}, specializations: {} })).toBe(0);
  });
});

describe('скор и штрафы', () => {
  it('свежесть: до часа — без штрафа, от 3 часов — вдвое, между — линейно', () => {
    expect(freshnessDecay(10)).toBe(1);
    expect(freshnessDecay(60)).toBe(1);
    expect(freshnessDecay(120)).toBeCloseTo(0.75, 6);
    expect(freshnessDecay(180)).toBe(0.5);
    expect(freshnessDecay(999)).toBe(0.5);
    expect(freshnessDecay(null)).toBe(0.5);
  });
  it('opportunityScore: процент × log2(2 + объём)', () => {
    expect(opportunityScore(100, 0)).toBeCloseTo(100, 6);
    expect(opportunityScore(100, 6)).toBeCloseTo(300, 6);
  });
  it('минимальный объём растёт вместе с окном', () => {
    expect(scaledMinVolume(24)).toBe(3);
    expect(scaledMinVolume(168)).toBe(21);
  });
});

describe('налог с продажи', () => {
  it('8% без премиума, 4% с премиумом', () => {
    expect(getSalesTaxRate({ query: {} })).toBe(0.08);
    expect(getSalesTaxRate({ query: { premium: 'false' } })).toBe(0.08);
    expect(getSalesTaxRate({ query: { premium: 'true' } })).toBe(0.04);
  });
});

describe('налог Чёрного Рынка', () => {
  it('налог с продажи + сбор за размещение 2.5%: 10.5% без премиума, 6.5% с премиумом', () => {
    expect(getBmTaxRate({ query: {} })).toBeCloseTo(0.105, 10);
    expect(getBmTaxRate({ query: { premium: 'true' } })).toBeCloseTo(0.065, 10);
  });
});

describe('котировки и история', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  it('возраст котировки; 0001-01-01 = нет данных', () => {
    expect(quoteAgeMinutes('2026-01-01T11:00:00', now)).toBeCloseTo(60, 6);
    expect(quoteAgeMinutes('0001-01-01T00:00:00', now)).toBeNull();
    expect(quoteAgeMinutes(undefined, now)).toBeNull();
  });
  it('возраст сделки — по самой старой котировке', () => {
    expect(dealAgeMinutes(['2026-01-01T11:00:00', '2026-01-01T09:00:00'], now)).toBe(180);
    expect(dealAgeMinutes(['2026-01-01T11:00:00', '0001-01-01T00:00:00'], now)).toBeNull();
  });
  const history = [
    { item_id: 'X', location: 'Fort Sterling', data: [{ item_count: 10, avg_price: 100 }, { item_count: 30, avg_price: 200 }] },
    { item_id: 'X', location: 'Black Market', data: [{ item_count: 5, avg_price: 50 }] },
    { item_id: 'Y', location: 'Fort Sterling', data: [{ item_count: 99, avg_price: 1 }] },
  ];
  it('имена с пробелами сравниваются без пробелов', () => {
    expect(normLocation('Fort Sterling')).toBe(normLocation('FortSterling'));
  });
  it('объём — по выбранным городам', () => {
    expect(totalVolume(history, 'X')).toBe(45);
    expect(totalVolume(history, 'X', ['FortSterling'])).toBe(40);
    expect(totalVolume(history, 'X', ['BlackMarket'])).toBe(5);
    expect(totalVolume(history, 'X', ['Martlock'])).toBe(0);
  });
  it('cityStats: средневзвешенная цена и объём в день', () => {
    const st = cityStats(history, 'X', 2)['Fort Sterling'];
    expect(st.avgPrice).toBeCloseTo((10 * 100 + 30 * 200) / 40, 6);
    expect(st.totalVolume).toBe(40);
    expect(st.avgDailyVolume).toBe(20);
  });
});

describe('подбор экипировки', () => {
  it('paretoFrontier убирает заведомо невыгодные варианты', () => {
    const f = paretoFrontier([
      { ip: 700, price: 100 }, { ip: 800, price: 90 }, { ip: 900, price: 200 }, { ip: 850, price: 250 },
    ]);
    expect(f.map((o) => [o.ip, o.price])).toEqual([[900, 200], [800, 90]]);
  });

  const slots = [
    { key: 'a', mult: 1, options: [{ ip: 700, price: 100 }, { ip: 800, price: 300 }] },
    { key: 'b', mult: 2, options: [{ ip: 700, price: 50 }, { ip: 900, price: 400 }] }, // двуручное: IP ×2
  ];
  it('окно [min, max]: только комбинации внутри, по возрастанию цены', () => {
    const r = findCheapestOutfits(slots, 2150, 2550, 5);
    expect(r.map((o) => [o.totalIP, o.price])).toEqual([[2200, 350], [2500, 500]]);
  });
  it('без ограничения — все 4 комбинации, самая дешёвая первая', () => {
    const r = findCheapestOutfits(slots, 0, 1e9, 10);
    expect(r.map((o) => o.price)).toEqual([150, 350, 500, 700]);
  });
  it('K обрезает результат', () => {
    expect(findCheapestOutfits(slots, 0, 1e9, 2).map((o) => o.price)).toEqual([150, 350]);
  });
  it('недостижимое окно — пусто', () => {
    expect(findCheapestOutfits(slots, 5000, 6000, 5)).toEqual([]);
  });
  it('дробный IP (мастерки) тоже укладывается в окно', () => {
    const fractional = [{ key: 'a', mult: 1, options: [{ ip: 700.4, price: 10 }, { ip: 700.6, price: 20 }] }];
    expect(findCheapestOutfits(fractional, 700.5, 701, 3).map((o) => o.price)).toEqual([20]);
  });
});

describe('план крупной партии', () => {
  const itemId = Object.keys(RECIPES).find((id) => id.startsWith('T4_') && RECIPES[id].resources.length >= 2);
  const recipe = RECIPES[itemId];
  const cities = ['Martlock', 'Lymhurst'];

  // 70 сделок за 7 дней = 10 в день; цена материала #i = 1000·(i+1)
  const materialHistory = recipe.resources.map((r, i) => ({
    item_id: r.resource, location: 'Martlock', data: [{ item_count: 70, avg_price: 1000 * (i + 1) }],
  }));
  const finishedHistory = [{ item_id: itemId, location: 'Lymhurst', data: [{ item_count: 70, avg_price: 200000 }] }];
  const base = {
    itemId, enchant: 0, quality: 1, quantity: 100, days: 7, rrrOpts: NO_RRR,
    taxRate: 0.08, costCeiling: null, sellLow: null, sellHigh: null, queryCities: cities,
  };

  it('себестоимость, сроки и профит после налога', () => {
    const plan = computeBulkPlan(base, materialHistory, finishedHistory);
    // цены материалов в плане партии — с комиссией 2.5% за свой Buy Order
    const expectedCost = recipe.resources.reduce((sum, r, i) => sum + r.count * 1000 * 1.025 * (i + 1), 0) + (recipe.silver || 0);
    expect(plan.hasAllMaterialPrices).toBe(true);
    expect(plan.effectiveCostPerUnit).toBeCloseTo(expectedCost, 6);
    expect(plan.marketAvgSellPrice).toBeCloseTo(200000, 6);
    expect(plan.avgDailySellVolume).toBe(10);
    expect(plan.daysToSellBatch).toBeCloseTo(10, 6); // 100 шт при 10 в день  // продажа своим Sell Order: налог 8% и Setup Fee 2.5%
    expect(plan.profitPerUnitLow).toBeCloseTo(200000 * (0.92 - 0.025) - expectedCost, 6);
    expect(plan.totalDaysEstimate).toBeCloseTo(plan.daysToAcquireBatch + 10, 6);
  });
  it('узкое место — материал с максимальным сроком закупки', () => {
    const plan = computeBulkPlan(base, materialHistory, finishedHistory);
    const slowest = plan.recipe.reduce((a, b) => (b.daysToAcquire > a.daysToAcquire ? b : a));
    expect(plan.bottleneckResource).toBe(slowest.resource);
    expect(plan.daysToAcquireBatch).toBeCloseTo(slowest.daysToAcquire, 6);
  });
  it('RRR уменьшает и себестоимость, и закупаемое количество', () => {
    const withRrr = computeBulkPlan({ ...base, rrrOpts: { royalBonus: true, focus: true } }, materialHistory, finishedHistory);
    const without = computeBulkPlan(base, materialHistory, finishedHistory);
    expect(withRrr.effectiveCostPerUnit).toBeLessThan(without.effectiveCostPerUnit);
    expect(withRrr.recipe[0].neededAfterRrr).toBeLessThan(without.recipe[0].neededAfterRrr);
  });
  it('потолок себестоимости и полоса продажи', () => {
    const plan = computeBulkPlan({ ...base, costCeiling: 1, sellLow: 150000, sellHigh: 100000 }, materialHistory, finishedHistory);
    expect(plan.withinCeiling).toBe(false);
    expect([plan.sellLow, plan.sellHigh]).toEqual([100000, 150000]); // перепутанные границы меняются местами
    expect(plan.netSellLow).toBeCloseTo(100000 * (0.92 - 0.025), 6);
  });
  it('нет истории по материалу — план посчитать нельзя', () => {
    const plan = computeBulkPlan(base, materialHistory.slice(1), finishedHistory);
    expect(plan.hasAllMaterialPrices).toBe(false);
    expect(plan.profitPerUnitLow).toBeNull();
  });
});

describe('ленивый крафтер: распределение бюджета', () => {
  const cands = [
    { itemId: 'A', costPerUnit: 1000, profitPerUnit: 500, profitPct: 50, avgDailySellVolume: 4 },
    { itemId: 'B', costPerUnit: 100, profitPerUnit: 20, profitPct: 20, avgDailySellVolume: 200 },
    { itemId: 'C', costPerUnit: 500, profitPerUnit: -5, profitPct: -1, avgDailySellVolume: 50 },
  ];
  const opts = { budget: 10000, marketSharePct: 50, sellDays: 1 };

  it('убыточные позиции в план не попадают', () => {
    const plan = allocateBudget(cands, { ...opts, strategy: 'balanced' });
    expect(plan.items.map((i) => i.itemId)).not.toContain('C');
  });
  it('количество ограничено долей рынка: 50% от 4 шт/день за 1 день = 2 шт', () => {
    const plan = allocateBudget(cands, { ...opts, strategy: 'expensive' });
    expect(plan.items.find((i) => i.itemId === 'A').qty).toBe(2);
  });
  it('количество ограничено бюджетом; трата не превышает бюджет', () => {
    const plan = allocateBudget(cands, { budget: 1500, marketSharePct: 100, sellDays: 10, strategy: 'expensive' });
    expect(plan.spent).toBeLessThanOrEqual(1500);
    expect(plan.spent + plan.remaining).toBeCloseTo(1500, 6);
    expect(plan.items[0].itemId).toBe('A'); // «дорогие»: сначала максимум прибыли с штуки
    expect(plan.items[0].qty).toBe(1);
  });
  it('«массовые» идут по объёму × прибыль, «дорогие» — по прибыли с штуки', () => {
    const mass = allocateBudget(cands, { ...opts, strategy: 'mass' });
    const expensive = allocateBudget(cands, { ...opts, strategy: 'expensive' });
    expect(mass.items[0].itemId).toBe('B');      // 200·20 = 4000 против 4·500 = 2000
    expect(expensive.items[0].itemId).toBe('A');
  });
  it('итоги: прибыль — сумма по позициям, процент — от потраченного', () => {
    const plan = allocateBudget(cands, { ...opts, strategy: 'balanced' });
    const sum = plan.items.reduce((acc, i) => acc + i.profitEarned, 0);
    expect(plan.totalProfit).toBeCloseTo(sum, 6);
    expect(plan.profitPct).toBeCloseTo((sum / plan.spent) * 100, 6);
  });
  it('нечего покупать — пустой план', () => {
    const plan = allocateBudget([], { ...opts, strategy: 'balanced' });
    expect(plan.items).toEqual([]);
    expect(plan.spent).toBe(0);
  });
});

describe('зачарование: материалы', () => {
  it('уровень 1/2/3 → RUNE/SOUL/RELIC того же тира, что и предмет', () => {
    expect(enchantMaterialId(5, 1)).toBe('T5_RUNE');
    expect(enchantMaterialId(5, 2)).toBe('T5_SOUL');
    expect(enchantMaterialId(5, 3)).toBe('T5_RELIC');
    expect(enchantMaterialId(8, 1)).toBe('T8_RUNE');
  });
  it('количество материала фиксировано по слоту (не зависит от тира и уровня)', () => {
    expect(ENCHANT_MATERIAL_COUNT['двуручное']).toBe(384);
    expect(ENCHANT_MATERIAL_COUNT['осн. рука']).toBe(288);
    expect(ENCHANT_MATERIAL_COUNT['торс']).toBe(192);
    expect(ENCHANT_MATERIAL_COUNT['шлем']).toBe(96);
    expect(ENCHANT_MATERIAL_COUNT['плащ']).toBe(96);
  });
  it('id зачарованного гира: суффикс @N, для .0 — без суффикса', () => {
    expect(gearEnchantId('T4_MAIN_SWORD', 0)).toBe('T4_MAIN_SWORD');
    expect(gearEnchantId('T4_MAIN_SWORD', 2)).toBe('T4_MAIN_SWORD@2');
  });
});

describe('ограничение параллелизма запросов', () => {
  it('mapLimit не превышает лимит одновременных задач и сохраняет порядок результатов', async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(peak).toBeLessThanOrEqual(3);
  });
});

describe('терпеливая продажа', () => {
  const history = [
    { item_id: 'X', location: 'Martlock', data: [{ item_count: 30, avg_price: 1000 }, { item_count: 40, avg_price: 1200 }] },
    { item_id: 'X', location: 'Lymhurst', data: [{ item_count: 70, avg_price: 1500 }] },
    { item_id: 'X', location: 'Caerleon', data: [{ item_count: 500, avg_price: 9999 }] },
  ];
  // себестоимость 1000; налог 8% + сбор за размещение 2.5%: чистая цена = цена × 0.895
  const base = { history, itemId: 'X', days: 7, quantity: 140, taxRate: 0.08, costPerUnit: 1000, queryCities: ['Martlock', 'Lymhurst'] };

  it('в план входят только прибыльные города; цена — средневзвешенная по ним, объём — в день', () => {
    const p = computePatientSell(base);
    // Martlock (30·1000 + 40·1200)/70 = 1114.3 → 997 после налога и сбора < 1000 — убыточный, в план не входит
    expect(p.planCities).toEqual(['Lymhurst']);
    expect(p.skippedCities).toEqual(['Martlock']);
    expect(p.avgSellPrice).toBeCloseTo(1500, 6);
    expect(p.avgDailyVolume).toBe(10);
    expect(p.marketAvgPrice).toBeCloseTo((30 * 1000 + 40 * 1200 + 70 * 1500) / 140, 6);  // наивное среднее — только для справки
    expect(p.marketDailyVolume).toBe(20);
    expect(p.bestCity).toEqual({ city: 'Lymhurst', avgPrice: 1500 });
  });
  it('дни на распродажу партии = количество / оборот прибыльных городов в день', () => {
    expect(computePatientSell(base).daysToSellBatch).toBeCloseTo(14, 6);              // 140 шт при 10 в день
    expect(computePatientSell({ ...base, quantity: 20 }).daysToSellBatch).toBeCloseTo(2, 6);
  });
  it('профит — после налога, сбора за размещение и за вычетом себестоимости', () => {
    const p = computePatientSell(base);
    expect(p.setupFee).toBe(0.025);
    expect(p.netSellPrice).toBeCloseTo(1500 * (1 - 0.08 - 0.025), 6);
    expect(p.profitPerUnit).toBeCloseTo(p.netSellPrice - 1000, 6);
  });
  it('знак не переворачивается: наивное среднее по всем городам дало бы минус, честный план — плюс', () => {
    const cities = [
      { item_id: 'X', location: 'Martlock', data: [{ item_count: 700, avg_price: 800 }] },   // 100/день, убыточный
      { item_id: 'X', location: 'Lymhurst', data: [{ item_count: 70, avg_price: 1500 }] },   // 10/день, прибыльный
    ];
    const p = computePatientSell({ ...base, history: cities, costPerUnit: 1000 });
    const naiveNet = ((700 * 800 + 70 * 1500) / 770) * 0.895 - 1000;   // ≈ −127: «убыток на партии»
    expect(naiveNet).toBeLessThan(0);
    expect(p.profitPerUnit).toBeGreaterThan(0);                        // честно: продаём только в Lymhurst
    expect(p.avgDailyVolume).toBe(10);
  });
  it('нет прибыльных городов — показываем лучший город с честным минусом', () => {
    const p = computePatientSell({ ...base, costPerUnit: 5000 });
    expect(p.planCities).toEqual(['Lymhurst']);
    expect(p.profitPerUnit).toBeLessThan(0);
  });
  it('нет сделок в выбранных городах — null (блок терпеливой продажи не показывается)', () => {
    expect(computePatientSell({ ...base, queryCities: ['Bridgewatch'] })).toBeNull();
  });
});

describe('терпеливая продажа: качество и разбивка по городам', () => {
  const history = [
    { item_id: 'X', location: 'Martlock', quality: 1, data: [{ item_count: 7, avg_price: 1000 }] },
    { item_id: 'X', location: 'Martlock', quality: 4, data: [{ item_count: 700, avg_price: 1500 }] },
    { item_id: 'X', location: 'Lymhurst', quality: 4, data: [{ item_count: 70, avg_price: 2000 }] },
  ];
  const base = { history, itemId: 'X', days: 7, quantity: 100, taxRate: 0, setupFee: 0, costPerUnit: 500, queryCities: ['Martlock', 'Lymhurst'] };

  it('фильтр по качеству: ряды других качеств не смешиваются', () => {
    const q1 = computePatientSell({ ...base, quality: 1 });
    const q4 = computePatientSell({ ...base, quality: 4 });
    expect(q1.avgDailyVolume).toBe(1);
    expect(q4.avgDailyVolume).toBe(110);
    expect(q1.daysToSellBatch).toBeGreaterThan(q4.daysToSellBatch * 50);
  });
  it('без указания качества считаются все ряды вместе (как раньше)', () => {
    expect(computePatientSell(base).avgDailyVolume).toBe(111);
  });
  it('byCity: все города с ценой, спросом и профитом, по убыванию цены', () => {
    const p = computePatientSell({ ...base, quality: 4 });
    expect(p.byCity.map((c) => c.city)).toEqual(['Lymhurst', 'Martlock']);
    expect(p.byCity[0].profitPerUnit).toBeCloseTo(2000 - 500, 6);
  });
});

describe('план партии: фильтр качества для сканеров', () => {
  const itemId = Object.keys(RECIPES).find((id) => id.startsWith('T4_') && RECIPES[id].resources.length >= 2);
  const recipe = RECIPES[itemId];
  const materialHistory = recipe.resources.map((r) => ({ item_id: r.resource, location: 'Martlock', data: [{ item_count: 70, avg_price: 100 }] }));
  const finishedHistory = [
    { item_id: itemId, location: 'Martlock', quality: 1, data: [{ item_count: 7, avg_price: 200000 }] },
    { item_id: itemId, location: 'Martlock', quality: 4, data: [{ item_count: 700, avg_price: 300000 }] },
  ];
  const base = {
    itemId, enchant: 0, quantity: 100, days: 7, rrrOpts: NO_RRR, taxRate: 0, costCeiling: null,
    sellLow: null, sellHigh: null, queryCities: ['Martlock'], filterQuality: true,
  };
  it('с filterQuality берутся только ряды нужного качества: спрос и цена у Отличного и Обычного разные', () => {
    const q1 = computeBulkPlan({ ...base, quality: 1 }, materialHistory, finishedHistory);
    const q4 = computeBulkPlan({ ...base, quality: 4 }, materialHistory, finishedHistory);
    expect(q1.avgDailySellVolume).toBe(1);
    expect(q1.marketAvgSellPrice).toBeCloseTo(200000, 6);
    expect(q4.avgDailySellVolume).toBe(100);
    expect(q4.marketAvgSellPrice).toBeCloseTo(300000, 6);
    expect(q4.daysToSellBatch).toBeLessThan(q1.daysToSellBatch / 50);
  });
  it('без filterQuality (одиночный план, история запрошена под одно качество) ряды не отбрасываются', () => {
    const plan = computeBulkPlan({ ...base, filterQuality: false, quality: 1 }, materialHistory, finishedHistory);
    expect(plan.avgDailySellVolume).toBe(101);
  });
});

describe('зачарованные версии предметов для сканеров', () => {
  it('гир T4+: .0–.4 с суффиксом @N; до T4 — только .0', () => {
    const t4 = enchantVariants({ id: 'T4_MAIN_SWORD', tier: 4, category: 'weapon' });
    expect(t4.map((v) => v.queryId)).toEqual(['T4_MAIN_SWORD', 'T4_MAIN_SWORD@1', 'T4_MAIN_SWORD@2', 'T4_MAIN_SWORD@3', 'T4_MAIN_SWORD@4']);
    expect(enchantVariants({ id: 'T3_MAIN_SWORD', tier: 3, category: 'weapon' })).toEqual([{ enchant: 0, queryId: 'T3_MAIN_SWORD' }]);
  });
  it('ресурсы: _LEVELn@n; камень (сырьё и блоки) не зачаровывается вообще', () => {
    expect(enchantVariants({ id: 'T5_ORE', tier: 5, category: 'raw' }).map((v) => v.queryId).slice(-1)).toEqual(['T5_ORE_LEVEL4@4']);
    expect(enchantVariants({ id: 'T5_ROCK', tier: 5, category: 'raw' })).toHaveLength(1);
    expect(enchantVariants({ id: 'T5_STONEBLOCK', tier: 5, category: 'refined' })).toHaveLength(1);
  });
});

describe('скан маржи и ликвидности', () => {
  const history = [
    { item_id: 'X', location: 'Martlock', quality: 4, data: [{ item_count: 70, avg_price: 1000 }] },
    { item_id: 'X', location: 'Lymhurst', quality: 4, data: [{ item_count: 70, avg_price: 2000 }] },
    { item_id: 'X', location: 'Martlock', quality: 1, data: [{ item_count: 7, avg_price: 500 }] },
    { item_id: 'X', location: 'Caerleon', quality: 4, data: [{ item_count: 700, avg_price: 9999 }] },
  ];
  const cities = ['Martlock', 'Lymhurst'];

  it('режим sum: цена средневзвешенная по городам, оборот — сумма по городам', () => {
    const st = marginSellStats(history, 'X', 7, 4, cities, 'sum');
    expect(st.avgPrice).toBeCloseTo(1500, 6);
    expect(st.dailyVolume).toBe(20);
    expect(st.cities.sort()).toEqual(['Lymhurst', 'Martlock']);
  });
  it('режим best: только город с лучшей ценой и его оборот', () => {
    const st = marginSellStats(history, 'X', 7, 4, cities, 'best');
    expect(st.avgPrice).toBe(2000);
    expect(st.dailyVolume).toBe(10);
    expect(st.cities).toEqual(['Lymhurst']);
  });
  it('качества не смешиваются, невыбранные города не учитываются, нет данных — null', () => {
    expect(marginSellStats(history, 'X', 7, 1, cities, 'sum').dailyVolume).toBe(1);
    expect(marginSellStats(history, 'X', 7, 2, cities, 'sum')).toBeNull();
    expect(marginSellStats(history, 'X', 7, 4, ['Bridgewatch'], 'sum')).toBeNull();
  });
  it('дней на премиум = 28 млн ÷ (профит/шт × оборот/день); без прибыли — null', () => {
    expect(premiumPaybackDays(1000, 28)).toBeCloseTo(1000, 6);
    expect(premiumPaybackDays(-5, 10)).toBeNull();
    expect(premiumPaybackDays(100, 0)).toBeNull();
  });
});

describe('охотничьи и фракционные плащи: оба пути зачарования равноправны', () => {
  it('принудительного «только после крафта» нет: по игровым данным есть рецепт зачарованного плаща (плащ того же зачарования + герб + жетон)', () => {
    for (const id of ['T4_CAPEITEM_AVALON', 'T6_CAPEITEM_KEEPER', 'T4_CAPEITEM_FW_CAERLEON', 'T4_CAPE', 'T4_MAIN_SWORD']) expect(requiresEnchantAfterCraft(id)).toBe(false);
  });
});

describe('цены материала по городам', () => {
  it('города по возрастанию цены; без цены и не из выбранных — пропускаются', () => {
    const records = { Martlock: { sell_price_min: 300 }, Lymhurst: { sell_price_min: 100 }, Thetford: { sell_price_min: 0 }, Caerleon: { sell_price_min: 50 } };
    expect(cityPriceList(records, ['Martlock', 'Lymhurst', 'Thetford'])).toEqual([{ city: 'Lymhurst', price: 100 }, { city: 'Martlock', price: 300 }]);
  });
});

describe('доля рынка: срок распродажи по реалистичной доле оборота', () => {
  const history = [{ item_id: 'X', location: 'Martlock', quality: 1, data: [{ item_count: 70, avg_price: 1000 }] }]; // 10 в день
  const base = { history, itemId: 'X', days: 7, quantity: 100, taxRate: 0, costPerUnit: 500, queryCities: ['Martlock'], quality: 1 };
  it('по умолчанию (100%) — как раньше: 100 шт при 10 в день = 10 дней', () => {
    expect(computePatientSell(base).daysToSellBatch).toBeCloseTo(10, 6);
  });
  it('доля 25% — конкуренты забирают остальное: 100 шт при ~2.5 в день = 40 дней', () => {
    const p = computePatientSell({ ...base, marketShare: 0.25 });
    expect(p.daysToSellBatch).toBeCloseTo(40, 6);
    expect(p.marketShare).toBe(0.25);
    expect(p.avgDailyVolume).toBe(10); // оборот рынка не меняется — меняется только доступная доля
  });
  it('порог продажи: срок по суммарному спросу с учётом доли', () => {
    const cities = [{ city: 'A', avgPrice: 100, avgDailyVolume: 4 }, { city: 'B', avgPrice: 100, avgDailyVolume: 6 }];
    expect(computeSellThreshold(cities, 50, 100, 0.5).daysToSellBatch).toBeCloseTo(20, 6);
  });
  it('дней на премиум по доле: чем меньше доля, тем дольше', () => {
    expect(premiumPaybackDays(1000, 28 * 0.25)).toBeGreaterThan(premiumPaybackDays(1000, 28));
  });
});

describe('время закупки сырья', () => {
  const history = [
    { item_id: 'A', location: 'Martlock', data: [{ item_count: 70, avg_price: 10 }] },   // 10 в день
    { item_id: 'A', location: 'Lymhurst', data: [{ item_count: 700, avg_price: 10 }] }, // 100 в день
    { item_id: 'B', location: 'Martlock', data: [{ item_count: 7, avg_price: 10 }] },    // 1 в день
  ];
  const rows = [
    { resource: 'A', resourceName: 'Материал A', queryId: 'A', needed: 100, city: 'Martlock' },
    { resource: 'B', resourceName: 'Материал B', queryId: 'B', needed: 5, city: 'Martlock' },
  ];
  it('дни = нужное количество / оборот в городе покупки; узкое место — самый медленный материал', () => {
    const t = computeAcquireTime({ rows, history, days: 7 });
    expect(t.byResource[0].daysToAcquire).toBeCloseTo(10, 6);
    expect(t.byResource[1].daysToAcquire).toBeCloseTo(5, 6);
    expect(t.days).toBeCloseTo(10, 6);
    expect(t.bottleneckResource).toBe('A');
  });
  it('доля рынка замедляет закупку: при 25% срок вчетверо больше', () => {
    expect(computeAcquireTime({ rows, history, days: 7, marketShare: 0.25 }).days).toBeCloseTo(40, 6);
  });
  it('нет сделок в городе покупки — берём оборот по всем городам; нет вообще — null', () => {
    const t = computeAcquireTime({ rows: [{ resource: 'A', queryId: 'A', needed: 110, city: 'Bridgewatch' }, { resource: 'Z', queryId: 'Z', needed: 1, city: 'Martlock' }], history, days: 7 });
    expect(t.byResource[0].daysToAcquire).toBeCloseTo(1, 6);   // (10 + 100) в день
    expect(t.byResource[1].daysToAcquire).toBeNull();
  });
});

describe('возврат ресурсов: только на возвращаемые материалы', () => {
  it('returnFactor: 1 − RRR для обычного материала, 1 для помеченного noReturn', () => {
    expect(returnFactor({ resource: 'T4_METALBAR', count: 16 }, 0.367)).toBeCloseTo(0.633, 6);
    expect(returnFactor({ resource: 'T4_CAPEITEM_AVALON_BP', count: 1, noReturn: true }, 0.367)).toBe(1);
  });
  it('в рецептах артефактов, гербов, жетонов и базового плаща есть noReturn; в обычных рецептах меча/брони — нет', () => {
    expect(RECIPES.T4_CAPEITEM_AVALON.resources.find((r) => r.resource === 'T4_CAPE').noReturn).toBe(true);
    expect(RECIPES.T4_CAPEITEM_AVALON.resources.find((r) => r.resource === 'QUESTITEM_TOKEN_AVALON').noReturn).toBe(true);
    expect(RECIPES.T4_MAIN_SWORD.resources.some((r) => r.noReturn)).toBe(false);
    expect(RECIPES.T4_HEAD_PLATE_SET1.resources.some((r) => r.noReturn)).toBe(false);
  });
  const itemId = 'T4_CAPEITEM_AVALON';
  const recipe = RECIPES[itemId];
  const materialHistory = recipe.resources.map((r) => ({ item_id: r.resource, location: 'Martlock', data: [{ item_count: 700, avg_price: 1000 }] }));
  const finishedHistory = [{ item_id: itemId, location: 'Martlock', data: [{ item_count: 700, avg_price: 100000 }] }];
  const base = { itemId, enchant: 0, quality: 1, quantity: 100, days: 7, rrrOpts: NO_RRR, taxRate: 0, costCeiling: null, sellLow: null, sellHigh: null, queryCities: ['Martlock'] };
  it('план партии: возврат уменьшает закупку и цену только возвращаемых материалов', () => {
    const rrr = rrrFromBonus(59);                                          // только Фокус: одна ставка на все материалы, город без спец-бонуса
    const plan = computeBulkPlan({ ...base, rrrOpts: { royalBonus: false, focus: true } }, materialHistory, finishedHistory);
    for (const r of plan.recipe) {
      const src = recipe.resources.find((x) => x.resource === r.resource);
      expect(r.neededAfterRrr).toBe(Math.ceil(src.count * 100 * (src.noReturn ? 1 : 1 - rrr)));
    }
    const expected = recipe.resources.reduce((sum, r) => sum + r.count * 1000 * 1.025 * (r.noReturn ? 1 : 1 - rrr), 0);
    expect(plan.effectiveCostPerUnit).toBeCloseTo(expected, 6);
  });
});

describe('многогородовой план: ценовой допуск и ликвидность', () => {
  const cities = [
    { city: 'A', avgPrice: 100, avgDailyVolume: 10 },   // лучшая цена продажи? для sell — самая высокая
    { city: 'B', avgPrice: 97, avgDailyVolume: 50 },    // −3% при 5× большем обороте
    { city: 'C', avgPrice: 90, avgDailyVolume: 5 },     // −10%, тонкий
    { city: 'D', avgPrice: 100, avgDailyVolume: 0.05 }, // одна случайная сделка — не сигнал
  ];
  const sell = (extra = {}) => planCityAllocation(cities, 1000, { side: 'sell', ...extra });

  it('город в допуске входит в план, вне допуска — нет; количество делится по обороту и сходится в партию', () => {
    const plan = sell({ priceTolerance: 0.05 });
    expect(plan.cities.map((c) => c.city).sort()).toEqual(['A', 'B']);
    expect(plan.cities.reduce((sum, c) => sum + c.qty, 0)).toBe(1000);
    const [a, b] = ['A', 'B'].map((n) => plan.cities.find((c) => c.city === n));
    expect(b.qty).toBeGreaterThan(a.qty * 4);                       // 50 против 10 в день
    expect(Math.abs(a.days - b.days)).toBeLessThan(0.5);            // у всех практически один срок (разница — от округления штук)
    expect(plan.totalDays).toBeCloseTo(1000 / 60, 6);
  });
  it('тонкий город с «лучшей» ценой не выбивает ликвидные города (одна сделка ≠ ценовой сигнал)', () => {
    const plan = sell({ priceTolerance: 0.05 });
    expect(plan.excluded.map((e) => e.city)).toContain('D');
    expect(plan.cities.map((c) => c.city)).toContain('A');
  });
  it('монотонность: больше допуск — не меньше городов в плане и не медленнее цикл', () => {
    let prevCount = 0;
    let prevDays = Infinity;
    for (const tol of [0, 0.02, 0.05, 0.12, 0.3]) {
      const plan = sell({ priceTolerance: tol });
      expect(plan.cities.length).toBeGreaterThanOrEqual(prevCount);
      expect(plan.totalDays).toBeLessThanOrEqual(prevDays + 1e-9);
      prevCount = plan.cities.length;
      prevDays = plan.totalDays;
    }
  });
  it('допуск динамический: ликвидный город получает допуск до ×3 от базового, но не больше', () => {
    const plan = sell({ priceTolerance: 0.01 });
    const b = plan.cities.find((c) => c.city === 'B');
    expect(b).toBeTruthy();                                         // −3% при базовом допуске 1% попал благодаря обороту (×3 = 3%)
    expect(b.tolerance).toBeCloseTo(0.03, 6);
    expect(sell({ priceTolerance: 0.01, maxToleranceMult: 1 }).cities.map((c) => c.city)).not.toContain('B');
  });
  it('закупка: лучшая цена — самая низкая; переплата плана относительно лучшего города считается', () => {
    const buy = planCityAllocation([{ city: 'X', avgPrice: 100, avgDailyVolume: 10 }, { city: 'Y', avgPrice: 103, avgDailyVolume: 30 }], 400, { side: 'buy', priceTolerance: 0.05 });
    expect(buy.bestPrice).toBe(100);
    expect(buy.cities[0].city).toBe('X');                          // дешёвый первым
    expect(buy.cities.find((c) => c.city === 'Y').qty).toBe(300);
    expect(buy.avgPrice).toBeCloseTo((100 * 100 + 103 * 300) / 400, 6);
    expect(buy.overpayPct).toBeGreaterThan(0);
  });
  it('доля рынка растягивает срок; нет городов — пустой план', () => {
    expect(sell({ priceTolerance: 0.05, marketShare: 0.5 }).totalDays).toBeCloseTo(sell({ priceTolerance: 0.05 }).totalDays * 2, 6);
    expect(planCityAllocation([], 10, { side: 'sell' }).cities).toEqual([]);
  });
});

describe('возврат ресурсов (RRR) по материалу и городу закупки', () => {
  const { materialRrr, resourceTypeOf, bestMaterialQuote, tradeHoursOf, confidenceOf } = require('../server.js');
  const ROYAL = { royalBonus: true, focus: false };
  it('тип ресурса определяется и по сырью, и по переработанному материалу; зачарованные версии — тоже', () => {
    expect(resourceTypeOf('T4_ORE')).toBe('ORE');
    expect(resourceTypeOf('T5_METALBAR')).toBe('ORE');
    expect(resourceTypeOf('T6_LEATHER_LEVEL2@2')).toBe('HIDE');
    expect(resourceTypeOf('T4_PLANKS')).toBe('WOOD');
    expect(resourceTypeOf('T4_CAPEITEM_AVALON_BP')).toBeNull();
  });
  it('спец-бонус города достаётся только «своему» типу ресурса: руда в Thetford — 58%, кожа в Thetford — базовые 18%', () => {
    expect(materialRrr('T4_METALBAR', 'Thetford', ROYAL)).toBeCloseTo(rrrFromBonus(58), 9);
    expect(materialRrr('T4_LEATHER', 'Thetford', ROYAL)).toBeCloseTo(rrrFromBonus(18), 9);
    expect(materialRrr('T4_LEATHER', 'Martlock', ROYAL)).toBeCloseTo(rrrFromBonus(58), 9);
    expect(materialRrr('T4_PLANKS', 'Fort Sterling', ROYAL)).toBeCloseTo(rrrFromBonus(58), 9);
    expect(materialRrr('T4_PLANKS', 'FortSterling', ROYAL)).toBeCloseTo(rrrFromBonus(58), 9);   // город без пробела из запроса
  });
  it('Фокус добавляет 59%, без бонуса города возврата нет, с обоими — 117%', () => {
    expect(materialRrr('T4_METALBAR', 'Thetford', { royalBonus: false, focus: false })).toBe(0);
    expect(materialRrr('T4_METALBAR', 'Lymhurst', { royalBonus: false, focus: true })).toBeCloseTo(rrrFromBonus(59), 9);
    expect(materialRrr('T4_METALBAR', 'Thetford', { royalBonus: true, focus: true })).toBeCloseTo(rrrFromBonus(117), 9);
  });
  it('город закупки выбирается по цене с учётом возврата: дороже на 10%, но со спец-бонусом — выгоднее', () => {
    const quotes = [{ city: 'Lymhurst', price: 100 }, { city: 'Thetford', price: 110 }];
    const best = bestMaterialQuote(quotes, { resource: 'T4_METALBAR' }, ROYAL);
    expect(best.city).toBe('Thetford');
    expect(best.effective).toBeCloseTo(110 * (1 - rrrFromBonus(58)), 9);
    expect(bestMaterialQuote(quotes, { resource: 'T4_METALBAR' }, { royalBonus: false, focus: false }).city).toBe('Lymhurst');
  });
  it('сценарий из жизни: руда в Thetford на 2 дороже (101 против 99 в Bridgewatch) — Thetford выгоднее за счёт бонуса, отмечен cityBonus', () => {
    const best = bestMaterialQuote([{ city: 'Bridgewatch', price: 99 }, { city: 'Thetford', price: 101 }], { resource: 'T4_ORE' }, ROYAL);
    expect(best.city).toBe('Thetford');
    expect(best.cityBonus).toBe(true);
    expect(best.effective).toBeCloseTo(101 * (1 - rrrFromBonus(58)), 9);          // ≈ 64 против ≈ 84 в Bridgewatch
    const bridgewatch = bestMaterialQuote([{ city: 'Bridgewatch', price: 99 }], { resource: 'T4_ORE' }, ROYAL);
    expect(bridgewatch.cityBonus).toBe(false);
    expect(bridgewatch.effective).toBeCloseTo(99 * (1 - rrrFromBonus(18)), 9);
  });
  it('бонус не «раздувается»: город с бонусом за 500 не обгоняет город без бонуса за 99', () => {
    const best = bestMaterialQuote([{ city: 'Bridgewatch', price: 99 }, { city: 'Thetford', price: 500 }], { resource: 'T4_ORE' }, ROYAL);
    expect(best.city).toBe('Bridgewatch');
  });
  it('невозвращаемый материал (герб, жетон) выбирается по номиналу и возврата не получает', () => {
    const best = bestMaterialQuote([{ city: 'Lymhurst', price: 100 }, { city: 'Thetford', price: 95 }], { resource: 'T4_METALBAR', noReturn: true }, ROYAL);
    expect(best).toMatchObject({ city: 'Thetford', rrr: 0, factor: 1 });
  });
  it('индекс доверия считается по числу разных часов торговли, а не штук: 3 часа — 13%, 300 — 94%', () => {
    expect(confidenceOf(3)).toBeCloseTo(3 / 23, 9);
    expect(confidenceOf(300)).toBeCloseTo(300 / 320, 9);
    const series = [
      { quality: 1, location: 'Martlock', data: [{ timestamp: 'a', item_count: 500 }, { timestamp: 'b', item_count: 1 }] },
      { quality: 1, location: 'Thetford', data: [{ timestamp: 'a', item_count: 2 }, { timestamp: 'c', item_count: 0 }] },
      { quality: 2, location: 'Martlock', data: [{ timestamp: 'z', item_count: 9 }] },
    ];
    expect(tradeHoursOf(series, 1, ['Martlock', 'Thetford'])).toBe(2);       // часы a и b; c без сделок, качество 2 не считается, 500 штук — это один час
    expect(tradeHoursOf(series, 1, ['Martlock'])).toBe(2);
    expect(tradeHoursOf(series, 1, ['Lymhurst'])).toBe(0);
  });
});


describe('полуфабрикаты: купить готовый материал или переработать самому', () => {
  const { refineComponents, refineAlternative, bestMaterialQuote } = require('../server.js');
  const prices = { T4_ORE: { price: 100, city: 'Thetford', date: '2026-01-01T10:00:00' }, T3_METALBAR: { price: 200, city: 'Martlock', date: '2026-01-01T09:00:00' } };
  const priceOf = (id) => prices[id] || null;

  it('разбор id материала: сырьё тира и материал предыдущего тира; зачарованный — с тем же уровнем сырья', () => {
    const c = refineComponents('T4_METALBAR');
    expect(c).toMatchObject({ tier: 4, type: 'ORE', rawId: 'T4_ORE', prevId: 'T3_METALBAR', ratio: { raw: 2, prevRefined: 1 } });
    const e = refineComponents('T5_LEATHER_LEVEL2@2');
    expect(e).toMatchObject({ tier: 5, type: 'HIDE', rawId: 'T5_HIDE_LEVEL2@2', prevId: 'T4_LEATHER_LEVEL2@2' });
    expect(refineComponents('T2_PLANKS').prevId).toBeNull();
    expect(refineComponents('T4_MAIN_SWORD')).toBeNull();
    expect(refineComponents('T4_ORE')).toBeNull();
  });
  it('цена переработки = (2×сырьё + 1×предыдущий материал) × (1 − ставка переработки)', () => {
    const alt = refineAlternative('T4_METALBAR', priceOf, 0.367);
    expect(alt.rawCost).toBe(400);
    expect(alt.price).toBeCloseTo(400 * (1 - 0.367), 9);
    expect(alt.city).toBe('Thetford');
    expect(alt.date).toBe('2026-01-01T09:00:00');    // самая старая цена компонентов
    expect(alt.components.map((x) => x.id)).toEqual(['T4_ORE', 'T3_METALBAR']);
  });
  it('нет цены компонента — переработка невозможна', () => {
    expect(refineAlternative('T4_METALBAR', (id) => (id === 'T4_ORE' ? prices.T4_ORE : null), 0.367)).toBeNull();
    expect(refineAlternative('T4_METALBAR', () => null, 0.367)).toBeNull();
  });
  it('выбирается дешевле: переработка (253.2) против покупки готового (300) — и наоборот; ставка гира применяется поверх', () => {
    const opts = (rate) => ({ gearRate: 0.248, refine: { priceOf, rate } });
    const cheapRefine = bestMaterialQuote([{ city: 'Martlock', price: 300 }], { resource: 'T4_METALBAR', queryId: 'T4_METALBAR' }, opts(0.367));
    expect(cheapRefine.source).toBe('refine');
    expect(cheapRefine.price).toBeCloseTo(253.2, 6);
    expect(cheapRefine.buyPrice).toBe(300);
    expect(cheapRefine.effective).toBeCloseTo(253.2 * (1 - 0.248), 6);
    const cheapBuy = bestMaterialQuote([{ city: 'Martlock', price: 200 }], { resource: 'T4_METALBAR', queryId: 'T4_METALBAR' }, opts(0.367));
    expect(cheapBuy.source).toBeUndefined();
    expect(cheapBuy.price).toBe(200);
    expect(cheapBuy.refineOption.price).toBeCloseTo(253.2, 6);        // вариант переработки отдаётся всегда — клиент пересчитает при другой ставке
  });
  it('без ставки возврата — 0%: при цене 400 против покупки 300 берётся покупка', () => {
    const noRate = bestMaterialQuote([{ city: 'Martlock', price: 300 }], { resource: 'T4_METALBAR', queryId: 'T4_METALBAR' }, { gearRate: 0.248, refine: { priceOf, rate: 0 } });
    expect(noRate.source).toBeUndefined();
    expect(noRate.price).toBe(300);
  });
});
