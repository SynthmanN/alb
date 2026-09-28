// Мои материалы v2: путь материала (купить / переработать / скрафтить) и рецепт вещи выбираются с учётом того, что у тебя есть
import { describe, it, expect } from 'vitest';
import { acquisition, chooseSource, buyQuote, MIN_ALT_GAIN } from '../public/js/next/logic/acquire.js';
import { makePool, ownedGain, allocateItem, stackPicks, recipeVariants, compareVariants, recipeLabel } from '../public/js/next/logic/inventory.js';
import { pickAfter } from '../public/js/next/logic/stack.js';
import { pickVariant } from '../public/js/next/logic/enchantChain.js';
import { buildCatalog, filterCatalog, materialName, enchantedId } from '../public/js/next/logic/materialCatalog.js';

const base = (recipe, extra = {}) => ({ quantity: 10, itemId: 'T4_ARMOR_CLOTH_SET1', enchant: 0, acquire: { byResource: [] }, recipe, ...extra });
const buy = (id, need, price = 100, city = 'Martlock') => ({ resource: id, queryId: id, count: 8, neededToBuy: need, materialSource: 'buy', cheapestPrice: price, cheapestCity: city, buyPrice: price });
// ткань: покупка по 60, переработка = сырьё (45) + ткань тира ниже (40) — по рынку переработка дороже, сервер выбирает покупку
const cloth = (o = {}) => ({
  resource: 'T4_CLOTH', queryId: 'T4_CLOTH', count: 8, neededToBuy: 10, materialSource: 'buy', cheapestPrice: 60, cheapestCity: 'Thetford', buyPrice: 60,
  cityPrices: [{ city: 'Thetford', price: 60 }], refineOption: { rate: 0.5, city: 'Martlock', price: 65, components: [{ id: 'T4_FIBER', count: 2, price: 45, city: 'Martlock' }, { id: 'T3_CLOTH', count: 1, price: 40, city: 'Martlock' }] }, ...o,
});

describe('путь материала с учётом своих материалов', () => {
  it('без пула и без подходящих материалов остаётся выбор сервера', () => {
    expect(chooseSource(cloth(), null)).toBe('buy');
    expect(chooseSource(cloth(), makePool({}))).toBe('buy');
    expect(chooseSource(cloth(), makePool({ T4_RUNE: 99 }))).toBe('buy');
  });

  it('есть сырьё — переработка дешевле покупки, хотя по рынку сервер выбрал покупку', () => {
    expect(chooseSource(cloth(), makePool({ T4_FIBER: 10 }))).toBe('refine');
  });

  it('выгода меньше порога 5% не переключает путь', () => {
    // одна штука сырья: 9×45 + 5×40 = 605 против 600 покупки
    expect(chooseSource(cloth(), makePool({ T4_FIBER: 1 }))).toBe('buy');
    expect(MIN_ALT_GAIN).toBe(0.05);
  });

  it('свой готовый полуфабрикат закрывает потребность — путь не меняется, всё бесплатно', () => {
    expect(chooseSource(cloth(), makePool({ T4_CLOTH: 10 }))).toBe('buy');
    expect(chooseSource(cloth({ materialSource: 'refine', cheapestPrice: 50 }), makePool({ T4_CLOTH: 10 }))).toBe('refine');
  });

  it('acquisition: строки переработки и пометка «по твоим материалам»', () => {
    const { rows, lines } = acquisition(base([cloth()]), (x) => x, makePool({ T4_FIBER: 10 }));
    expect(lines[0]).toMatchObject({ via: 'refine', source: 'refine', switched: true });
    expect(rows.find((r) => r.id === 'T4_FIBER')).toMatchObject({ needed: 10, have: 10, toBuy: 0 });
    expect(rows.find((r) => r.id === 'T3_CLOTH')).toMatchObject({ needed: 5, toBuy: 5, sum: 200 });
    const plain = acquisition(base([cloth()]), (x) => x, makePool({}));
    expect(plain.lines[0]).toMatchObject({ source: 'buy', switched: false });
    expect(plain.rows[0]).toMatchObject({ id: 'T4_CLOTH', toBuy: 10, sum: 600 });
  });

  it('сервер выбрал переработку, а покупная цена есть: buyQuote отдаёт цену и самый дешёвый город', () => {
    const r = cloth({ materialSource: 'refine', cheapestPrice: 50, buyPrice: 60, cheapestCity: 'Martlock', cityPrices: [{ city: 'Lymhurst', price: 70 }, { city: 'Thetford', price: 60 }] });
    expect(buyQuote(r)).toEqual({ price: 60, city: 'Thetford' });
    expect(buyQuote(cloth())).toEqual({ price: 60, city: 'Thetford' });
    expect(buyQuote(cloth({ materialSource: 'refine', buyPrice: null })).price).toBeNull();
  });

  it('крафт самому: свои компоненты делают его дешевле покупки', () => {
    const plate = { resource: 'T4_PLATE', queryId: 'T4_PLATE', count: 8, neededToBuy: 10, materialSource: 'buy', cheapestPrice: 500, cheapestCity: 'Martlock', buyPrice: 500,
      craftOption: { price: 600, components: [{ id: 'T4_BAR', count: 2, factor: 1, price: 200, city: 'Martlock' }, { id: 'T4_LEATHER', count: 1, factor: 1, price: 200, city: 'Martlock' }] } };
    expect(chooseSource(plate, makePool({}))).toBe('buy');
    expect(chooseSource(plate, makePool({ T4_BAR: 20 }))).toBe('craft');
    const { lines } = acquisition(base([plate]), (x) => x, makePool({ T4_BAR: 20, T4_LEATHER: 10 }));
    expect(lines[0]).toMatchObject({ via: 'craft', switched: true, covered: 10 });
  });

  it('цена компонента неизвестна — путь через него не выбирается', () => {
    const r = cloth({ refineOption: { rate: 0.5, price: 65, components: [{ id: 'T4_FIBER', count: 2, price: 45, city: 'M' }, { id: 'T3_CLOTH', count: 1, price: null, city: 'M' }] } });
    expect(chooseSource(r, makePool({ T4_FIBER: 10 }))).toBe('buy');
  });
});

describe('серебро, которое экономят свои материалы', () => {
  it('ownedGain: рынок минус закупка того, чего не хватает; пул не меняется', () => {
    const pool = makePool({ T4_FIBER: 10 });
    const d = base([cloth()]);
    expect(ownedGain(d, (x) => x, pool)).toBe(400);                       // 600 на рынке → 200 докупить ткань предыдущего тира
    expect(pool.left()).toEqual({ T4_FIBER: 10 });
    expect(ownedGain(d, (x) => x, makePool({}))).toBe(0);
    expect(ownedGain({ error: 'x' }, (x) => x, pool)).toBe(0);
  });

  it('allocateItem: saved, рецепт и переключённые строки', () => {
    const a = allocateItem(base([cloth()]), (x) => x, makePool({ T4_FIBER: 10 }));
    expect(a.saved).toBe(400);
    expect(a.switched).toHaveLength(1);
    expect(a.recipe).toBe('Крафт');
    const none = allocateItem(base([cloth()]), (x) => x, makePool({}));
    expect(none.saved).toBe(0);
    expect(none.switched).toHaveLength(0);
  });
});

describe('выбор рецепта вещи', () => {
  const mk = (cost, recipe, extra = {}) => ({ quantity: 10, effectiveCostPerUnit: cost, taxRate: 0.08, setupFeeRate: 0, recipe, ...extra });
  const item = { uid: 'a', salePrice: 1000, quantity: 10 };
  const direct = () => mk(400, [buy('T4_CLOTH', 40, 100)]);
  const after = () => mk(440, [buy('T4_FIBER', 40, 110)], { enchantAfterCraft: { targetLevel: 2, baseLevel: 0, chainEntryLevel: 0 } });

  it('без бонуса решает профит, как раньше (7%: рецепт «после» дороже — остаётся прямой)', () => {
    expect(pickAfter(item, { direct: direct(), after: after() }).use).toBe(false);
  });

  it('свои материалы для другого рецепта той же вещи переключают выбор', () => {
    const pool = makePool({ T4_FIBER: 40 });
    const pick = pickAfter(item, { direct: direct(), after: after() }, (d) => ownedGain(d, (x) => x, pool) / d.quantity);
    expect(pick.use).toBe(true);
    expect(pick.data.enchantAfterCraft).toBeTruthy();
  });

  it('pickVariant: минимальные вложения на штуку с учётом экономии; без экономии — как раньше', () => {
    const d0 = { ...after(), effectiveCostPerUnit: 300, hasAllMaterialPrices: true };
    const d1 = { ...after(), effectiveCostPerUnit: 350, hasAllMaterialPrices: true };
    expect(pickVariant(d0, { 1: d1 }, null).level).toBe(0);
    expect(pickVariant(d0, { 1: d1 }, null, (d) => (d === d1 ? 100 : 0)).level).toBe(1);
    expect(pickVariant(d0, { 1: d1 }, { baseLevel: 0, forceMain: false }, (d) => (d === d1 ? 100 : 0)).level).toBe(0);      // ручной выбор сильнее
  });

  it('stackPicks: материалы достаются позициям по порядку — второй позиции рецепт уже не переключается', () => {
    const items = [{ uid: 'a', salePrice: 1000, quantity: 10 }, { uid: 'b', salePrice: 1000, quantity: 10 }];
    const pairs = new Map(items.map((i) => [i.uid, { direct: direct(), after: after() }]));
    const results = new Map(items.map((i) => [i.uid, direct()]));
    const picks = stackPicks(items, pairs, results, { T4_FIBER: 40 }, (x) => x);
    expect(picks.get('a').use).toBe(true);
    expect(picks.get('b').use).toBe(false);
    const empty = stackPicks(items, pairs, results, {}, (x) => x);
    expect([empty.get('a').use, empty.get('b').use]).toEqual([false, false]);
  });

  it('stackPicks пропускает выключенные позиции и позиции без вариантов', () => {
    const items = [{ uid: 'a', on: false, salePrice: 1000, quantity: 10 }, { uid: 'b', salePrice: 1000, quantity: 10 }];
    const picks = stackPicks(items, new Map(), new Map([['b', direct()]]), { T4_CLOTH: 5 }, (x) => x);
    expect(picks.size).toBe(0);
  });

  it('recipeVariants / compareVariants: прямой и «после крафта» на твоих материалах', () => {
    const dd = { ...direct(), hasAllMaterialPrices: true };
    const ad = { ...after(), hasAllMaterialPrices: true };
    const v = recipeVariants({ after: false, data: dd, hybrids: {}, alt: { data: ad, hybrids: { 1: { ...ad, enchantAfterCraft: { targetLevel: 2, baseLevel: 1, chainEntryLevel: 0 } } } } });
    expect(v.map((x) => x.key)).toEqual(['direct', 'after0', 'after1']);
    const v2 = recipeVariants({ after: true, data: ad, hybrids: { 1: { error: 'x' } }, alt: { data: dd } });
    expect(v2.map((x) => x.key)).toEqual(['direct', 'after0']);
    const cmp = compareVariants(v2, { T4_FIBER: 40 }, (x) => x);
    expect(cmp.best).toBe('after0');
    expect(cmp.rows.find((r) => r.key === 'after0')).toMatchObject({ cash: 0, ownCost: 0 });
    expect(cmp.rows.find((r) => r.key === 'direct')).toMatchObject({ cash: 4000, ownCost: 400 });
    expect(compareVariants(v2, {}, (x) => x).best).toBe('direct');
  });

  it('recipeLabel: прямой, .0 + зачарование, смешанный', () => {
    expect(recipeLabel({ enchant: 2 })).toBe('Прямой крафт зачарованного');
    expect(recipeLabel({ enchantAfterCraft: { targetLevel: 2, baseLevel: 0 } })).toBe('Крафт .0 + зачарование до .2');
    expect(recipeLabel({ enchantAfterCraft: { targetLevel: 3, baseLevel: 1 } })).toBe('Зачарованная база .1 + докрутка до .3');
  });
});

describe('каталог материалов для пикера', () => {
  const items = [
    { id: 'T4_FIBER', name: 'T4 Пенька', category: 'raw', tier: 4 },
    { id: 'T4_CLOTH', name: 'T4 Изысканная ткань', category: 'refined', tier: 4 },
    { id: 'T3_CLOTH', name: 'T3 Крепкая ткань', category: 'refined', tier: 3 },
    { id: 'T4_ROCK', name: 'T4 Известняк', category: 'raw', tier: 4 },
    { id: 'T4_CAPE', name: 'T4 Плащ (знаток)', category: 'cape', tier: 4 },
    { id: 'T4_CAPEITEM_FW_MARTLOCK', name: 'T4 Плащ Мартлока', category: 'cape', tier: 4 },
    { id: 'T4_2H_SWORD', name: 'T4 Меч', category: 'weapon', tier: 4 },
  ];
  const cat = buildCatalog(items);
  const ids = (list) => list.map((c) => c.id);

  it('id зачарованных материалов как в рецептах сервера', () => {
    expect(enchantedId('T4_CLOTH', 0)).toBe('T4_CLOTH');
    expect(enchantedId('T4_CLOTH', 2)).toBe('T4_CLOTH_LEVEL2@2');
    expect(enchantedId('T4_CAPE', 1)).toBe('T4_CAPE@1');
  });

  it('сырьё и полуфабрикаты T4+ до .4, T3 и камень — только .0, обычные плащи до .3; гир и фракционные плащи не попадают', () => {
    expect(ids(cat.filter((c) => c.kind === 'refined' && c.tier === 4))).toEqual(['T4_CLOTH', 'T4_CLOTH_LEVEL1@1', 'T4_CLOTH_LEVEL2@2', 'T4_CLOTH_LEVEL3@3', 'T4_CLOTH_LEVEL4@4']);
    expect(ids(cat.filter((c) => c.id.startsWith('T3_')))).toEqual(['T3_CLOTH']);
    expect(ids(cat.filter((c) => c.id.includes('ROCK')))).toEqual(['T4_ROCK']);
    expect(ids(cat.filter((c) => c.kind === 'cape'))).toEqual(['T4_CAPE', 'T4_CAPE@1', 'T4_CAPE@2', 'T4_CAPE@3']);
    expect(cat.some((c) => c.id.includes('SWORD') || c.id.includes('FW_'))).toBe(false);
  });

  it('руны, души и реликвии на тирах 4–8 с названием по тиру', () => {
    const runes = cat.filter((c) => c.kind === 'enchant');
    expect(runes).toHaveLength(15);
    expect(runes.find((c) => c.id === 'T4_RUNE').name).toBe('Руна (знаток)');
    expect(runes.find((c) => c.id === 'T8_RELIC').name).toBe('Реликвия (старейшина)');
  });

  it('поиск: по названию, id, виду, тиру и зачарованию', () => {
    expect(ids(filterCatalog(cat, { q: 'ткань' }))).toContain('T3_CLOTH');
    expect(ids(filterCatalog(cat, { q: 'ткань', tier: '4', enchant: '2' }))).toEqual(['T4_CLOTH_LEVEL2@2']);
    expect(ids(filterCatalog(cat, { q: 'cloth_level3' }))).toEqual(['T4_CLOTH_LEVEL3@3']);
    expect(filterCatalog(cat, { kind: 'enchant', tier: '5' }).map((c) => c.name).sort()).toEqual(['Душа (эксперт)', 'Реликвия (эксперт)', 'Руна (эксперт)']);
    expect(filterCatalog(cat, { q: 'zzz' })).toEqual([]);
    expect(filterCatalog(cat, { enchant: '0', kind: 'raw' }).every((c) => c.enchant === 0 && c.kind === 'raw')).toBe(true);
  });

  it('materialName: справочник, зачарованный id от основы, руны, запасное имя', () => {
    expect(materialName('T4_CLOTH', items)).toBe('T4 Изысканная ткань');
    expect(materialName('T4_CLOTH_LEVEL2@2', items)).toBe('T4 Изысканная ткань');
    expect(materialName('T4_CAPE@2', items)).toBe('T4 Плащ (знаток)');
    expect(materialName('T6_SOUL', items)).toBe('Душа (мастер)');
    expect(materialName('T4_RUNE@1', items)).toBe('Руна (знаток)');
    expect(materialName('X_UNKNOWN', items)).toBe('X_UNKNOWN');
    expect(materialName('X_UNKNOWN', items, () => 'запас')).toBe('запас');
  });
});
