// Цены материала по городам: строки панели «Все города», закупка со своими ценами городов и её влияние на себестоимость.
import { describe, it, expect } from 'vitest';
import { cityRows, bestBuy, priceLists } from '../public/js/next/logic/cityPrices.js';
import { applyManualPrices } from '../public/js/next/logic/manual.js';
import { withOverride, mergeRows } from '../public/js/next/logic/acquire.js';

const list = [{ city: 'Martlock', price: 100 }, { city: 'Lymhurst', price: 110 }, { city: 'Thetford', price: 130 }];
const cities = ['Martlock', 'Lymhurst', 'Thetford', 'Bridgewatch'];

describe('cityRows', () => {
  it('все активные города, даже без рыночной цены; лучший по рынку с комиссией 2.5% помечен', () => {
    const rows = cityRows(list, {}, cities);
    expect(rows.map((r) => r.city)).toEqual(['Martlock', 'Lymhurst', 'Thetford', 'Bridgewatch']);
    expect(rows[0]).toMatchObject({ city: 'Martlock', market: 100, isBest: true });
    expect(rows.find((r) => r.city === 'Bridgewatch')).toMatchObject({ market: null, isBest: false });
    expect(rows.filter((r) => r.isBest)).toHaveLength(1);
  });
  it('своя цена — как есть (без комиссии) и может сделать лучшим другой город, в том числе без рыночной цены', () => {
    const rows = cityRows(list, { Lymhurst: 90, Bridgewatch: 80 }, cities);
    expect(rows[0]).toMatchObject({ city: 'Bridgewatch', own: 80, market: null, isBest: true });
    expect(rows[1]).toMatchObject({ city: 'Lymhurst', own: 90, market: 110 });
  });
});

describe('bestBuy', () => {
  it('без своих цен — undefined (расчёт идёт по рынку сервера)', () => {
    expect(bestBuy(list, {}, cities)).toBeUndefined();
    expect(bestBuy(list, undefined, cities)).toBeUndefined();
  });
  it('своя цена сравнивается с рынком другого города с комиссией', () => {
    expect(bestBuy(list, { Lymhurst: 90 }, cities)).toEqual({ price: 90, city: 'Lymhurst', fromOwn: true });
    expect(bestBuy(list, { Lymhurst: 120 }, cities)).toMatchObject({ city: 'Martlock', fromOwn: false });   // 100 × 1.025 = 102.5 < 120
    expect(bestBuy(list, { Martlock: 101 }, cities)).toMatchObject({ price: 101, city: 'Martlock', fromOwn: true });
  });
});

describe('priceLists и закупка по своим ценам городов в расчёте', () => {
  const data = () => ({
    quantity: 10, taxRate: 0.08, effectiveCostPerUnit: 1500, materialCostPerUnit: 2000, totalCost: 15000, netSellPrice: 3000, profitPerUnit: 1500, totalProfit: 15000, patientSell: null, enchantAfterCraft: null, baseChoice: null,
    recipe: [
      { resource: 'T4_CLOTH', count: 20, rrr: 0.25, returnable: true, cheapestPrice: 102.5, cheapestCity: 'Martlock', materialSource: 'buy', cityPrices: list },
      { resource: 'T4_PLANKS', count: 5, rrr: 0.25, returnable: true, cheapestPrice: 60, cheapestCity: 'Thetford', materialSource: 'refine', buyPrice: 100, buyCity: 'Martlock', cityPrices: list,
        refineOption: { rate: 0.5, city: 'Thetford', components: [{ id: 'T4_WOOD', count: 2, price: 60 }] } },
    ],
  });
  it('списки цен берутся из строк рецепта и шагов чар', () => {
    const d = data();
    d.enchantAfterCraft = { steps: [{ materialId: 'T4_RUNE', cityPrices: [{ city: 'Brecilien', price: 5 }] }], baseSource: 'craft', stepsCostPerUnit: 0 };
    const lists = priceLists(d);
    expect(Object.keys(lists).sort()).toEqual(['T4_CLOTH', 'T4_PLANKS', 'T4_RUNE']);
    expect(lists.T4_CLOTH).toEqual(list);
  });
  it('своя цена города: город и цена закупки меняются, себестоимость сдвигается на разницу × количество × (1 − возврат)', () => {
    const d = applyManualPrices(data(), { hasOwn: true, ownPrice: () => undefined, buyPrice: (res) => (res === 'T4_CLOTH' ? { price: 80, city: 'Thetford' } : undefined) });
    expect(d.recipe[0]).toMatchObject({ cheapestPrice: 80, cheapestCity: 'Thetford' });
    expect(d.effectiveCostPerUnit).toBeCloseTo(1500 + (80 - 102.5) * 0.75 * 20, 6);
    expect(d.manualPrices).toBe(true);
  });
  it('для переработки своя цена готового города решает «купить или переработать» (порог 5%); для крафта самому — купить готовый выгоднее на 5%+', () => {
    const cheapBuy = applyManualPrices(data(), { hasOwn: true, ownPrice: () => undefined, buyPrice: (res) => (res === 'T4_PLANKS' ? { price: 50, city: 'Lymhurst' } : undefined) });
    expect(cheapBuy.recipe[1]).toMatchObject({ materialSource: 'buy', cheapestPrice: 50, cheapestCity: 'Lymhurst' });        // переработка 60 дороже покупки 50
    const dearBuy = applyManualPrices(data(), { hasOwn: true, ownPrice: () => undefined, buyPrice: (res) => (res === 'T4_PLANKS' ? { price: 200, city: 'Lymhurst' } : undefined) });
    expect(dearBuy.recipe[1]).toMatchObject({ materialSource: 'refine', cheapestPrice: 60 });
    const craft = data();
    craft.recipe[1] = { ...craft.recipe[1], materialSource: 'craft', refineOption: null, craftOption: { components: [] }, cheapestPrice: 100 };
    const bought = applyManualPrices(craft, { hasOwn: true, ownPrice: () => undefined, buyPrice: (res) => (res === 'T4_PLANKS' ? { price: 90, city: 'Martlock' } : undefined) });
    expect(bought.recipe[1]).toMatchObject({ materialSource: 'buy', cheapestPrice: 90 });                                     // 90 < 100 × 0.95
    const stay = applyManualPrices(craft, { hasOwn: true, ownPrice: () => undefined, buyPrice: (res) => (res === 'T4_PLANKS' ? { price: 97, city: 'Martlock' } : undefined) });
    expect(stay.recipe[1].materialSource).toBe('craft');
  });
  it('строка закупки по своей цене города и сводка нескольких позиций сохраняет ключ материала', () => {
    const row = { id: 'T4_CLOTH', key: 'T4_CLOTH', name: 'Ткань', needed: 20, cities: [{ city: 'Martlock', qty: 20, price: 102.5 }], unit: 102.5, sum: 2050, missing: false };
    expect(withOverride(row, { price: 80, city: 'Thetford' })).toMatchObject({ unit: 80, sum: 1600, cities: [{ city: 'Thetford', qty: 20, price: 80 }], manual: true });
    expect(withOverride(row, undefined)).toBe(row);
    expect(mergeRows([[row], [row]])[0]).toMatchObject({ key: 'T4_CLOTH', needed: 40 });
  });
});
