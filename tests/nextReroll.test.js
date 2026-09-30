// Реролл качества: цена попытки, ожидаемая стоимость подъёма, добавка к себестоимости и выбор рецепта.
import { describe, it, expect } from 'vitest';
import {
  BASE_ATTEMPT, TRANSITIONS, attemptCost, rerollCost, rerollAttempts, rerollFor, rerollLevel, withReroll, qualityRerollRows, normalizeReroll, craftDistribution, fromLabel,
} from '../public/js/next/logic/reroll.js';
import { pickAfter, itemProfit } from '../public/js/next/logic/stack.js';
import { pickVariant } from '../public/js/next/logic/enchantChain.js';
import { compareVariants, stackPicks } from '../public/js/next/logic/inventory.js';

const C = BASE_ATTEMPT;
const cfg = { on: true, from: 1, base: BASE_ATTEMPT };

describe('цена попытки', () => {
  it('удваивается с каждым уровнем зачарования (замер: 2604 / 5208 / 10417 / 20834)', () => {
    expect(Math.round(attemptCost(1, 0))).toBe(2604);
    expect(Math.round(attemptCost(1, 1))).toBe(5208);
    expect(Math.round(attemptCost(1, 2))).toBe(10417);
    expect(Math.round(attemptCost(1, 3))).toBe(20833);
  });
  it('растёт с текущим качеством: ×1,25 / ×1,5 / ×6,25 (замер на .0: 3255 / 3907 / 16276)', () => {
    expect(Math.round(attemptCost(2, 0))).toBe(3255);
    expect(Math.round(attemptCost(3, 0))).toBe(3906);
    expect(Math.round(attemptCost(4, 0))).toBe(16276);
    expect(attemptCost(5, 0)).toBeNull();
  });
});

describe('шансы', () => {
  it('сумма каждой строки — 100%, у обычного промаха нет', () => {
    for (const q of [1, 2, 3, 4]) {
      const t = TRANSITIONS[q];
      const sum = Object.entries(t).reduce((s, [, p]) => s + p, 0);
      expect(sum).toBeCloseTo(1, 9);
    }
    expect(TRANSITIONS[1].stay).toBe(0);
    expect(TRANSITIONS[2].stay).toBeCloseTo(0.3, 9);
    expect(TRANSITIONS[3].stay).toBeCloseTo(0.5, 9);
    expect(TRANSITIONS[4].stay).toBeCloseTo(0.995, 9);
  });
});

describe('ожидаемая стоимость подъёма', () => {
  it('до текущего или ниже — бесплатно', () => {
    expect(rerollCost(3, 3, 0)).toBe(0);
    expect(rerollCost(4, 2, 2)).toBe(0);
  });
  it('обычное → хорошее: одна попытка, промаха нет', () => {
    expect(rerollCost(1, 2, 0)).toBeCloseTo(C, 6);
    expect(rerollAttempts(1, 2)).toBeCloseTo(1, 9);
  });
  it('обычное → выдающееся ≈ ×2,43 от цены первой попытки, → отличное ≈ ×4,93 (совпало с внешним расчётом)', () => {
    expect(rerollCost(1, 3, 0) / C).toBeCloseTo(2.43, 2);
    expect(rerollCost(1, 4, 0) / C).toBeGreaterThan(4.9);
    expect(rerollCost(1, 4, 0) / C).toBeLessThan(4.95);
  });
  it('хорошее → выдающееся: цена попытки / шанс успеха (60% + выше)', () => {
    // попытка с «хорошего» 3255; успех (≥ выдающегося) 70% → 3255 / 0,7
    expect(rerollCost(2, 3, 0)).toBeCloseTo(attemptCost(2, 0) / 0.7, 4);
  });
  it('выдающееся → отличное: 3907 / 0,5', () => {
    expect(rerollCost(3, 4, 0)).toBeCloseTo(attemptCost(3, 0) / 0.5, 4);
  });
  it('на .3 в 8 раз дороже, чем на .0 (цена попытки не зависит от тира)', () => {
    expect(rerollCost(1, 4, 3) / rerollCost(1, 4, 0)).toBeCloseTo(8, 9);
  });
  it('шедевр очень дорог: в сотни раз дороже отличного', () => {
    expect(rerollCost(1, 5, 0)).toBeGreaterThan(rerollCost(1, 4, 0) * 100);
  });
});

describe('настройки', () => {
  it('нормализуются: по умолчанию включено, качество после крафта по шансам (0), база 2604', () => {
    expect(normalizeReroll({})).toEqual({ on: true, from: 0, base: BASE_ATTEMPT });
    expect(normalizeReroll({ rerollOn: false, rerollStart: 2, rerollBase: 3000 })).toEqual({ on: false, from: 2, base: 3000 });
    expect(normalizeReroll({ rerollStart: 99, rerollBase: -5 })).toEqual({ on: true, from: 4, base: BASE_ATTEMPT });
  });
});

describe('качество после крафта по шансам (70 / 15 / 10 / 4,5 / 0,5)', () => {
  const chance = { on: true, from: 0, base: BASE_ATTEMPT };
  it('шансы нормализуются в сумму 1', () => {
    const dist = craftDistribution();
    expect(dist.map(([q]) => q)).toEqual([1, 2, 3, 4, 5]);
    expect(dist.reduce((s, [, p]) => s + p, 0)).toBeCloseTo(1, 9);
    expect(dist[0][1]).toBeCloseTo(0.7, 9);
    expect(dist[4][1]).toBeCloseTo(0.005, 9);
  });
  it('ожидаемый рерол — взвешенная сумма по стартовым качествам; дешевле, чем всегда с обычного', () => {
    const d = direct(3);
    const r = rerollFor(d, 4, chance);
    const dist = craftDistribution();
    const expected = dist.reduce((s, [q, p]) => s + p * rerollCost(q, 4, 3), 0);
    expect(r.perUnit).toBeCloseTo(expected, 6);
    expect(r.perUnit).toBeLessThan(rerollCost(1, 4, 3));
    expect(r.perUnit).toBeGreaterThan(rerollCost(2, 4, 3));
    expect(r.from).toBe(0);
    expect(r.fromLabel).toBe('после крафта по шансам');
  });
  it('цель «хорошее»: обычное реролится, остальные уже годны', () => {
    const p1 = craftDistribution()[0][1];
    expect(rerollFor(direct(0), 2, chance).perUnit).toBeCloseTo(p1 * rerollCost(1, 2, 0), 6);
  });
  it('цель «обычное» — реролл не нужен; фиксированный старт даёт прежний результат', () => {
    expect(rerollFor(direct(3), 1, chance)).toBeNull();
    expect(rerollFor(direct(3), 4, cfg).perUnit).toBeCloseTo(rerollCost(1, 4, 3), 9);
    expect(fromLabel(1)).toBe('с «Обычное»');
  });
});

const direct = (enchant, cost = 10000) => ({ itemId: 'T4_2H_BOW', enchant, quality: 4, quantity: 10, effectiveCostPerUnit: cost, totalCost: cost * 10, taxRate: 0.04, hasAllMaterialPrices: true });
const after = (target, baseLevel = 0, cost = 10000, entry = 0) => ({ ...direct(target, cost), enchantAfterCraft: { targetLevel: target, baseLevel, chainEntryLevel: entry } });

describe('уровень реролла варианта', () => {
  it('прямой крафт — на конечной вещи, «после крафта» — на базе', () => {
    expect(rerollLevel(direct(3))).toBe(3);
    expect(rerollLevel(after(3, 0))).toBe(0);
    expect(rerollLevel(after(3, 1))).toBe(1);
    expect(rerollLevel(after(3, 0, 1, 2))).toBe(2);
  });
});

describe('добавка к себестоимости', () => {
  it('нужное качество не выше стартового — ответ не меняется', () => {
    const d = direct(3);
    expect(withReroll(d, 1, cfg)).toBe(d);
    expect(withReroll(d, 4, { ...cfg, on: false })).toBe(d);
    expect(withReroll(d, 4, { ...cfg, from: 4 })).toBe(d);
  });

  it('вложения, итог и профит сдвигаются на рерол; исходный ответ не меняется', () => {
    const d = { ...direct(3), profitPerUnit: 5000, patientSell: { profitPerUnit: 4000, byCity: [{ city: 'A', profitPerUnit: 4000, avgDailyVolume: 3 }, { city: 'B', noData: true, profitPerUnit: null }], plan: { profitPerUnit: 3500 } } };
    const r = withReroll(d, 4, cfg);
    const delta = rerollCost(1, 4, 3);
    expect(r.reroll.perUnit).toBeCloseTo(delta, 6);
    expect(r.reroll).toMatchObject({ level: 3, from: 1, target: 4 });
    expect(r.effectiveCostPerUnit).toBeCloseTo(10000 + delta, 6);
    expect(r.totalCost).toBeCloseTo((10000 + delta) * 10, 4);
    expect(r.profitPerUnit).toBeCloseTo(5000 - delta, 6);
    expect(r.patientSell.profitPerUnit).toBeCloseTo(4000 - delta, 6);
    expect(r.patientSell.plan.profitPerUnit).toBeCloseTo(3500 - delta, 6);
    expect(r.patientSell.byCity[0].profitPerUnit).toBeCloseTo(4000 - delta, 6);
    expect(r.patientSell.byCity[1].profitPerUnit).toBeNull();
    expect(d.effectiveCostPerUnit).toBe(10000);
    expect(d.patientSell.profitPerUnit).toBe(4000);
  });

  it('повторно рерол не добавляется', () => {
    const once = withReroll(direct(2), 4, cfg);
    expect(withReroll(once, 4, cfg)).toBe(once);
  });

  it('нет цен — не трогаем', () => {
    const d = { ...direct(2), effectiveCostPerUnit: null };
    expect(withReroll(d, 4, cfg)).toBe(d);
  });
});

describe('выбор рецепта с учётом реролла', () => {
  // прямой .3 чуть дешевле по материалам, но рерол на .3 в 8 раз дороже, чем на базе .0 у «после крафта»
  const item = { itemId: 'T4_2H_BOW', enchant: 3, quality: 4, quantity: 10, salePrice: 60000 };
  const pair = { direct: direct(3, 20000), after: after(3, 0, 24000), hybrids: {} };
  const extra = (d) => -rerollFor(d, 4, cfg).perUnit;

  it('без реролла выигрывает прямой крафт', () => {
    expect(pickAfter(item, pair).use).toBe(false);
  });
  it('с рероллом дороже прямой рецепт проигрывает «.0 + зачарование»', () => {
    const pick = pickAfter(item, pair, extra);
    expect(pick.use).toBe(true);
    expect(pick.level).toBe(0);
  });
  it('profit позиции учитывает добавку', () => {
    const r = withReroll(pair.direct, 4, cfg);
    expect(itemProfit(item, r).unit).toBeCloseTo(itemProfit(item, pair.direct).unit - rerollCost(1, 4, 3), 4);
  });

  it('pickVariant: gain с рероллом выбирает базу с меньшим уровнем', () => {
    const hy = { 2: after(3, 2, 21000) };
    const all = { 0: after(3, 0, 22000) };
    const gain = (d) => -rerollFor(d, 4, cfg).perUnit;
    expect(pickVariant(all[0], hy, null, null).level).toBe(2);         // без реролла база .2 на 1000 дешевле
    expect(pickVariant(all[0], hy, null, gain).level).toBe(0);         // с рероллом база .2 дороже на 4× цены попытки
  });

  it('compareVariants добавляет рерол в «Вложения / шт»', () => {
    const variants = [{ key: 'direct', data: direct(3, 20000) }, { key: 'after0', data: after(3, 0, 24000) }];
    const cmp = compareVariants(variants, {}, (id) => id, (d) => rerollFor(d, 4, cfg).perUnit);
    const [a, b] = cmp.rows;
    expect(a.reroll).toBeCloseTo(rerollCost(1, 4, 3), 4);
    expect(b.reroll).toBeCloseTo(rerollCost(1, 4, 0), 4);
    expect(a.ownCost).toBeCloseTo(20000 + a.reroll, 4);
    expect(cmp.best).toBe('after0');
  });

  it('stackPicks: рерол учитывается и без своих материалов', () => {
    const pairs = new Map([[1, pair]]);
    const results = new Map([[1, pair.direct]]);
    const picks = stackPicks([{ ...item, uid: 1 }], pairs, results, {}, (id) => id, (it) => (d) => rerollFor(d, it.quality, cfg).perUnit);
    expect(picks.get(1).use).toBe(true);
  });
});

describe('таблица по качеству', () => {
  it('рерол и профит с ним для каждого качества', () => {
    const d = withReroll({ ...direct(2), qualityComparison: [{ quality: 1, profitPerUnit: 1000 }, { quality: 2, profitPerUnit: 1500 }, { quality: 4, profitPerUnit: 9000 }] }, 4, cfg);
    const rows = qualityRerollRows(d, cfg);
    expect(rows[0]).toMatchObject({ rerollCost: 0, profitWithReroll: 1000 });
    expect(rows[1].rerollCost).toBeCloseTo(rerollCost(1, 2, 2), 4);
    expect(rows[2].rerollCost).toBeCloseTo(rerollCost(1, 4, 2), 4);
    expect(rows[2].profitWithReroll).toBeCloseTo(9000 - rerollCost(1, 4, 2), 4);
  });
});
