// Сбор id материалов и самого предмета для окна «Свежесть данных» — logic/freshness.js
import { describe, it, expect } from 'vitest';
import { collectIds, collectAllIds, collectFactionIds, collectVariantIds } from '../public/js/next/logic/freshness.js';

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

  it('чары после крафта: база .0 (если её покупают) резолвится через selfLabel(d), не остаётся голым id — тот же d.itemId, что и у самого предмета, каталог названий гира только у клиента, а d.names несёт только материалы', () => {
    const d = {
      itemId: 'T5_HEAD_LEATHER_SET3', finishedQueryId: 'T5_HEAD_LEATHER_SET3@3', names: { T5_LEATHER: 'T5 Выделанная кожа' }, recipe: [],
      enchantAfterCraft: { baseBuy: { city: 'Fort Sterling', price: 14977 }, steps: [{ materialId: 'T5_RUNE', materialName: 'Руна (эксперт)' }] },
    };
    const m = collectIds(d, undefined, (dd) => `Капюшон убийцы (эксперт) [${dd.itemId}]`);
    expect(m.get('T5_HEAD_LEATHER_SET3').name).toBe('Капюшон убийцы (эксперт) [T5_HEAD_LEATHER_SET3]');   // не 'T5_HEAD_LEATHER_SET3' голым id
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

  it('collectAllIds/collectVariantIds: материалы ВСЕХ вариантов рецепта (direct, after, гибриды) и готовые уровни readyItems', () => {
    const mk = (mat, extra = {}) => ({ itemId: 'T6_2H_BOW', finishedQueryId: 'T6_2H_BOW@2', recipe: [{ resource: mat, queryId: mat, materialSource: 'buy', cheapestPrice: null }], ...extra });
    const pair = { direct: mk('T6_WOOD@2'), after: mk('T6_WOOD', { enchantAfterCraft: { steps: [], readyItems: [{ id: 'T6_2H_BOW@1', label: 'Лук .1' }] } }), hybrids: { 1: mk('T6_WOOD@1') } };
    const ids = [...collectAllIds(new Map(), undefined, new Map([['u', pair]])).keys()];
    expect(ids).toEqual(expect.arrayContaining(['T6_WOOD@2', 'T6_WOOD', 'T6_WOOD@1', 'T6_2H_BOW@1']));
    expect([...collectVariantIds(pair.after, { 1: pair.hybrids[1] }).keys()]).toEqual(expect.arrayContaining(['T6_WOOD', 'T6_WOOD@1']));
  });

  it('вход в цепочку не с нуля (chainEntryLevel > 0) — купленный готовый промежуточный уровень тоже в список, с именем через chainEntryLabel', () => {
    const d = {
      itemId: 'T6_2H_BOW', finishedQueryId: 'T6_2H_BOW@2', recipe: [],
      enchantAfterCraft: {
        baseBuy: null, chainEntryLevel: 1, chainEntryId: 'T6_2H_BOW@1', chainEntryLabel: 'Лук (знаток) .1',
        steps: [{ materialId: 'T6_RUNE', materialName: 'Руна' }, { materialId: 'T6_SOUL', materialName: 'Душа' }],
      },
    };
    const m = collectIds(d);
    expect(m.get('T6_2H_BOW@1')).toEqual({ name: 'Лук (знаток) .1', quality: 1, kind: 'material' });
  });

  it('ошибка расчёта или пустой ответ — пустой список, не падает', () => {
    expect([...collectIds(null).keys()]).toEqual([]);
    expect([...collectIds({ error: 'oops' }).keys()]).toEqual([]);
  });

  it('название берётся из d.names, иначе — из resourceName, иначе id остаётся как название; материалы — качество 1, kind material', () => {
    const d = { itemId: 'T4_RUNE', finishedQueryId: 'T4_RUNE', names: { T4_RUNE: 'Руна (знаток)' }, recipe: [{ resource: 'T4_CLOTH', queryId: 'T4_CLOTH', materialSource: 'buy', resourceName: 'Ткань' }, { resource: 'T4_X', queryId: 'T4_X', materialSource: 'buy' }] };
    const m = collectIds(d);
    expect(m.get('T4_RUNE')).toEqual({ name: 'Руна (знаток)', quality: 1, kind: 'self' });   // T4_RUNE тут — сам предмет расчёта (finishedQueryId)
    expect(m.get('T4_CLOTH')).toEqual({ name: 'Ткань', quality: 1, kind: 'material' });
    expect(m.get('T4_X')).toEqual({ name: 'T4_X', quality: 1, kind: 'material' });
  });

  it('качество и kind самого предмета — из d.quality/self, материалы — quality 1/material', () => {
    const d = { itemId: 'T4_HEAD_LEATHER_SET3', finishedQueryId: 'T4_HEAD_LEATHER_SET3@3', quality: 4, recipe: [{ resource: 'T4_LEATHER', queryId: 'T4_LEATHER', materialSource: 'buy' }] };
    const m = collectIds(d);
    expect(m.get('T4_HEAD_LEATHER_SET3@3')).toMatchObject({ quality: 4, kind: 'self' });
    expect(m.get('T4_LEATHER')).toMatchObject({ quality: 1, kind: 'material' });
  });

  it('без d.names сам предмет остаётся под голым id (нечем подписать) — selfLabel(d) даёт имя по d.itemId', () => {
    const d = { itemId: 'T4_HEAD_LEATHER_SET3', finishedQueryId: 'T4_HEAD_LEATHER_SET3@3', quality: 4, recipe: [] };
    expect(collectIds(d).get('T4_HEAD_LEATHER_SET3@3').name).toBe('T4_HEAD_LEATHER_SET3@3');
    const withLabel = collectIds(d, undefined, (dd) => `Капюшон ${dd.itemId}`);
    expect(withLabel.get('T4_HEAD_LEATHER_SET3@3').name).toBe('Капюшон T4_HEAD_LEATHER_SET3');
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

  it('selfLabel прокидывается в каждую позицию', () => {
    const results = new Map([['a', { itemId: 'T4_A', finishedQueryId: 'T4_A', recipe: [] }]]);
    const ids = collectAllIds(results, (d) => `Имя ${d.itemId}`);
    expect(ids.get('T4_A').name).toBe('Имя T4_A');
  });
});

describe('collectFactionIds', () => {
  const row = (o = {}) => ({
    itemId: 'T6_CAPEITEM_FW_LYMHURST', finishedId: 'T6_CAPEITEM_FW_LYMHURST@3', tier: 6, enchant: 3, crestId: 'T6_CAPEITEM_FW_LYMHURST_BP', heartId: 'T1_FACTION_FOREST_TOKEN_1',
    capeDirect: { id: 'T6_CAPE@3', label: 'Накидка (мастер) .3' }, cape0: { id: 'T6_CAPE', label: 'Накидка (мастер)' },
    runes: [{ id: 'T6_RUNE', label: 'Руна (мастер)' }, { id: 'T6_SOUL', label: 'Душа (мастер)' }, { id: 'T6_RELIC', label: 'Реликт (мастер)' }],
    crest: { label: 'Герб города Lymhurst (мастер)' }, heart: { label: 'Сердце древа' },
    ...o,
  });
  const planned = (r, path) => [{ c: { r, path } }];

  it('незачарованный плащ (.0): сам плащ, прямой материал, герб и сердце — цепочки нет, руны не нужны', () => {
    const ids = collectFactionIds(planned(row({ enchant: 0, finishedId: 'T6_CAPEITEM_FW_LYMHURST', capeDirect: { id: 'T6_CAPE@3', label: 'Накидка (мастер) .3' } }), 'direct'));
    expect([...ids.keys()]).toEqual(['T6_CAPEITEM_FW_LYMHURST', 'T6_CAPE@3', 'T6_CAPEITEM_FW_LYMHURST_BP', 'T1_FACTION_FOREST_TOKEN_1']);
    expect(ids.get('T6_CAPE@3').name).toBe('Накидка (мастер) .3');
    expect(ids.get('T6_CAPEITEM_FW_LYMHURST_BP').name).toBe('Герб города Lymhurst (мастер)');
  });

  it('без finishedLabel сам плащ остаётся под голым id (нечем подписать) — с finishedLabel(r) берёт имя и качество по r.itemId/r.quality; kind — self', () => {
    const noLabel = collectFactionIds(planned(row(), 'direct'));
    expect(noLabel.get('T6_CAPEITEM_FW_LYMHURST@3')).toEqual({ name: 'T6_CAPEITEM_FW_LYMHURST@3', quality: 1, kind: 'self' });
    const withLabel = collectFactionIds(planned(row({ quality: 4 }), 'direct'), undefined, (r) => `Накидка ${r.itemId} для ${r.tier}`);
    expect(withLabel.get('T6_CAPEITEM_FW_LYMHURST@3')).toEqual({ name: 'Накидка T6_CAPEITEM_FW_LYMHURST для 6', quality: 4, kind: 'self' });
  });

  it('зачарованный плащ: в списке ВСЕ рецепты (прямой, плащ .0, плащ на каждом уровне входа, руны) — не только выбранный путь', () => {
    const r = row({ capeByLevel: [{ level: 0, id: 'T6_CAPE', label: 'Накидка (мастер)' }, { level: 1, id: 'T6_CAPE@1', label: 'Накидка .1' }, { level: 2, id: 'T6_CAPE@2', label: 'Накидка .2' }] });
    const ids = collectFactionIds(planned(r, 'direct'));
    expect([...ids.keys()]).toEqual(['T6_CAPEITEM_FW_LYMHURST@3', 'T6_CAPE@3', 'T6_CAPE', 'T6_CAPE@1', 'T6_CAPE@2', 'T6_RUNE', 'T6_SOUL', 'T6_RELIC', 'T6_CAPEITEM_FW_LYMHURST_BP', 'T1_FACTION_FOREST_TOKEN_1']);
    expect(ids.get('T6_RUNE').name).toBe('Руна (мастер)');
  });

  it('герб или сердце без единой цены (crest/heart null) — id всё равно попадает в список, чтобы его можно было обновить', () => {
    const ids = collectFactionIds(planned(row({ crest: null, heart: null }), 'direct'));
    expect(ids.has('T6_CAPEITEM_FW_LYMHURST_BP')).toBe(true);
    expect(ids.get('T6_CAPEITEM_FW_LYMHURST_BP')).toMatchObject({ name: 'T6_CAPEITEM_FW_LYMHURST_BP', kind: 'material' });   // название неизвестно — остаётся id
  });

  it('несколько позиций плана объединяются без повторов', () => {
    const a = row();
    const b = row({ finishedId: 'T5_CAPEITEM_FW_LYMHURST@1', capeDirect: { id: 'T5_CAPE@1', label: 'Накидка .1' } });
    const ids = collectFactionIds([...planned(a, 'direct'), ...planned(b, 'direct')]);
    expect(ids.has('T6_CAPEITEM_FW_LYMHURST_BP')).toBe(true);
    expect(ids.has('T5_CAPE@1')).toBe(true);
    expect([...ids.keys()].filter((id) => id === 'T1_FACTION_FOREST_TOKEN_1')).toHaveLength(1);   // общее сердце — одной строкой
  });
});
