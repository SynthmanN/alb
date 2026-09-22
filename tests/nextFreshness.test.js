// Сбор id материалов и самого предмета для окна «Свежесть данных» — logic/freshness.js
import { describe, it, expect } from 'vitest';
import { collectIds, collectAllIds } from '../public/js/next/logic/freshness.js';

describe('collectIds', () => {
  it('обычный предмет: сам предмет + материалы рецепта, детали за очки пропускаются', () => {
    const d = {
      itemId: 'T4_MAIN_SWORD', finishedQueryId: 'T4_MAIN_SWORD',
      recipe: [
        { resource: 'T4_METALBAR', queryId: 'T4_METALBAR', materialSource: 'buy' },
        { resource: 'T4_LEATHER', queryId: 'T4_LEATHER', materialSource: 'buy' },
        { resource: 'X_POINTS_PART', queryId: 'X_POINTS_PART', materialSource: 'points' },
      ],
    };
    const ids = [...collectIds(d).keys()];
    expect(ids).toEqual(['T4_MAIN_SWORD', 'T4_METALBAR', 'T4_LEATHER']);
  });

  it('зачарованный предмет: queryId рецепта — с @N, отдельно от .0', () => {
    const d = { itemId: 'T6_CAPE', finishedQueryId: 'T6_CAPE@3', recipe: [{ resource: 'T6_CLOTH', queryId: 'T6_CLOTH_LEVEL3@3', materialSource: 'buy' }] };
    expect([...collectIds(d).keys()]).toEqual(['T6_CAPE@3', 'T6_CLOTH_LEVEL3@3']);
  });

  it('компоненты переработки и крафта самому — тоже попадают (сырьё, предыдущий тир, ткань, кожа)', () => {
    const d = {
      itemId: 'T6_CAPE', finishedQueryId: 'T6_CAPE',
      recipe: [
        { resource: 'T6_PLANKS', queryId: 'T6_PLANKS', materialSource: 'refine', refineOption: { components: [{ id: 'T6_WOOD' }, { id: 'T5_PLANKS' }] } },
        { resource: 'T6_CAPE_INGREDIENT', queryId: 'T6_CAPE_INGREDIENT', materialSource: 'craft', craftOption: { components: [{ id: 'T6_CLOTH' }, { id: 'T6_LEATHER' }] } },
      ],
    };
    expect([...collectIds(d).keys()]).toEqual(['T6_CAPE', 'T6_PLANKS', 'T6_WOOD', 'T5_PLANKS', 'T6_CAPE_INGREDIENT', 'T6_CLOTH', 'T6_LEATHER']);
  });

  it('чары после крафта: база .0 (если покупают) и руны/души — тоже материалы', () => {
    const d = {
      itemId: 'T6_2H_BOW', finishedQueryId: 'T6_2H_BOW@2', recipe: [],
      enchantAfterCraft: { baseBuy: { city: 'Martlock', price: 1000 }, steps: [{ materialId: 'T6_RUNE', materialName: 'Руна' }, { materialId: 'T6_SOUL', materialName: 'Душа' }] },
    };
    expect([...collectIds(d).keys()]).toEqual(['T6_2H_BOW@2', 'T6_2H_BOW', 'T6_RUNE', 'T6_SOUL']);
  });

  it('базу .0 крафтят сами (не покупают) — её саму в список не добавляем, ткань/кожу — да', () => {
    const d = {
      itemId: 'T6_2H_BOW', finishedQueryId: 'T6_2H_BOW@2', recipe: [{ resource: 'T6_2H_BOW', queryId: 'T6_2H_BOW', materialSource: 'craft', craftOption: { components: [{ id: 'T6_METALBAR' }] } }],
      enchantAfterCraft: { baseBuy: null, steps: [{ materialId: 'T6_RUNE' }] },
    };
    const ids = [...collectIds(d).keys()];
    expect(ids).toContain('T6_METALBAR');
    expect(ids).toContain('T6_RUNE');
  });

  it('ошибка расчёта или пустой ответ — пустой список, не падает', () => {
    expect([...collectIds(null).keys()]).toEqual([]);
    expect([...collectIds({ error: 'oops' }).keys()]).toEqual([]);
  });

  it('название берётся из d.names, иначе — из resourceName, иначе id остаётся как название', () => {
    const d = { itemId: 'T4_RUNE', finishedQueryId: 'T4_RUNE', names: { T4_RUNE: 'Руна (знаток)' }, recipe: [{ resource: 'T4_CLOTH', queryId: 'T4_CLOTH', materialSource: 'buy', resourceName: 'Ткань' }, { resource: 'T4_X', queryId: 'T4_X', materialSource: 'buy' }] };
    const m = collectIds(d);
    expect(m.get('T4_RUNE')).toBe('Руна (знаток)');
    expect(m.get('T4_CLOTH')).toBe('Ткань');
    expect(m.get('T4_X')).toBe('T4_X');
  });
});

describe('collectAllIds', () => {
  it('объединяет несколько позиций в один список без повторов', () => {
    const results = new Map([
      ['a', { itemId: 'T4_A', finishedQueryId: 'T4_A', recipe: [{ resource: 'T4_CLOTH', queryId: 'T4_CLOTH', materialSource: 'buy' }] }],
      ['b', { itemId: 'T4_B', finishedQueryId: 'T4_B', recipe: [{ resource: 'T4_CLOTH', queryId: 'T4_CLOTH', materialSource: 'buy' }] }],
      ['c', { error: 'нет цен' }],
    ]);
    const ids = [...collectAllIds(results).keys()];
    expect(ids.sort()).toEqual(['T4_A', 'T4_B', 'T4_CLOTH']);
  });
});
