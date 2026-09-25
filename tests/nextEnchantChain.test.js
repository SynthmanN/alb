// «Чары после крафта» на клиенте (план фракции): та же чистая функция, что и у сервера (tests/enchantChain.test.js), — общий
// алгоритм, две копии (сервер CommonJS, клиент ESM для браузера) не делят модуль напрямую.
import { describe, it, expect } from 'vitest';
import { enchantChainCandidates, applyChainChoice } from '../public/js/next/logic/enchantChain.js';

describe('enchantChainCandidates (клиент)', () => {
  it('можно купить .1 на рынке дешевле, чем сделать .0 + руны — этот вход и должен победить', () => {
    const out = enchantChainCandidates({ 0: 1000, 1: 1050 }, { 1: 100, 2: 200, 3: 300 }, 3);
    expect(out[0]).toEqual({ entryLevel: 1, cost: 1550 });
    expect(out).toHaveLength(2);
  });
  it('нет цены на один из оставшихся шагов — вход исключается', () => {
    const out = enchantChainCandidates({ 0: 1000, 1: 1050 }, { 1: 100, 2: 200, 3: null }, 3);
    expect(out).toEqual([]);
  });
  it('target=1 — единственный возможный вход это 0', () => {
    const out = enchantChainCandidates({ 0: 1000, 1: 999999 }, { 1: 100 }, 1);
    expect(out).toEqual([{ entryLevel: 0, cost: 1100 }]);
  });
});

describe('applyChainChoice — ручной выбор пути «после крафта» (дропдаун + тумблер «только основной рецепт»)', () => {
  const eac = (over) => ({
    forced: false, targetLevel: 2, capped: false, baseSource: 'craft', baseBuy: null, baseCraftCostPerUnit: 1000, baseCostPerUnit: 1000,
    steps: [{ level: 1, materialId: 'T4_RUNE', materialName: 'Руна', count: 96, cheapestPrice: 5, cost: 480 }, { level: 2, materialId: 'T4_SOUL', materialName: 'Душа', count: 96, cheapestPrice: 10, cost: 960 }],
    chainEntryLevel: 1, chainEntryId: 'T4_CAPE@1', chainEntryLabel: 'Плащ .1', chainEntryCity: 'Caerleon',
    neededSteps: [{ level: 2, materialId: 'T4_SOUL', materialName: 'Душа', count: 96, cheapestPrice: 10, cost: 960 }],
    candidates: [
      { entryLevel: 0, cost: 2440, entryPrice: 1000, entryCity: null, entryLabel: null },
      { entryLevel: 1, cost: 1960, entryPrice: 1000, entryCity: 'Caerleon', entryLabel: 'Плащ .1' },
    ],
    ...over,
  });
  const data = (over) => ({ itemId: 'T4_CAPE', quantity: 10, effectiveCostPerUnit: 1960, totalCost: 19600, enchantAfterCraft: eac(), ...over });

  it('без выбора (choice=null) — данные не трогаются, идёт автовыбор сервера', () => {
    const d = data();
    expect(applyChainChoice(d, null)).toBe(d);
  });
  it('тумблер «только основной рецепт» — заставляет вход с нуля, даже если сервер выбрал другой', () => {
    const out = applyChainChoice(data(), { forceMain: true });
    expect(out.enchantAfterCraft).toMatchObject({ chainEntryLevel: 0, chainEntryId: null, chainEntryLabel: null, chainEntryCity: null });
    expect(out.enchantAfterCraft.neededSteps).toHaveLength(2);          // с нуля — оба шага (руна и душа)
    expect(out.effectiveCostPerUnit).toBe(2440);
    expect(out.totalCost).toBe(24400);
  });
  it('дропдаун — выбор совпадает с уже выбранным сервером входом — данные не трогаются', () => {
    const d = data();
    expect(applyChainChoice(d, { entryLevel: 1 })).toBe(d);
  });
  it('нет такого кандидата (или без цены) — данные не трогаются, не падает', () => {
    const d = data();
    expect(applyChainChoice(d, { entryLevel: 3 })).toBe(d);
  });
});
