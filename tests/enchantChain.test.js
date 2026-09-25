// «Чары после крафта»: точки входа в цепочку зачарования (server.js, enchantChainCandidates). Возврата ресурсов на
// рунах/душах/реликтах нет — шаг это просто количество × цена, никакой RRR-логики тут проверять не нужно.
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const { enchantChainCandidates } = require('../server.js');

describe('enchantChainCandidates', () => {
  it('только вход с уровня 0 (нет цен на промежуточные уровни) — один кандидат, вся цепочка с нуля', () => {
    const out = enchantChainCandidates({ 0: 1000 }, { 1: 100, 2: 200, 3: 300 }, 3);
    expect(out).toEqual([{ entryLevel: 0, cost: 1600 }]);
  });

  it('можно купить .1 на рынке дешевле, чем сделать .0 + руны — этот вход и должен победить (дешевле стоит первым)', () => {
    // Вход с 0: 1000 (база) + 100 (руны) + 200 (души) + 300 (реликты) = 1600
    // Вход с 1 (куплен готовый .1 за 1050): 1050 + 200 (души) + 300 (реликты) = 1550 — дешевле
    const out = enchantChainCandidates({ 0: 1000, 1: 1050 }, { 1: 100, 2: 200, 3: 300 }, 3);
    expect(out[0]).toEqual({ entryLevel: 1, cost: 1550 });
    expect(out).toContainEqual({ entryLevel: 0, cost: 1600 });
    expect(out).toHaveLength(2);
  });

  it('вход с любого уровня, у которого есть цена — не только 0 и предпоследний', () => {
    const out = enchantChainCandidates({ 0: 1000, 1: 1100, 2: 1300 }, { 1: 100, 2: 200, 3: 300 }, 3);
    // 0: 1000+100+200+300=1600; 1: 1100+200+300=1600; 2: 1300+300=1600 — все три входа посчитаны
    expect(out.map((c) => c.entryLevel).sort()).toEqual([0, 1, 2]);
  });

  it('нет цены входа на уровне — этот вход не участвует (не додумываем)', () => {
    const out = enchantChainCandidates({ 0: null, 1: 1050 }, { 1: 100, 2: 200, 3: 300 }, 3);
    expect(out).toEqual([{ entryLevel: 1, cost: 1550 }]);
  });

  it('нет цены на один из ОСТАВШИХСЯ шагов от этой точки входа — вход исключается, даже если сама точка входа известна', () => {
    // вход с 0 есть, но нет цены реликтов (шаг 3) — цепочка от 0 до target=3 не может быть посчитана
    const out = enchantChainCandidates({ 0: 1000, 1: 1050 }, { 1: 100, 2: 200, 3: null }, 3);
    // вход с 1 тоже нуждается в шаге 3 (реликты) — тоже исключается
    expect(out).toEqual([]);
  });

  it('нет вообще ни одной валидной точки входа — пустой массив, не падает', () => {
    expect(enchantChainCandidates({}, {}, 3)).toEqual([]);
  });

  it('target=1 — единственный возможный вход это 0 (промежуточных уровней между 0 и 1 нет)', () => {
    const out = enchantChainCandidates({ 0: 1000, 1: 999999 }, { 1: 100 }, 1);
    expect(out).toEqual([{ entryLevel: 0, cost: 1100 }]);   // entry=1 не рассматривается: entry < target, а target=1
  });

  it('отсортированы по возрастанию себестоимости — [0] всегда самый дешёвый кандидат', () => {
    const out = enchantChainCandidates({ 0: 500, 1: 100000 }, { 1: 1, 2: 1, 3: 1 }, 3);
    expect(out[0].entryLevel).toBe(0);
  });
});
