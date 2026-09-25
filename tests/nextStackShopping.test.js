// Сводная закупка стека: у каждого материала есть список городов и своя цена — даже если рыночных цен нет; свои цены закрывают материал
import { describe, it, expect } from 'vitest';
import { priceLists, cityRows } from '../public/js/next/logic/cityPrices.js';
import { applyManualPrices } from '../public/js/next/logic/manual.js';
import { acquisitionRows, mergeRows } from '../public/js/next/logic/acquire.js';
import { missingPrices } from '../public/js/next/logic/stack.js';

const base = (recipe, extra = {}) => ({
  quantity: 2, itemId: 'T4_CAPEITEM_FW_LYMHURST', enchant: 2, taxRate: 0.08, setupFeeRate: 0.025, rrrOptions: { gearRate: 0.2 },
  effectiveCostPerUnit: 1000, materialCostPerUnit: 1000, totalCost: 2000, hasAllMaterialPrices: true, patientSell: null, acquire: { byResource: [] }, recipe, ...extra,
});
const row = (o) => ({ resource: 'T4_CAPE', queryId: 'T4_CAPE@2', count: 1, rrr: 0.2, returnable: true, neededToBuy: 2, materialSource: 'buy', cheapestPrice: 500, cheapestCity: 'Martlock', buyPrice: 500, buyCity: 'Martlock', cityPrices: [{ city: 'Martlock', price: 500 }], ...o });

describe('списки городов и ключи материалов', () => {
  it('ключ материала — с зачарованием: плащ .1 и .3 — разные материалы', () => {
    const l = priceLists(base([row({ queryId: 'T4_CAPE@1' }), row({ queryId: 'T4_CAPE@3' })]));
    expect(Object.keys(l).sort()).toEqual(['T4_CAPE@1', 'T4_CAPE@3']);
  });

  it('материал без цен на рынке получает пустой список; в панели — все активные города', () => {
    const l = priceLists(base([row({ cheapestPrice: null, cheapestCity: null, buyPrice: null, cityPrices: [] })]));
    expect(l['T4_CAPE@2']).toEqual([]);
    const rows = cityRows(l['T4_CAPE@2'], undefined, ['Lymhurst', 'Martlock', 'Caerleon']);
    expect(rows.map((r) => r.city).sort()).toEqual(['Caerleon', 'Lymhurst', 'Martlock']);
    expect(rows.every((r) => r.market === null)).toBe(true);
  });

  it('компоненты крафта самому (ткань, кожа) попадают в списки с городом выбора без комиссии', () => {
    const d = base([row({ materialSource: 'craft', craftOption: { price: 900, components: [{ id: 'T4_CLOTH', count: 2, factor: 0.8, price: 102.5, city: 'Martlock' }, { id: 'T4_LEATHER', count: 2, factor: 0.8, price: 50, city: null }] } })]);
    const l = priceLists(d);
    expect(l.T4_CLOTH).toHaveLength(1);
    expect(l.T4_CLOTH[0].city).toBe('Martlock');
    expect(l.T4_CLOTH[0].price).toBeCloseTo(100, 6);
    expect(l.T4_LEATHER).toEqual([]);
  });
});

describe('свои цены закрывают материал', () => {
  it('нет цены на рынке: своя цена входит в себестоимость, позиция перестаёт быть «без цены»', () => {
    const d = base([row({ cheapestPrice: null, cheapestCity: null, buyPrice: null, cityPrices: [] })], { hasAllMaterialPrices: false, effectiveCostPerUnit: 0, materialCostPerUnit: 0, totalCost: 0 });
    expect(missingPrices(d)).toHaveLength(1);
    const out = applyManualPrices(d, { hasOwn: true, ownPrice: (k) => (k === 'T4_CAPE@2' ? 400 : undefined) });
    expect(out.recipe[0]).toMatchObject({ cheapestPrice: 400, manualPrice: true });
    expect(out.effectiveCostPerUnit).toBeCloseTo(400 * 0.8, 6);          // возврат 20% на возвращаемый материал
    expect(out.hasAllMaterialPrices).toBe(true);
    expect(missingPrices(out)).toHaveLength(0);
  });

  it('нет цены на рынке: своя цена города даёт и цену, и город', () => {
    const d = base([row({ cheapestPrice: null, cheapestCity: null, buyPrice: null, cityPrices: [] })], { hasAllMaterialPrices: false, effectiveCostPerUnit: 0 });
    const out = applyManualPrices(d, { hasOwn: true, ownPrice: () => undefined, buyPrice: (k) => (k === 'T4_CAPE@2' ? { price: 450, city: 'Caerleon' } : undefined) });
    expect(out.recipe[0]).toMatchObject({ cheapestPrice: 450, cheapestCity: 'Caerleon' });
  });

  it('цена вписана для плаща .1 — плащ .3 не меняется', () => {
    const d = base([row({ queryId: 'T4_CAPE@3' })]);
    const out = applyManualPrices(d, { hasOwn: true, ownPrice: (k) => (k === 'T4_CAPE@1' ? 100 : undefined) });
    expect(out.recipe[0].cheapestPrice).toBe(500);
  });

  it('крафт самому: своя цена ткани пересчитывает цену ингредиента и себестоимость', () => {
    const d = base([row({ materialSource: 'craft', cheapestPrice: 900, buyPrice: 2000, craftOption: { price: 900, components: [{ id: 'T4_CLOTH', count: 2, factor: 0.8, price: 100, city: 'Martlock' }, { id: 'T4_LEATHER', count: 2, factor: 0.8, price: 100, city: 'Martlock' }] } })], { effectiveCostPerUnit: 900 * 0.8 });
    const out = applyManualPrices(d, { hasOwn: true, ownPrice: (k) => (k === 'T4_CLOTH' ? 50 : undefined) });
    expect(out.recipe[0].craftOption.price).toBeCloseTo(900 + 2 * 0.8 * (50 - 100), 6);
    expect(out.recipe[0].cheapestPrice).toBeCloseTo(820, 6);
    expect(out.recipe[0].craftOption.components[0]).toMatchObject({ price: 50, manual: true });
  });

  it('готовая база .0 покупается по своей цене города', () => {
    const d = base([], { enchantAfterCraft: { steps: [], baseSource: 'buy', baseBuy: { city: 'Martlock', price: 800 }, baseCraftCostPerUnit: 1500, baseCostPerUnit: 800, stepsCostPerUnit: 0, targetLevel: 2 }, effectiveCostPerUnit: 800 });
    const out = applyManualPrices(d, { hasOwn: true, ownPrice: () => undefined, buyPrice: (k) => (k === 'T4_CAPEITEM_FW_LYMHURST' ? { price: 600, city: 'Caerleon' } : undefined) });
    expect(out.enchantAfterCraft.baseBuy).toMatchObject({ price: 600, city: 'Caerleon' });
    expect(out.effectiveCostPerUnit).toBe(600);
  });
});

describe('сводка закупки', () => {
  it('одинаковый материал нескольких позиций просто складывается', () => {
    const d1 = base([row({ resource: 'T4_CLOTH', queryId: 'T4_CLOTH', neededToBuy: 40 })]);
    const d2 = base([row({ resource: 'T4_CLOTH', queryId: 'T4_CLOTH', neededToBuy: 6 })]);
    const merged = mergeRows([acquisitionRows(d1), acquisitionRows(d2)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].needed).toBe(46);
    // убрали позицию из стека — её материалы уходят из сводки
    expect(mergeRows([acquisitionRows(d1)])[0].needed).toBe(40);
  });
});

describe('сводка закупки: мусорные города', () => {
  it('город с нулём штук или без цены не попадает в сводку и не ломает сумму', () => {
    const rows = [{ id: 'X', key: 'X', name: 'X', needed: 1, missing: false, why: '', cities: [{ city: 'Martlock', qty: 1, price: 100 }, { city: 'Fort Sterling', qty: 0, price: undefined }] }];
    const merged = mergeRows([rows]);
    expect(merged[0].cities).toEqual([{ city: 'Martlock', qty: 1, price: 100 }]);
    expect(merged[0].sum).toBe(100);
  });
});

describe('missingPrices — вход в цепочку зачарования не с нуля (chainEntryLevel > 0)', () => {
  const eac = (over) => ({
    forced: false, targetLevel: 2, capped: false, baseSource: 'craft', baseBuy: null, baseCraftCostPerUnit: 1000, baseCostPerUnit: 1000,
    steps: [{ level: 1, materialId: 'T4_RUNE', materialName: 'Руна', count: 96, cheapestPrice: null, cost: null }, { level: 2, materialId: 'T4_SOUL', materialName: 'Душа', count: 96, cheapestPrice: 10, cost: 960 }],
    chainEntryLevel: 1, neededSteps: [{ level: 2, materialId: 'T4_SOUL', materialName: 'Душа', count: 96, cheapestPrice: 10, cost: 960 }], candidates: [{ entryLevel: 1, cost: 6960, entryPrice: 6000 }],
    ...over,
  });
  it('вход куплен с .1 — базовый рецепт .0 не при чём, его недостающая цена не считается (материал не нужен для этого пути)', () => {
    const d = base([row({ cheapestPrice: null })], { enchantAfterCraft: eac() });   // рецепт .0 без цены материала
    expect(missingPrices(d)).toHaveLength(0);   // руна (шаг 1) тоже не нужна — вход уже с .1; душа (шаг 2, neededSteps) — с ценой
  });
  it('вход куплен с .1, но и у нужного шага (душа) нет цены — вот это уже настоящая недостающая цена', () => {
    const d = base([row({ cheapestPrice: null })], {
      enchantAfterCraft: eac({ steps: [{ level: 1, materialId: 'T4_RUNE', materialName: 'Руна', count: 96, cheapestPrice: null, cost: null }, { level: 2, materialId: 'T4_SOUL', materialName: 'Душа', count: 96, cheapestPrice: null, cost: null }], neededSteps: [{ level: 2, materialId: 'T4_SOUL', materialName: 'Душа', count: 96, cheapestPrice: null, cost: null }] }),
    });
    expect(missingPrices(d)).toEqual([{ id: 'T4_SOUL', label: 'Душа' }]);   // рецепт .0 по-прежнему не в счёт — только реально нужный шаг
  });
  it('вход с нуля (chainEntryLevel 0) — рецепт .0 снова в счёт, как раньше', () => {
    const d = base([row({ cheapestPrice: null })], { enchantAfterCraft: eac({ chainEntryLevel: 0, neededSteps: eac().steps }) });
    expect(missingPrices(d)).toHaveLength(2);   // рецепт .0 (без цены) + руна (шаг 1, без цены) — душа с ценой, не в счёт
  });
});
