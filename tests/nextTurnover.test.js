// Оборот плащей: логика показа (общая для плана, крафт-листа и стека) и потолок плана с переключателем «игнорировать»
import { describe, it, expect } from 'vitest';

let T, F;
describe('оборот и потолок плана', async () => {
  T = await import('../public/js/next/logic/turnover.js');
  F = await import('../public/js/next/logic/factionPlan.js');

  it('оборот позиции из плана — цифра плана, иначе спрос из расчёта', () => {
    expect(T.turnoverPerDay({ dailyVolume: 1.5 }, { patientSell: { avgDailyVolume: 9 } })).toEqual({ perDay: 1.5, source: 'plan' });
    expect(T.turnoverPerDay({}, { patientSell: { avgDailyVolume: 9 } })).toEqual({ perDay: 9, source: 'calc' });
    expect(T.turnoverPerDay({}, { patientSell: { avgDailyVolume: 0, marketDailyVolume: 4 } })).toEqual({ perDay: 4, source: 'calc' });
    expect(T.turnoverPerDay({}, null)).toEqual({ perDay: null, source: null });
    expect(T.turnoverPerDay({ dailyVolume: null }, { error: 'x' }).perDay).toBeNull();
  });

  it('дни на продажу и «медленно» — дольше окна истории', () => {
    expect(T.daysToSell(8, 1.33)).toBeCloseTo(6.02, 1);
    expect(T.daysToSell(8, 0)).toBeNull();
    expect(T.turnoverInfo(8, 1, 7)).toMatchObject({ days: 8, slow: true });
    expect(T.turnoverInfo(7, 1, 7).slow).toBe(false);
    expect(T.turnoverInfo(3, null, 7)).toMatchObject({ perDay: null, days: null, slow: false });
  });

  it('потолок рынка: оборот × окно, не меньше одной штуки', () => {
    expect(T.marketCap(1.33, 7)).toBe(9);
    expect(T.marketCap(0.14, 3)).toBe(1);
    expect(T.marketCap(null, 7)).toBeNull();
  });

  // две позиции: первая втрое выгоднее на очко, но рынок берёт мало; вторая — тонкая по выгоде, оборот большой
  const mkRow = (tier, enchant, vol, price) => ({
    itemId: `T${tier}_CAPEITEM_FW_LYMHURST`, tier, enchant, quality: 4, enchant0: 0, maxAfter: false, crestId: 'C', heartId: 'H',
    capeDirect: { id: `cape${tier}${enchant}`, price: 100000 }, cape0: { id: 'c0', price: 100000 }, runes: [],
    sale: { avgPrice: price, dailyVolume: vol }, crest: null, heart: null,
  });
  const rows = [mkRow(6, 3, 1, 700000), mkRow(6, 2, 20, 350000)];
  const ctx = { taxRate: 0.08, setupFeeRate: 0.025, days: 3, own: {}, limits: {}, mode: 'points' };
  const run = (extra) => {
    const computed = rows.map((r) => F.computeRow(r, { ...ctx, ...extra }));
    return { computed, plan: F.buildPlan(computed, { points: 60000, mode: 'points' }) };
  };
  const qtyOf = (plan, e) => plan.rows.find((x) => x.c.r.enchant === e);

  it('потолок ограничивает лучшую позицию, остаток очков уходит на другую', () => {
    const { plan, computed } = run({});
    expect(computed[0].capMarket).toBe(3);
    expect(qtyOf(plan, 3)).toMatchObject({ qty: 3, capped: true });
    expect(qtyOf(plan, 2).qty).toBe(7);
  });

  it('«игнорировать потолок»: вся сумма уходит на лучшую позицию, дни продажи считаются', () => {
    const { plan, computed } = run({ ignoreCap: true });
    expect(computed[0].cap).toBeNull();
    expect(computed[0].capMarket).toBe(3);                   // рыночный потолок остаётся для показа
    expect(qtyOf(plan, 3)).toMatchObject({ qty: 10, capped: false });
    expect(qtyOf(plan, 3).days).toBe(10);                    // 10 шт при обороте 1 шт/день
    expect(qtyOf(plan, 2).qty).toBe(0);
  });

  it('свой лимит действует и при игнорировании потолка', () => {
    const { plan } = run({ ignoreCap: true, limits: { '6|3|4': 4 } });
    expect(qtyOf(plan, 3)).toMatchObject({ qty: 4, capped: true });
  });

  it('без потолка и с огромным числом очков план не зависает: шагов не больше MAX_PLAN_STEPS', () => {
    const computed = rows.map((r) => F.computeRow(r, { ...ctx, ignoreCap: true }));
    const t = Date.now();
    const plan = F.buildPlan(computed, { points: 7_600_090_000, mode: 'points' });
    expect(Date.now() - t).toBeLessThan(3000);
    expect(plan.rows.reduce((a, x) => a + x.qty, 0)).toBeLessThanOrEqual(F.MAX_PLAN_STEPS);
  });

  it('позиции плана несут оборот в позиции крафт-листа', () => {
    const { plan } = run({});
    const items = F.planToListItems(plan.rows);
    expect(items.find((i) => i.enchant === 3).dailyVolume).toBe(1);
  });
});
