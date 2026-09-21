// Правки плана продажи по городам: чистые функции (общие для калькулятора и стека) и учёт правок в профите позиции
import { describe, it, expect } from 'vitest';
import { emptyPlan, planOf, isEdited, withCityPrice, withToggle, withManualQty, withStrategy, resetPlanState, applyItemPlan } from '../public/js/next/logic/planEdit.js';
import { salePlanState } from '../public/js/next/logic/manual.js';

const byCity = (city, price, vol) => ({ city, avgSellPrice: price, avgDailyVolume: vol, taxRate: 0.105, netPrice: price * 0.895, profitPerUnit: price * 0.895 - 1000, profitIndex: 20 });
const data = () => ({
  quantity: 10, taxRate: 0.08, setupFeeRate: 0.025, effectiveCostPerUnit: 1000, recipe: [], totalCost: 10000, materialCostPerUnit: 1000,
  patientSell: {
    marketShare: 1, byCity: [byCity('Lymhurst', 2000, 20), byCity('Martlock', 1900, 20)],
    plan: { cities: [{ city: 'Lymhurst', qty: 10, days: 0.5 }], excluded: [], totalDays: 0.5, profitPerUnit: 790 },
    profitPerUnit: 790,
  },
});

describe('правки плана продажи', () => {
  it('пустой план не считается правкой; любое изменение — правка', () => {
    expect(isEdited(emptyPlan())).toBe(false);
    expect(isEdited(withStrategy(emptyPlan(), 'even'))).toBe(true);
    expect(isEdited(withCityPrice(emptyPlan(), 'Lymhurst', '2500'))).toBe(true);
    expect(planOf({})).toEqual(emptyPlan());
  });

  it('своя цена города: вписали — есть, стёрли — нет; мусор игнорируется', () => {
    let p = withCityPrice(emptyPlan(), 'Lymhurst', '2500');
    expect(p.cityPrices).toEqual({ Lymhurst: 2500 });
    p = withCityPrice(p, 'Lymhurst', '');
    expect(p.cityPrices).toEqual({});
    expect(withCityPrice(p, 'Lymhurst', 'abc').cityPrices).toEqual({});
  });

  it('первое включение города фиксирует набор автоплана; выключение убирает своё количество', () => {
    const ps = data().patientSell;
    let p = withToggle(emptyPlan(), ps, 'Martlock', true);
    expect(p.toggles).toEqual({ Lymhurst: true, Martlock: true });
    p = withManualQty(p, ps, 'Martlock', '4');
    expect(p.manualQty.Martlock).toBe(4);
    p = withToggle(p, ps, 'Martlock', false);
    expect(p.toggles.Martlock).toBe(false);
    expect(p.manualQty.Martlock).toBeUndefined();
  });

  it('своё количество включает город в план; сброс возвращает автоплан, стратегия остаётся', () => {
    const ps = data().patientSell;
    let p = withStrategy(withManualQty(emptyPlan(), ps, 'Martlock', 3), 'even');
    expect(p.toggles.Martlock).toBe(true);
    p = resetPlanState(p);
    expect(p).toMatchObject({ toggles: null, manualQty: {}, cityPrices: {}, strategy: 'even' });
  });

  it('applyItemPlan: без правок ответ не меняется; с правками профит позиции идёт по живому плану', () => {
    const d = data();
    expect(applyItemPlan(d, emptyPlan())).toBe(d);
    const plan = withManualQty(withManualQty(emptyPlan(), d.patientSell, 'Lymhurst', 5), d.patientSell, 'Martlock', 5);
    const out = applyItemPlan(d, plan);
    const st = salePlanState(out.patientSell, out, plan);
    expect(st.totalQty).toBe(10);
    expect(out.patientSell.plan.cities.map((c) => c.city).sort()).toEqual(['Lymhurst', 'Martlock']);
    expect(out.patientSell.plan.profitPerUnit).toBeCloseTo(st.profitUnit, 6);
    expect(out.patientSell.plan.profitPerUnit).toBeLessThan(790);                     // Martlock дешевле — профит ниже автоплана
  });

  it('applyItemPlan: своя цена города пересчитывает профит города', () => {
    const d = data();
    const out = applyItemPlan(d, withCityPrice(emptyPlan(), 'Lymhurst', 3000));
    const ly = out.patientSell.byCity.find((c) => c.city === 'Lymhurst');
    expect(ly).toMatchObject({ avgSellPrice: 3000, ownPrice: true });
    expect(ly.profitPerUnit).toBeCloseTo(3000 * (1 - 0.105) - 1000, 6);
    expect(d.patientSell.byCity[0].avgSellPrice).toBe(2000);                          // исходный ответ не мутируется
  });
});
