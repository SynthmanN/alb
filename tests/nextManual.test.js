// Свои цены и план продажи в новом калькуляторе: та же арифметика, что была в старом клиенте.
import { describe, it, expect } from 'vitest';
import { applyManualPrices, lotsAverage, salePlanState, distributeQty, salePlanByCity } from '../public/js/next/logic/manual.js';

const base = () => ({
  quantity: 10, taxRate: 0.08, setupFeeRate: 0.025, effectiveCostPerUnit: 1000, materialCostPerUnit: 1000, totalCost: 10000, netSellPrice: 2000, profitPerUnit: 1000, totalProfit: 10000, bestSell: { city: 'Martlock', price: 2200, taxRate: 0.08 },
  recipe: [{ resource: 'T4_CLOTH', count: 10, cheapestPrice: 100, rrr: 0.25, returnable: true, materialSource: 'buy', refineOption: null }],
  enchantAfterCraft: null, baseChoice: null,
  patientSell: { profitPerUnit: 800, plan: { cities: [], profitPerUnit: 800 }, byCity: [
    { city: 'Lymhurst', avgSellPrice: 3000, avgDailyVolume: 8, taxRate: 0.1, netPrice: 2700, profitPerUnit: 1700, profitIndex: 100 },
    { city: 'Thetford', avgSellPrice: null, avgDailyVolume: 0, taxRate: 0.1, noData: true, profitPerUnit: null },
  ] },
});

describe('applyManualPrices', () => {
  it('без своих цен данные не меняются', () => {
    const d = base();
    expect(applyManualPrices(d, { hasOwn: false, ownPrice: () => undefined })).toBe(d);
  });
  it('своя цена материала: себестоимость меняется на разницу × количество × (1 − возврат); профит и итог пересчитываются', () => {
    const d = applyManualPrices(base(), { hasOwn: true, ownPrice: (r) => (r === 'T4_CLOTH' ? 120 : undefined) });
    expect(d.effectiveCostPerUnit).toBeCloseTo(1000 + (120 - 100) * 0.75 * 10, 6);          // +150
    expect(d.totalCost).toBeCloseTo(11500, 6);
    expect(d.profitPerUnit).toBeCloseTo(2000 - 1150, 6);
    expect(d.recipe[0]).toMatchObject({ cheapestPrice: 120, marketPrice: 100, manualPrice: true });
    expect(d.patientSell.profitPerUnit).toBeCloseTo(800 - 150, 6);                          // терпеливая продажа сдвигается на ту же разницу
    expect(d.patientSell.byCity[0].profitPerUnit).toBeCloseTo(1700 - 150, 6);
    expect(d.manualPrices).toBe(true);
  });
  it('своя цена мгновенной продажи и своя цена города заменяют рыночные и пересчитывают чистую цену и профит', () => {
    const d = applyManualPrices(base(), { hasOwn: false, sellPrice: 1500, cityPrices: { Thetford: 2500, Lymhurst: 3500 } });
    expect(d.bestSell).toMatchObject({ price: 1500, manual: true });
    expect(d.netSellPrice).toBeCloseTo(1500 * 0.92, 6);
    const t = d.patientSell.byCity.find((c) => c.city === 'Thetford');
    expect(t).toMatchObject({ avgSellPrice: 2500, ownPrice: true });
    expect(t.profitPerUnit).toBeCloseTo(2500 * 0.9 - 1000, 6);
    expect(d.patientSell.byCity.find((c) => c.city === 'Lymhurst').netPrice).toBeCloseTo(3500 * 0.9, 6);
  });
  it('своя цена сырья переработки может сделать переработку выгодной (порог 5%) и меняет источник', () => {
    const data = base();
    data.recipe = [{ resource: 'T4_METALBAR', count: 10, cheapestPrice: 200, rrr: 0.25, returnable: true, materialSource: 'buy', buyCity: 'Martlock', buyPrice: 200,
      refineOption: { rate: 0.5, city: 'Thetford', components: [{ id: 'T4_ORE', count: 2, price: 100 }, { id: 'T3_METALBAR', count: 1, price: 100 }] } }];
    const d = applyManualPrices(data, { hasOwn: true, ownPrice: (r) => (r === 'T4_ORE' ? 20 : undefined) });   // сырьё 2×20 + 100 = 140 × 0.5 = 70 < 200×0.95
    expect(d.recipe[0]).toMatchObject({ materialSource: 'refine', cheapestPrice: 70, cheapestCity: 'Thetford' });
  });
});

describe('лог закупок', () => {
  it('средняя цена по стакам и сколько куплено; пустые и нулевые стаки игнорируются', () => {
    expect(lotsAverage([{ qty: 100, price: 10 }, { qty: 300, price: 20 }, { qty: '', price: 5 }])).toEqual({ qty: 400, avg: 17.5 });
    expect(lotsAverage([])).toBeNull();
    expect(lotsAverage(undefined)).toBeNull();
  });
});

describe('план продажи по городам', () => {
  const byCity = [
    { city: 'A', avgSellPrice: 100, avgDailyVolume: 10, profitPerUnit: 50, profitIndex: 80, taxRate: 0.1 },
    { city: 'B', avgSellPrice: 90, avgDailyVolume: 30, profitPerUnit: 40, profitIndex: 120, taxRate: 0.1 },
    { city: 'C', avgSellPrice: null, avgDailyVolume: 0, profitPerUnit: null, taxRate: 0.1, noData: true },
  ];
  const p = { byCity, marketShare: 0.25, plan: null };
  const data = { quantity: 40, taxRate: 0.08, setupFeeRate: 0.025, effectiveCostPerUnit: 50 };
  it('равномерно: партия делится пропорционально обороту, остаток округления — самому ликвидному', () => {
    const m = salePlanByCity(byCity, 41, 0.25, null);
    expect(m.rows.get('A').qty).toBe(10);
    expect(m.rows.get('B').qty).toBe(31);
    expect([...distributeQty(byCity.slice(0, 2), 40, 0.25, 'even')].map(([c, q]) => `${c}:${q}`)).toEqual(['A:10', 'B:30']);
  });
  it('максимизация профита: лучший по индексу город берёт партию первым, но не больше 1.5× разумной вместимости; остаток делится по обороту', () => {
    const out = distributeQty(byCity.slice(0, 2), 40, 0.25, 'profit');
    // evenDays = 40 / (40 × 0.25) = 4; вместимость B = floor(30 × 0.25 × 4 × 1.5) = 45 ≥ 40 → всё в B
    expect(out.get('B')).toBe(40);
    expect(out.get('A')).toBe(0);
  });
  it('состояние плана: выключенный город даёт 0, своё количество фиксируется, остальные делят остаток; город без цены в план не идёт', () => {
    const st = salePlanState(p, data, { toggles: null, manualQty: { A: 15 }, strategy: 'profit' });
    const q = Object.fromEntries(st.rowsData.map((r) => [r.c.city, r.qty]));
    expect(q).toEqual({ A: 15, B: 25, C: 0 });
    expect(st.totalQty).toBe(40);
    expect(st.anyManual).toBe(true);
    const off = salePlanState(p, data, { toggles: { A: false, B: true }, manualQty: {}, strategy: 'even' });
    expect(Object.fromEntries(off.rowsData.map((r) => [r.c.city, r.qty]))).toEqual({ A: 0, B: 40, C: 0 });
    expect(off.netPrice).toBeCloseTo(90 * (1 - 0.08 - 0.025), 6);
    expect(off.profitUnit).toBeCloseTo(off.netPrice - 50, 6);
  });
});
