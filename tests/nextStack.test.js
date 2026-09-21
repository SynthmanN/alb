// Стеки позиций (крафт-лист и стек калькулятора): операции над позициями и свои цены материалов поверх ответа калькулятора.
import { describe, it, expect } from 'vitest';
import { createStack } from '../public/js/next/list.js';
import { adjustData, makeOverride } from '../public/js/next/logic/adjust.js';

const item = (o = {}) => ({ itemId: 'T4_CAPE', enchant: 0, quality: 4, quantity: 1, ...o });

describe('createStack', () => {
  it('одинаковая позиция складывается по количеству, новая получает uid и включена', () => {
    const s = createStack(null);
    s.add(item({ quantity: 2 }));
    s.add(item({ quantity: 3 }));
    s.add(item({ itemId: 'T5_CAPE' }));
    const { items } = s.store.get();
    expect(items.map((x) => [x.itemId, x.quantity, x.on])).toEqual([['T4_CAPE', 5, true], ['T5_CAPE', 1, true]]);
    expect(new Set(items.map((x) => x.uid)).size).toBe(2);
  });
  it('включение и выключение по клику, количество не меньше 1, удаление и правка полей', () => {
    const s = createStack(null);
    s.add(item());
    const id = s.store.get().items[0].uid;
    s.toggle(id);
    expect(s.store.get().items[0].on).toBe(false);
    s.toggle(id);
    expect(s.store.get().items[0].on).toBe(true);
    s.setQuantity(id, 0);
    expect(s.store.get().items[0].quantity).toBe(1);
    s.setQuantity(id, '12');
    s.patch(id, { crestSilver: true });
    expect(s.store.get().items[0]).toMatchObject({ quantity: 12, crestSilver: true });
    s.remove(id);
    expect(s.store.get().items).toEqual([]);
  });
  it('копия для стека калькулятора: свои uid, сохраняются включённость и поля; правки копии лист не меняют', () => {
    const list = createStack(null);
    const calc = createStack(null);
    list.add(item({ quantity: 4, faction: true }));
    list.add(item({ itemId: 'T6_CAPE' }));
    list.toggle(list.store.get().items[1].uid);
    calc.replaceAll(list.store.get().items.filter((x) => x.on !== false), { id: 'MARTLOCK', name: 'Мартлок', points: 100 });
    expect(calc.store.get().items).toHaveLength(1);
    expect(calc.store.get().items[0]).toMatchObject({ itemId: 'T4_CAPE', quantity: 4, faction: true, on: true });
    expect(calc.store.get().items[0].uid).not.toBe(list.store.get().items[0].uid);
    calc.setQuantity(calc.store.get().items[0].uid, 99);
    calc.remove(calc.store.get().items[0].uid);
    expect(list.store.get().items[0].quantity).toBe(4);
    expect(list.store.get().items).toHaveLength(2);
  });
  it('план очков заменяет только фракционные позиции; выключение автовыбора сбрасывает «после крафта»', () => {
    const s = createStack(null);
    s.add(item({ itemId: 'T4_2H_BOW' }));
    s.replaceFaction([item({ faction: true, after: true, enchant: 2 })], { id: 'A', name: 'A', points: 1 });
    s.replaceFaction([item({ faction: true, itemId: 'T5_CAPE' })], { id: 'A', name: 'A', points: 2 });
    expect(s.store.get().items.map((x) => x.itemId)).toEqual(['T4_2H_BOW', 'T5_CAPE']);
    s.patch(s.store.get().items[0].uid, { after: true });
    s.setAutoAfter(false);
    expect(s.store.get().items.every((x) => !x.after)).toBe(true);
  });
});

describe('свои цены материалов поверх ответа', () => {
  const data = () => ({
    quantity: 1, taxRate: 0.08, setupFeeRate: 0.025, effectiveCostPerUnit: 1500, materialCostPerUnit: 2000, totalCost: 1500, netSellPrice: 3000, profitPerUnit: 1500, totalProfit: 1500, patientSell: null, enchantAfterCraft: null, baseChoice: null,
    recipe: [{ resource: 'T4_CLOTH', count: 20, rrr: 0.25, returnable: true, cheapestPrice: 100, cheapestCity: 'Martlock', materialSource: 'buy', cityPrices: [{ city: 'Martlock', price: 100 }, { city: 'Lymhurst', price: 110 }] }],
  });
  const noPrices = { own: {}, cityOwn: {}, lots: {} };
  it('без своих цен данные не меняются; единая цена и цена города пересчитывают себестоимость', () => {
    const d = data();
    expect(adjustData(d, noPrices)).toBe(d);
    expect(adjustData(d, { ...noPrices, own: { T4_CLOTH: 120 } }).effectiveCostPerUnit).toBeCloseTo(1500 + 20 * 20 * 0.75, 6);
    const city = adjustData(d, { ...noPrices, cityOwn: { T4_CLOTH: { Lymhurst: 50 } } }, { cities: ['Martlock', 'Lymhurst'] });
    expect(city.recipe[0]).toMatchObject({ cheapestCity: 'Lymhurst', cheapestPrice: 50 });
    expect(city.effectiveCostPerUnit).toBeCloseTo(1500 + (50 - 100) * 0.75 * 20, 6);
  });
  it('единая цена важнее цен городов; лог лотов — только когда включён', () => {
    const lists = { T4_CLOTH: [{ city: 'Martlock', price: 100 }] };
    const p = { own: { T4_CLOTH: 70 }, cityOwn: { T4_CLOTH: { Martlock: 60 } }, lots: { T4_CLOTH: [{ qty: 10, price: 90 }] } };
    expect(makeOverride(lists, p, { cities: ['Martlock'] }).override('T4_CLOTH')).toEqual({ price: 70 });
    expect(makeOverride(lists, { ...p, own: {} }, { cities: ['Martlock'], purchaseLog: true }).override('T4_CLOTH')).toEqual({ price: 90 });
    expect(makeOverride(lists, { ...p, own: {} }, { cities: ['Martlock'] }).override('T4_CLOTH')).toEqual({ price: 60, city: 'Martlock' });
  });
});
