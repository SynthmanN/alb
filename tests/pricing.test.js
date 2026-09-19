// Юнит-тесты чистой логики: формулы IP и мастерок, штрафы скора, налог, статистика истории, подбор экипировки.
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const {
  computeSellThreshold, teleportDistance, teleportStackCost, planCraftTeleport, allocateBudget, computePatientSell, enchantMaterialId, ENCHANT_MATERIAL_COUNT, gearEnchantId, mapLimit, itemIP, baseIPForTier, maxEnchantForGear, masteryIPBonus, familyIdOf, paretoFrontier, findCheapestOutfits,
  freshnessDecay, bulkCycleDecay, opportunityScore, scaledMinVolume, getSalesTaxRate, getBmTaxRate,
  quoteAgeMinutes, dealAgeMinutes, normLocation, totalVolume, cityStats, computeBulkPlan,
} = require('../server.js');
const RECIPES = require('../data/recipes.json');
const { RRR_PRESETS, rrrFromBonus } = require('../data/refining');

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
  it('длина цикла партии: ступени 1 / 0.8 / 0.5 / 0.2 / 0.05', () => {
    expect([5, 10, 20, 60, 200].map(bulkCycleDecay)).toEqual([1, 0.8, 0.5, 0.2, 0.05]);
    expect(bulkCycleDecay(null)).toBe(0);
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
    itemId, enchant: 0, quality: 1, quantity: 100, days: 7, preset: RRR_PRESETS[0], rrr: 0,
    taxRate: 0.08, costCeiling: null, sellLow: null, sellHigh: null, queryCities: cities,
  };

  it('себестоимость, сроки и профит после налога', () => {
    const plan = computeBulkPlan(base, materialHistory, finishedHistory);
    const expectedCost = recipe.resources.reduce((sum, r, i) => sum + r.count * 1000 * (i + 1), 0) + (recipe.silver || 0);
    expect(plan.hasAllMaterialPrices).toBe(true);
    expect(plan.effectiveCostPerUnit).toBeCloseTo(expectedCost, 6);
    expect(plan.marketAvgSellPrice).toBeCloseTo(200000, 6);
    expect(plan.avgDailySellVolume).toBe(10);
    expect(plan.daysToSellBatch).toBeCloseTo(10, 6); // 100 шт при 10 в день
    expect(plan.profitPerUnitLow).toBeCloseTo(200000 * 0.92 - expectedCost, 6);
    expect(plan.totalDaysEstimate).toBeCloseTo(plan.daysToAcquireBatch + 10, 6);
  });
  it('узкое место — материал с максимальным сроком закупки', () => {
    const plan = computeBulkPlan(base, materialHistory, finishedHistory);
    const slowest = plan.recipe.reduce((a, b) => (b.daysToAcquire > a.daysToAcquire ? b : a));
    expect(plan.bottleneckResource).toBe(slowest.resource);
    expect(plan.daysToAcquireBatch).toBeCloseTo(slowest.daysToAcquire, 6);
  });
  it('RRR уменьшает и себестоимость, и закупаемое количество', () => {
    const rrr = rrrFromBonus(58);
    const withRrr = computeBulkPlan({ ...base, rrr }, materialHistory, finishedHistory);
    const without = computeBulkPlan(base, materialHistory, finishedHistory);
    expect(withRrr.effectiveCostPerUnit).toBeLessThan(without.effectiveCostPerUnit);
    expect(withRrr.recipe[0].neededAfterRrr).toBeLessThan(without.recipe[0].neededAfterRrr);
  });
  it('потолок себестоимости и полоса продажи', () => {
    const plan = computeBulkPlan({ ...base, costCeiling: 1, sellLow: 150000, sellHigh: 100000 }, materialHistory, finishedHistory);
    expect(plan.withinCeiling).toBe(false);
    expect([plan.sellLow, plan.sellHigh]).toEqual([100000, 150000]); // перепутанные границы меняются местами
    expect(plan.netSellLow).toBeCloseTo(100000 * 0.92, 6);
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
  const base = { history, itemId: 'X', days: 7, quantity: 140, taxRate: 0.08, costPerUnit: 1000, queryCities: ['Martlock', 'Lymhurst'] };

  it('цена — средневзвешенная по объёму выбранных городов, объём — в день', () => {
    const p = computePatientSell(base);
    expect(p.avgSellPrice).toBeCloseTo((30 * 1000 + 40 * 1200 + 70 * 1500) / 140, 6);
    expect(p.avgDailyVolume).toBe(20); // 140 сделок за 7 дней; Caerleon не выбран
    expect(p.bestCity).toEqual({ city: 'Lymhurst', avgPrice: 1500 });
  });
  it('дни на распродажу партии = количество / объём в день', () => {
    expect(computePatientSell(base).daysToSellBatch).toBeCloseTo(7, 6);
    expect(computePatientSell({ ...base, quantity: 20 }).daysToSellBatch).toBeCloseTo(1, 6);
  });
  it('профит — после налога и за вычетом себестоимости', () => {
    const p = computePatientSell(base);
    expect(p.netSellPrice).toBeCloseTo(p.avgSellPrice * 0.92, 6);
    expect(p.profitPerUnit).toBeCloseTo(p.netSellPrice - 1000, 6);
  });
  it('нет сделок в выбранных городах — null (блок терпеливой продажи не показывается)', () => {
    expect(computePatientSell({ ...base, queryCities: ['Bridgewatch'] })).toBeNull();
  });
});

describe('стоимость телепорта', () => {
  it('формула: ceil(вес × кол-во × коэффициент × 150), затем × дистанция', () => {
    expect(teleportStackCost('T4_WOOD', 100, 1)).toBe(Math.ceil(0.51 * 100 * 2 * 150)); // ресурс: коэффициент 2 → 15300
    expect(teleportStackCost('T4_WOOD', 100, 2)).toBe(15300 * 2);
    expect(teleportStackCost('T4_MAIN_SWORD', 3, 1)).toBe(2295);
    expect(teleportStackCost('T4_MAIN_SWORD', 3, 0)).toBe(0);
  });
  it('нет веса или маршрута — null', () => {
    expect(teleportStackCost('NO_SUCH_ITEM', 1, 1)).toBeNull();
    expect(teleportStackCost('T4_WOOD', 1, null)).toBeNull();
  });
  it('кольцо из 5 городов: соседние ×1, через город ×2, Бресильен всегда ×2, Каэрлеон недоступен', () => {
    expect(teleportDistance('Lymhurst', 'Bridgewatch')).toBe(1);
    expect(teleportDistance('Bridgewatch', 'Martlock')).toBe(1);
    expect(teleportDistance('Fort Sterling', 'Lymhurst')).toBe(1); // замыкание кольца
    expect(teleportDistance('Lymhurst', 'Martlock')).toBe(2);
    expect(teleportDistance('Martlock', 'Fort Sterling')).toBe(2);
    expect(teleportDistance('Brecilien', 'Thetford')).toBe(2);
    expect(teleportDistance('Martlock', 'Brecilien')).toBe(2);
    expect(teleportDistance('Caerleon', 'Martlock')).toBeNull();
    expect(teleportDistance('Martlock', 'Martlock')).toBe(0);
    expect(teleportDistance('FortSterling', 'Fort Sterling')).toBe(0);
  });

  const materials = [
    { resource: 'T4_WOOD', resourceName: 'Дерево', needed: 100, priceByCity: { Lymhurst: 100, Martlock: 90 } },
    { resource: 'T4_METALBAR', resourceName: 'Слитки', needed: 100, priceByCity: { Lymhurst: 200, Martlock: 200 } },
  ];
  const finished = { itemId: 'T4_MAIN_SWORD', qty: 10, instantByCity: { Martlock: 20000 }, patientByCity: null };

  it('дом выбирается по максимальной прибыли: собираем там, где не надо возить и материалы, и результат', () => {
    const plan = planCraftTeleport({ materials, finished, homes: ['Lymhurst', 'Martlock'], taxRate: 0.08 });
    expect(plan.homeCity).toBe('Martlock');
    expect(plan.legsCost).toBe(0);
    expect(plan.instant.cost).toBe(0);
    expect(plan.costPerUnit).toBeCloseTo((90 * 100 + 200 * 100) / 10, 6);
    expect(plan.instant.profitPerUnit).toBeCloseTo(20000 * 0.92 - plan.costPerUnit, 6);
  });
  it('дорогая дорога перебивает дешёвую цену: материал берём в городе дома, а не дешевле, но далеко', () => {
    const heavy = [{ resource: 'T4_WOOD', resourceName: 'Дерево', needed: 1000, priceByCity: { Lymhurst: 101, Martlock: 100 } }];
    const plan = planCraftTeleport({ materials: heavy, finished: { ...finished, instantByCity: { Lymhurst: 50000 } }, homes: ['Lymhurst'], taxRate: 0.08 });
    expect(plan.materialLegs[0].fromCity).toBe('Lymhurst'); // перевозка из Мартлока стоит больше, чем разница в цене
    expect(plan.legsCost).toBe(0);
  });
  it('Каэрлеон нельзя ни как источник, ни как город продажи: маршрута нет', () => {
    const plan = planCraftTeleport({
      materials: [{ resource: 'T4_WOOD', resourceName: 'Дерево', needed: 10, priceByCity: { Caerleon: 1 } }],
      finished, homes: ['Martlock'], taxRate: 0.08,
    });
    expect(plan).toBeNull();
  });
});

describe('порог терпеливой продажи', () => {
  const cities = [
    { city: 'Martlock', avgPrice: 120000, avgDailyVolume: 2 },
    { city: 'Lymhurst', avgPrice: 100000, avgDailyVolume: 10 },
    { city: 'Thetford', avgPrice: 115000, avgDailyVolume: 3 },
  ];
  it('берёт только города не ниже порога, по убыванию цены, спрос суммируется', () => {
    const t = computeSellThreshold(cities, 110000, 100);
    expect(t.cities.map((c) => c.city)).toEqual(['Martlock', 'Thetford']);
    expect(t.totalDailyVolume).toBe(5);
    expect(t.daysToSellBatch).toBeCloseTo(20, 6); // 100 шт при 5 в день
  });
  it('нет городов выше порога — пусто и без срока', () => {
    const t = computeSellThreshold(cities, 999999, 100);
    expect(t.cities).toEqual([]);
    expect(t.daysToSellBatch).toBeNull();
  });
});

describe('терпеливая продажа: качество и разбивка по городам', () => {
  const history = [
    { item_id: 'X', location: 'Martlock', quality: 1, data: [{ item_count: 7, avg_price: 1000 }] },
    { item_id: 'X', location: 'Martlock', quality: 4, data: [{ item_count: 700, avg_price: 1500 }] },
    { item_id: 'X', location: 'Lymhurst', quality: 4, data: [{ item_count: 70, avg_price: 2000 }] },
  ];
  const base = { history, itemId: 'X', days: 7, quantity: 100, taxRate: 0, costPerUnit: 500, queryCities: ['Martlock', 'Lymhurst'] };

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
    itemId, enchant: 0, quantity: 100, days: 7, preset: RRR_PRESETS[0], rrr: 0, taxRate: 0, costCeiling: null,
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
