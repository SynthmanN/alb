// Выбор города кликом в «Все города», порядок закупки по городам, двухшаговый выбор профиля и слияние профилей с сервером (чистая логика).
import { describe, it, expect } from 'vitest';
import { bestBuy } from '../public/js/next/logic/cityPrices.js';
import { makeOverride } from '../public/js/next/logic/adjust.js';
import { withOverride, sortByCity, primaryCity } from '../public/js/next/logic/acquire.js';
import { canPickProfile, mergeProfiles } from '../public/js/next/logic/profiles.js';

const list = [{ city: 'Martlock', price: 100 }, { city: 'Lymhurst', price: 110 }, { city: 'Thetford', price: 130 }];
const cities = ['Martlock', 'Lymhurst', 'Thetford'];
const prices = (o = {}) => ({ own: {}, cityOwn: {}, cityPick: {}, lots: {}, ...o });

describe('клик по городу: закупка именно в него', () => {
  it('выбранный город берётся даже когда он не самый дешёвый; цена — рыночная с комиссией 2.5%, без своих цен', () => {
    expect(bestBuy(list, undefined, cities, 0.025, 'Thetford')).toEqual({ price: 130 * 1.025, city: 'Thetford', fromOwn: false, picked: true });
    expect(bestBuy(list, undefined, cities, 0.025, null)).toBeUndefined();          // не выбран и своих цен нет — считает рынок
  });
  it('выбранный город без цены игнорируется — закупка по обычному правилу', () => {
    expect(bestBuy(list, { Lymhurst: 90 }, cities, 0.025, 'Bridgewatch')).toMatchObject({ city: 'Lymhurst', fromOwn: true });
  });
  it('своя цена выбранного города — как есть; makeOverride: выбор делает расчёт «своим» и помечает picked (не «своя цена»)', () => {
    expect(bestBuy(list, { Thetford: 120 }, cities, 0.025, 'Thetford')).toMatchObject({ price: 120, city: 'Thetford', fromOwn: true, picked: true });
    const m = makeOverride({ X: list }, prices({ cityPick: { X: 'Lymhurst' } }), { cities });
    expect(m.hasOwn).toBe(true);
    expect(m.override('X')).toEqual({ price: 110 * 1.025, city: 'Lymhurst', picked: true });
    expect(makeOverride({ X: list }, prices(), { cities }).override('X')).toBeUndefined();     // повторный клик снял выбор — обычная закупка
    expect(makeOverride({ X: list }, prices({ cityOwn: { X: { Thetford: 120 } }, cityPick: { X: 'Thetford' } }), { cities }).override('X')).toEqual({ price: 120, city: 'Thetford' });
  });
  it('строка закупки: вся партия в выбранном городе; пометка «своя цена» только у настоящих своих цен', () => {
    const row = { id: 'X', needed: 10, cities: [{ city: 'Martlock', qty: 10, price: 102.5 }], unit: 102.5, sum: 1025 };
    expect(withOverride(row, { price: 112.75, city: 'Lymhurst', picked: true })).toMatchObject({ cities: [{ city: 'Lymhurst', qty: 10, price: 112.75 }], sum: 1127.5, manual: false, picked: true });
    expect(withOverride(row, { price: 90, city: 'Lymhurst' })).toMatchObject({ manual: true, picked: false });
  });
});

describe('порядок закупки по городам', () => {
  const row = (id, sum, ...cs) => ({ id, sum, cities: cs.map(([city, qty, price]) => ({ city, qty, price })) });
  it('покупки одного города идут подряд (города по алфавиту), внутри города дороже выше, без города — в конце', () => {
    const rows = [
      row('a', 100, ['Martlock', 1, 100]), row('b', 900, ['Lymhurst', 9, 100]), row('c', 500, ['Martlock', 5, 100]),
      row('d', 300, ['Lymhurst', 3, 100]), row('e', null), row('f', 700, ['Bridgewatch', 7, 100]),
    ];
    expect(sortByCity(rows).map((r) => r.id)).toEqual(['f', 'b', 'd', 'c', 'a', 'e']);
    expect(rows[0].id).toBe('a');                                                            // вход не меняется
  });
  it('строка из нескольких городов стоит один раз — в городе, где больше штук', () => {
    const r = row('m', 500, ['Thetford', 2, 100], ['Caerleon', 8, 100]);
    expect(primaryCity(r)).toBe('Caerleon');
    expect(sortByCity([row('x', 1, ['Thetford', 1, 1]), r]).map((x) => x.id)).toEqual(['m', 'x']);
  });
  it('работает и с обёрткой { base, row } (сводная закупка стека)', () => {
    const wrapped = [{ row: row('a', 1, ['Thetford', 1, 1]) }, { row: row('b', 1, ['Martlock', 1, 1]) }];
    expect(sortByCity(wrapped, (x) => x.row).map((x) => x.row.id)).toEqual(['b', 'a']);
  });
});

describe('выбор профиля в два шага', () => {
  it('загрузить можно только из состояния «— выберите профиль —»; вернуться на «выберите» можно всегда', () => {
    expect(canPickProfile(null, 'p1')).toBe(true);
    expect(canPickProfile('p1', 'p2')).toBe(false);
    expect(canPickProfile('p1', '')).toBe(true);
  });
});

describe('слияние профилей с сервером', () => {
  const p = (id, savedAt) => ({ id, savedAt, name: id, items: [] });
  it('первый раз локальные профили, которых нет на сервере, дозаливаются; список от новых к старым', () => {
    const r = mergeProfiles([p('s1', 100)], [p('s1', 100), p('l1', 300)], false);
    expect(r.toPush.map((x) => x.id)).toEqual(['l1']);
    expect(r.profiles.map((x) => x.id)).toEqual(['l1', 's1']);
  });
  it('после переезда сервер — источник правды: удалённое на сервере из локальной копии не воскресает', () => {
    const r = mergeProfiles([p('s1', 100)], [p('s1', 100), p('gone', 300)], true);
    expect(r).toEqual({ profiles: [p('s1', 100)], toPush: [] });
  });
});
