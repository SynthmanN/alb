// Чистая логика новой страницы «Крафт»: план закупки по ответу калькулятора и профит позиции.
import { describe, it, expect } from 'vitest';
import { acquisitionRows, mergeRows, missingRows } from '../public/js/next/logic/acquire.js';
import { profitOf } from '../public/js/next/logic/profit.js';

const base = (extra = {}) => ({ itemId: 'T4_CAPE', enchant: 0, quantity: 10, names: { T4_CLOTH: 'T4 Изысканная ткань', T4_RUNE: 'Руна (знаток)' }, recipe: [], acquire: { byResource: [] }, ...extra });

describe('acquisitionRows', () => {
  it('обычная покупка: количество после возврата, город и цена из плана по городам; сумма = Σ количество × цена', () => {
    const d = base({
      recipe: [{ resource: 'T4_CLOTH', queryId: 'T4_CLOTH', materialSource: 'buy', neededToBuy: 100, buyPrice: 50, cheapestPrice: 50, cheapestCity: 'Martlock' }],
      acquire: { byResource: [{ resource: 'T4_CLOTH', source: 'buy', plan: { avgPrice: 55, cities: [{ city: 'Martlock', qty: 60, avgPrice: 50 }, { city: 'Lymhurst', qty: 40, avgPrice: 62.5 }] } }] },
    });
    const [r] = acquisitionRows(d);
    expect(r).toMatchObject({ id: 'T4_CLOTH', name: 'T4 Изысканная ткань', needed: 100, missing: false });
    expect(r.cities).toEqual([{ city: 'Martlock', qty: 60, price: 50 }, { city: 'Lymhurst', qty: 40, price: 62.5 }]);
    expect(r.sum).toBeCloseTo(60 * 50 + 40 * 62.5, 6);
  });
  it('нет плана по городам — самый дешёвый город и цена; нет цены — строка «не хватает»', () => {
    const d = base({ recipe: [
      { resource: 'T4_CLOTH', queryId: 'T4_CLOTH', materialSource: 'buy', neededToBuy: 10, cheapestPrice: 40, cheapestCity: 'Thetford' },
      { resource: 'T4_LEATHER', queryId: 'T4_LEATHER', materialSource: 'buy', neededToBuy: 5, cheapestPrice: null, cheapestCity: null },
    ] });
    const rows = acquisitionRows(d);
    expect(rows[0]).toMatchObject({ unit: 40, sum: 400, cities: [{ city: 'Thetford', qty: 10, price: 40 }] });
    expect(rows[1]).toMatchObject({ missing: true, unit: null, sum: null });
    expect(missingRows(rows).map((r) => r.id)).toEqual(['T4_LEATHER']);
  });
  it('материал за очки в закупку не входит; переработка и крафт раскладываются на компоненты с пояснением', () => {
    const d = base({ recipe: [
      { resource: 'T4_CAPEITEM_FW_MARTLOCK_BP', materialSource: 'points', neededToBuy: 10 },
      { resource: 'T4_METALBAR', queryId: 'T4_METALBAR', resourceName: 'Слиток', materialSource: 'refine', neededToBuy: 20, refineOption: { rate: 0.5, components: [{ id: 'T4_ORE', count: 2, price: 10, city: 'Martlock' }, { id: 'T3_METALBAR', count: 1, price: 30, city: 'Lymhurst' }] } },
      { resource: 'T4_CAPE', queryId: 'T4_CAPE', materialSource: 'craft', neededToBuy: 3, craftOption: { components: [{ id: 'T4_CLOTH', count: 4, factor: 0.75, price: 50, city: 'Martlock' }] } },
    ] });
    const rows = acquisitionRows(d);
    expect(rows.map((r) => r.id)).toEqual(['T4_ORE', 'T3_METALBAR', 'T4_CLOTH']);
    expect(rows[0]).toMatchObject({ needed: 20, why: expect.stringContaining('сырьё') });        // 20 × 2 × (1 − 0.5)
    expect(rows[1]).toMatchObject({ needed: 10, why: expect.stringContaining('предыдущий тир') });
    expect(rows[2]).toMatchObject({ needed: 9, why: expect.stringContaining('для крафта') });     // ceil(3 × 4 × 0.75)
  });
  it('чары после крафта: шаги рун/душ/реликтов; базовый плащ .0 — одной строкой, если выгоднее купить готовый', () => {
    const d = base({
      enchant: 2, recipe: [{ resource: 'T4_CLOTH', queryId: 'T4_CLOTH', materialSource: 'buy', neededToBuy: 1, cheapestPrice: 1, cheapestCity: 'Martlock' }],
      enchantAfterCraft: { baseSource: 'buy', baseBuy: { city: 'Lymhurst', price: 4000 }, targetLevel: 2, steps: [{ level: 1, materialId: 'T4_RUNE', materialName: 'Руна (знаток)', count: 96, cheapestCity: 'Brecilien', cheapestPrice: 5 }] },
    });
    const rows = acquisitionRows(d);
    expect(rows.map((r) => r.id)).toEqual(['T4_CAPE', 'T4_RUNE']);
    expect(rows[0]).toMatchObject({ needed: 10, unit: 4000, sum: 40000, why: expect.stringContaining('купить готовый') });
    expect(rows[1]).toMatchObject({ needed: 960, name: 'Руна (знаток)', sum: 4800 });
  });
  it('вход в цепочку не с нуля (chainEntryLevel > 0): в закупку идёт покупка уже готового уровня + только нужные шаги дальше', () => {
    const d = base({
      enchant: 2, recipe: [{ resource: 'T4_CLOTH', queryId: 'T4_CLOTH', materialSource: 'buy', neededToBuy: 1, cheapestPrice: 1, cheapestCity: 'Martlock' }],
      names: { 'T4_CAPE@1': 'Плащ .1', T4_SOUL: 'Душа' },
      enchantAfterCraft: {
        baseSource: 'craft', baseBuy: null, targetLevel: 2, chainEntryLevel: 1, chainEntryId: 'T4_CAPE@1', chainEntryLabel: 'Плащ .1', chainEntryCity: 'Caerleon',
        steps: [{ level: 1, materialId: 'T4_RUNE', materialName: 'Руна (знаток)', count: 96, cheapestCity: 'Brecilien', cheapestPrice: 5 }, { level: 2, materialId: 'T4_SOUL', materialName: 'Душа', count: 96, cheapestCity: 'Martlock', cheapestPrice: 10 }],
        neededSteps: [{ level: 2, materialId: 'T4_SOUL', materialName: 'Душа', count: 96, cheapestCity: 'Martlock', cheapestPrice: 10 }],
        candidates: [{ entryLevel: 1, cost: 3960, entryPrice: 3000 }],
      },
    });
    const rows = acquisitionRows(d);
    // базовый рецепт .0 (T4_CLOTH) не участвует, руна (шаг 1) тоже не нужна — вход уже с .1
    expect(rows.map((r) => r.id)).toEqual(['T4_CAPE@1', 'T4_SOUL']);
    expect(rows[0]).toMatchObject({ needed: 10, unit: 3000, why: expect.stringContaining('куплено готовым') });
    expect(rows[0].cities).toEqual([{ city: 'Caerleon', qty: 10, price: 3000 }]);
    expect(rows[1]).toMatchObject({ needed: 960, name: 'Душа', sum: 9600 });
  });
});

describe('mergeRows', () => {
  it('одинаковые материалы складываются по количеству, города объединяются', () => {
    const a = [{ id: 'X', name: 'X', needed: 10, missing: false, cities: [{ city: 'Martlock', qty: 10, price: 5 }] }];
    const b = [{ id: 'X', name: 'X', needed: 20, missing: false, cities: [{ city: 'Martlock', qty: 15, price: 6 }, { city: 'Lymhurst', qty: 5, price: 7 }] }];
    const [m] = mergeRows([a, b]);
    expect(m.needed).toBe(30);
    expect(m.cities.find((c) => c.city === 'Martlock')).toMatchObject({ qty: 25 });
    expect(m.sum).toBeCloseTo(10 * 5 + 15 * 6 + 5 * 7, 6);
  });
});

describe('profitOf', () => {
  it('главный показатель — Sell Order (план продажи), запасной — мгновенная продажа; ROI, доходы, срок продажи', () => {
    const p = profitOf({ quantity: 10, effectiveCostPerUnit: 1000, totalCost: 10000, profitPerUnit: -50, hasAllMaterialPrices: true, patientSell: { profitPerUnit: 300, daysToSellBatch: 4, plan: { cities: [{ city: 'A' }], profitPerUnit: 400, totalDays: 2 } } });
    expect(p).toMatchObject({ unit: 400, basis: 'sell', total: 4000, days: 2, instant: -50, complete: true });
    expect(p.roi).toBeCloseTo(40, 6);
    expect(p.income).toBe(14000);
    const instantOnly = profitOf({ quantity: 1, effectiveCostPerUnit: 100, profitPerUnit: 20, patientSell: null });
    expect(instantOnly).toMatchObject({ unit: 20, basis: 'buy' });
  });
  it('нет цен — показатель пустой; нет цены материала — позиция помечена неполной', () => {
    expect(profitOf({ quantity: 1, effectiveCostPerUnit: 100, profitPerUnit: null, patientSell: null }).unit).toBeNull();
    expect(profitOf({ quantity: 1, effectiveCostPerUnit: 100, profitPerUnit: 5, hasAllMaterialPrices: false }).complete).toBe(false);
    expect(profitOf(null)).toBeNull();
  });
});
