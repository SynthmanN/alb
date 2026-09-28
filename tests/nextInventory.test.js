// Мои материалы: имеющееся уменьшает закупку, раздаётся позициям по порядку, показывает сколько гиров можно скрафтить уже сейчас
import { describe, it, expect } from 'vitest';
import { acquisition, acquisitionRows, mergeRows, withOverride, trimCities } from '../public/js/next/logic/acquire.js';
import { makePool, hasHave, coverage, craftableNow, allocateItem, allocateStack, materialTable } from '../public/js/next/logic/inventory.js';

const base = (recipe, extra = {}) => ({
  quantity: 10, itemId: 'T4_ARMOR_CLOTH_SET1', enchant: 0, acquire: { byResource: [] }, recipe, ...extra,
});
const buy = (id, need, price = 100, city = 'Martlock') => ({ resource: id, queryId: id, count: 8, neededToBuy: need, materialSource: 'buy', cheapestPrice: price, cheapestCity: city, buyPrice: price });

describe('пул материалов', () => {
  it('берёт не больше, чем есть, и не уходит в минус; дробные и мусорные значения игнорируются', () => {
    const p = makePool({ A: 10, B: '5', C: 0, D: -3, E: 'abc', F: 2.9 });
    expect(p.take('A', 4)).toBe(4);
    expect(p.take('A', 100)).toBe(6);
    expect(p.take('A', 1)).toBe(0);
    expect(p.take('B', 5)).toBe(5);
    expect(p.take('C', 1)).toBe(0);
    expect(p.take('D', 1)).toBe(0);
    expect(p.take('E', 1)).toBe(0);
    expect(p.take('F', 5)).toBe(2);
    expect(p.take('нет', 1)).toBe(0);
  });
  it('hasHave: пусто, нули и мусор — нет инвентаря', () => {
    expect(hasHave({})).toBe(false);
    expect(hasHave({ A: 0, B: '' })).toBe(false);
    expect(hasHave({ A: 1 })).toBe(true);
    expect(hasHave(undefined)).toBe(false);
  });
});

describe('закупка с учётом имеющегося', () => {
  it('без пула строки как раньше: toBuy = needed, have = 0', () => {
    const [r] = acquisitionRows(base([buy('T4_CLOTH', 40)]));
    expect(r).toMatchObject({ needed: 40, have: 0, toBuy: 40, sum: 4000, cities: [{ city: 'Martlock', qty: 40, price: 100 }] });
  });

  it('имеющееся уменьшает докупку, город и сумму считаются на докупаемое', () => {
    const [r] = acquisitionRows(base([buy('T4_CLOTH', 40)]), (x) => x, makePool({ T4_CLOTH: 15 }));
    expect(r).toMatchObject({ needed: 40, have: 15, toBuy: 25, sum: 2500, cities: [{ city: 'Martlock', qty: 25, price: 100 }], missing: false });
  });

  it('материала хватает: докупать нечего, сумма 0, «нет цены» не пугает', () => {
    const [r] = acquisitionRows(base([buy('T4_CLOTH', 40, null, null)]), (x) => x, makePool({ T4_CLOTH: 50 }));
    expect(r).toMatchObject({ have: 40, toBuy: 0, sum: 0, missing: false, cities: [] });
    const [none] = acquisitionRows(base([buy('T4_CLOTH', 40, null, null)]));
    expect(none.missing).toBe(true);
  });

  it('план сервера по городам подрезается: остаются самые дешёвые города', () => {
    const d = base([buy('T4_CLOTH', 40)], { acquire: { byResource: [{ resource: 'T4_CLOTH', plan: { avgPrice: 110, cities: [{ city: 'Thetford', qty: 15, avgPrice: 130 }, { city: 'Martlock', qty: 25, avgPrice: 100 }] } }] } });
    const [full] = acquisitionRows(d);
    expect(full.cities.map((c) => c.qty)).toEqual([15, 25]);
    const [r] = acquisitionRows(d, (x) => x, makePool({ T4_CLOTH: 20 }));
    expect(r.toBuy).toBe(20);
    expect(r.cities).toEqual([{ city: 'Martlock', qty: 20, price: 100 }]);
    expect(r.unit).toBe(100);
    expect(r.sum).toBe(2000);
    const [r2] = acquisitionRows(d, (x) => x, makePool({ T4_CLOTH: 5 }));
    expect(r2.cities).toEqual([{ city: 'Martlock', qty: 25, price: 100 }, { city: 'Thetford', qty: 10, price: 130 }]);
    expect(r2.sum).toBe(2500 + 1300);
  });

  it('trimCities: ноль и избыток', () => {
    const c = [{ city: 'A', qty: 5, price: 10 }];
    expect(trimCities(c, 0)).toEqual([]);
    expect(trimCities(c, 9)).toEqual(c);
  });

  it('своя цена (withOverride) считается на докупаемое', () => {
    const [r] = acquisitionRows(base([buy('T4_CLOTH', 40)]), (x) => x, makePool({ T4_CLOTH: 15 }));
    expect(withOverride(r, { price: 80, city: 'Thetford' })).toMatchObject({ sum: 2000, cities: [{ city: 'Thetford', qty: 25, price: 80 }] });
    const [all] = acquisitionRows(base([buy('T4_CLOTH', 40)]), (x) => x, makePool({ T4_CLOTH: 40 }));
    expect(withOverride(all, { price: 80, city: 'Thetford' })).toMatchObject({ sum: 0, cities: [] });
  });

  it('сводка нескольких позиций складывает needed, have и toBuy', () => {
    const pool = makePool({ T4_CLOTH: 50 });
    const a = acquisitionRows(base([buy('T4_CLOTH', 40)]), (x) => x, pool);
    const b = acquisitionRows(base([buy('T4_CLOTH', 30)]), (x) => x, pool);
    const [m] = mergeRows([a, b]);
    expect(m).toMatchObject({ needed: 70, have: 50, toBuy: 20 });
    expect(m.cities).toEqual([{ city: 'Martlock', qty: 20, price: 100 }]);
  });
});

describe('крафт самому и переработка', () => {
  const craftRow = (o = {}) => ({ resource: 'T4_PLATE', queryId: 'T4_PLATE', count: 8, neededToBuy: 10, materialSource: 'craft', cheapestPrice: 900, buyPrice: 2000,
    craftOption: { price: 900, components: [{ id: 'T4_BAR', count: 2, factor: 1, price: 100, city: 'Martlock' }, { id: 'T4_LEATHER', count: 1, factor: 1, price: 50, city: 'Martlock' }] }, ...o });

  it('без пула: докупаются компоненты', () => {
    const { rows, lines } = acquisition(base([craftRow()]));
    expect(rows.map((r) => [r.id, r.needed, r.toBuy])).toEqual([['T4_BAR', 20, 20], ['T4_LEATHER', 10, 10]]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ id: 'T4_PLATE', needed: 10, covered: 0, via: 'craft' });
  });

  it('готовый полуфабрикат берётся первым, компоненты считаются на остаток; строка полуфабриката ничего не докупает', () => {
    const { rows, lines } = acquisition(base([craftRow()]), (x) => x, makePool({ T4_PLATE: 4 }));
    expect(rows.find((r) => r.id === 'T4_PLATE')).toMatchObject({ needed: 10, have: 4, toBuy: 0, sum: 0 });
    expect(rows.find((r) => r.id === 'T4_BAR')).toMatchObject({ needed: 12, toBuy: 12 });
    expect(rows.find((r) => r.id === 'T4_LEATHER')).toMatchObject({ needed: 6 });
    expect(lines[0].covered).toBe(4);
  });

  it('компоненты закрывают часть остатка: доля покрытия — по самому нехватающему', () => {
    const { rows, lines } = acquisition(base([craftRow()]), (x) => x, makePool({ T4_BAR: 20, T4_LEATHER: 5 }));
    expect(rows.find((r) => r.id === 'T4_LEATHER')).toMatchObject({ needed: 10, have: 5, toBuy: 5 });
    expect(lines[0].covered).toBeCloseTo(5, 9);                  // кожи хватает на половину плащей
  });

  it('переработка: сырьё и предыдущий тир — из пула', () => {
    const d = base([{ resource: 'T4_CLOTH', queryId: 'T4_CLOTH', count: 8, neededToBuy: 10, materialSource: 'refine', cheapestPrice: 100,
      refineOption: { rate: 0.5, city: 'Martlock', components: [{ id: 'T4_FIBER', count: 2, price: 30, city: 'Martlock' }, { id: 'T3_CLOTH', count: 1, price: 40, city: 'Martlock' }] } }]);
    const { rows, lines } = acquisition(d, (x) => x, makePool({ T4_FIBER: 10 }));
    expect(rows.find((r) => r.id === 'T4_FIBER')).toMatchObject({ needed: 10, have: 10, toBuy: 0 });
    expect(rows.find((r) => r.id === 'T3_CLOTH')).toMatchObject({ needed: 5, have: 0, toBuy: 5 });
    expect(lines[0]).toMatchObject({ via: 'refine', covered: 0 });
  });
});

describe('сколько можно скрафтить', () => {
  const line = (needed, covered) => ({ id: 'X', needed, covered, via: null, comps: [] });
  it('по самому нехватающему материалу, вниз до целого, не больше заказанного', () => {
    expect(coverage([line(10, 10), line(20, 10)])).toBe(0.5);
    expect(craftableNow([line(10, 10), line(20, 10)], 10)).toBe(5);
    expect(craftableNow([line(10, 3), line(20, 20)], 10)).toBe(3);
    expect(craftableNow([line(10, 9)], 10)).toBe(9);
    expect(craftableNow([line(10, 99)], 10)).toBe(10);
    expect(craftableNow([line(10, 0)], 10)).toBe(0);
    expect(craftableNow([], 7)).toBe(7);
  });
  it('дробное покрытие не округляется вверх из-за ошибок вычислений', () => {
    expect(craftableNow([line(30, 10)], 3)).toBe(1);
    expect(craftableNow([line(3, 1)], 3)).toBe(1);
  });

  it('allocateItem: рецепт из двух материалов, часть есть', () => {
    const d = base([buy('T4_CLOTH', 40), buy('T4_LEATHER', 20)], { quantity: 10 });
    const a = allocateItem(d, (x) => x, makePool({ T4_CLOTH: 40, T4_LEATHER: 8 }));
    expect(a.craftable).toBe(4);
    expect(a.ready).toBe(false);
    expect(a.toBuyRows.map((r) => [r.id, r.toBuy])).toEqual([['T4_LEATHER', 12]]);
    const full = allocateItem(d, (x) => x, makePool({ T4_CLOTH: 40, T4_LEATHER: 20 }));
    expect(full).toMatchObject({ craftable: 10, ready: true, toBuyRows: [] });
  });
});

describe('стек: общий пул раздаётся позициям по порядку', () => {
  const d1 = base([buy('T4_CLOTH', 40)], { quantity: 5 });
  const d2 = base([buy('T4_CLOTH', 30)], { quantity: 3 });
  const items = [{ uid: 'a' }, { uid: 'b' }, { uid: 'c', on: false }];
  const results = new Map([['a', d1], ['b', d2], ['c', d1]]);

  it('первая позиция берёт свою долю, вторая — остаток; выключенные и с ошибкой пропускаются', () => {
    const { byUid, leftover } = allocateStack(items, results, { T4_CLOTH: 50, T4_RUNE: 7 }, (x) => x);
    expect([...byUid.keys()]).toEqual(['a', 'b']);
    expect(byUid.get('a')).toMatchObject({ craftable: 5, ready: true });
    expect(byUid.get('b').rows[0]).toMatchObject({ have: 10, toBuy: 20 });
    expect(byUid.get('b').craftable).toBe(1);                    // 10 из 30 → треть от 3 штук
    expect(leftover).toEqual({ T4_CLOTH: 0, T4_RUNE: 7 });
    const err = allocateStack([{ uid: 'a' }], new Map([['a', { error: 'x' }]]), { T4_CLOTH: 5 }, (x) => x);
    expect(err.byUid.size).toBe(0);
  });

  it('без инвентаря все позиции «ничего нет», докупить — всё', () => {
    const { byUid } = allocateStack(items, results, {}, (x) => x);
    expect(byUid.get('a')).toMatchObject({ craftable: 0 });
    expect(byUid.get('a').rows[0].toBuy).toBe(40);
  });

  it('таблица материалов: нужно, закрыто, лишнее; добавленный вручную материал, которого нет в расчёте, тоже виден', () => {
    const have = { T4_CLOTH: 50, T4_RUNE: 7 };
    const { byUid } = allocateStack(items, results, have, (x) => x);
    const t = materialTable([...byUid.values()], have, (x) => x);
    expect(t.find((e) => e.id === 'T4_CLOTH')).toMatchObject({ needed: 70, used: 50, toBuy: 20, have: 50, extra: 0 });
    expect(t.find((e) => e.id === 'T4_RUNE')).toMatchObject({ needed: 0, used: 0, have: 7, extra: 7 });
  });
});
