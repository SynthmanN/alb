// Расчёт фракционного плана (чистая логика): те же правила, что были в старом плане — пути себестоимости, варианты деталей, жадный план.
import { describe, it, expect } from 'vitest';
import { computeRow, buildPlan, sortPlanRows, planToListItems, rowKey } from '../public/js/next/logic/factionPlan.js';
import { decideAfter, itemProfit, missingPrices, stackTotals } from '../public/js/next/logic/stack.js';

const ctx = (extra = {}) => ({ taxRate: 0.08, setupFeeRate: 0.025, days: 7, own: {}, limits: {}, mode: 'mixed', ...extra });
const row = (tier, enchant, o = {}) => ({
  itemId: `T${tier}_CAPEITEM_FW_MARTLOCK`, tier, enchant, quality: 4, crestId: `T${tier}_CAPEITEM_FW_MARTLOCK_BP`, heartId: 'HEART', maxAfter: enchant <= 3,
  capeDirect: { id: `T${tier}_CAPE@${enchant}`, label: 'Плащ', price: 5000 }, cape0: { id: `T${tier}_CAPE`, label: 'Плащ .0', price: 1000 },
  runes: enchant ? Array.from({ length: enchant }, (_, i) => ({ id: `T${tier}_R${i}`, label: 'Руна', count: 96, price: 10 })) : [],
  crest: { id: `T${tier}_CAPEITEM_FW_MARTLOCK_BP`, price: 2000 }, heart: { id: 'HEART', price: 3000 },
  sale: { avgPrice: 60000, dailyVolume: 5 }, ...o,
});

describe('computeRow', () => {
  // Порог общий с крафт-листом и сканом (logic/afterCraft.js): считается ПРОФИТ каждого пути (продажа одна и та же), «после»
  // побеждает, только если профит выше прямого на 7%+. Раньше план сравнивал голую себестоимость материалов на 5% — тот же
  // предмет мог получить разный ответ в плане и в крафт-листе; эти два случая специально это проверяют.
  it('«после крафта» выбирается по профиту (не по голой себестоимости): выигрыш в цене не всегда даёт нужный выигрыш в профите', () => {
    // net = 60000 × (1 − 0.105) = 53700; после = 1000 + 96 × 10 = 1960
    const cheap = computeRow(row(4, 1, { capeDirect: { id: 'X', label: 'Плащ', price: 8000 } }), ctx());
    // профит: прямой 53700 − 8000 = 45700, после 53700 − 1960 = 51740 > 45700 × 1.07 = 48899 → после
    expect(cheap.path).toBe('after');
    expect(cheap.cost).toBe(1960);
    // после (5000) дешевле прямого (6000) больше чем на 5% — по старому правилу (себестоимость) стало бы «после»
    const dear = computeRow(row(4, 1, {
      capeDirect: { id: 'X', label: 'Плащ', price: 6000 },
      cape0: { id: 'C0', label: 'Плащ .0', price: 3560 },
      runes: [{ id: 'R', label: 'Руна', count: 96, price: 15 }],   // после = 3560 + 96 × 15 = 5000
    }), ctx());
    // профит: прямой 53700 − 6000 = 47700, после 53700 − 5000 = 48700 — выигрыш меньше 7% (нужно 51039) → остаётся прямой
    expect(dear).toMatchObject({ path: 'direct', cost: 6000 });
  });
  it('чистая цена продажи: налог и Setup Fee; очки на плащ = сердце 3000 + герб тира; профит', () => {
    const c = computeRow(row(5, 0), ctx());
    expect(c.net).toBeCloseTo(60000 * (1 - 0.08 - 0.025), 6);
    expect(c.pointsAll).toBe(3000 + 2250);
    expect(c.profitAll).toBeCloseTo(c.net - 5000, 6);
    expect(c.partsNet).toBeCloseTo((2000 + 3000) * 0.895, 6);
  });
  it('варианты деталей: всё за очки, герб за очки + сердце за серебро (с комиссией), сердце за очки + герб за серебро; режим «всё за очки» — только первый', () => {
    const c = computeRow(row(4, 0), ctx());
    expect(c.variants.map((v) => v.id)).toEqual(['all', 'crest', 'heart']);
    expect(c.variants[1]).toMatchObject({ points: 400, profit: c.profitAll - 3000 * 1.025 });
    expect(c.variants[2]).toMatchObject({ points: 3000, profit: c.profitAll - 2000 * 1.025 });
    expect(computeRow(row(4, 0), ctx({ mode: 'points' })).variants.map((v) => v.id)).toEqual(['all']);
  });
  it('вписанные цены: цена материала получает комиссию, цена продажи и деталей — как есть; недостающее перечислено', () => {
    const noCape = row(4, 0, { capeDirect: { id: 'T4_CAPE@0', label: 'Плащ', price: null }, sale: null, crest: null });
    const c0 = computeRow(noCape, ctx());
    expect(c0.cost).toBeNull();
    expect(c0.missing.map((m) => m.key)).toEqual(['mat:T4_CAPE@0', `sale:${rowKey(noCape)}`, 'part:T4_CAPEITEM_FW_MARTLOCK_BP']);
    const c1 = computeRow(noCape, ctx({ own: { 'mat:T4_CAPE@0': 4000, [`sale:${rowKey(noCape)}`]: 50000, 'part:T4_CAPEITEM_FW_MARTLOCK_BP': 1000 } }));
    expect(c1.cost).toBeCloseTo(4000 * 1.025, 6);
    expect(c1.net).toBeCloseTo(50000 * 0.895, 6);
    expect(c1.missing).toEqual([]);
  });
  it('вход в цепочку не с нуля: куплен готовый плащ .1 дешевле, чем .0 + все руны и души — выигрывает он, а не полная цепочка', () => {
    // capeDirect дорогой (10000), чтобы «после» выигрывало профитом с запасом 7%+ — сравнение веду отдельно от выбора входа внутри цепочки
    const r = row(4, 2, { capeDirect: { id: 'X', label: 'Плащ', price: 10000 }, capeByLevel: [{ level: 0, id: 'T4_CAPE', label: 'Плащ .0', price: 1000 }, { level: 1, id: 'T4_CAPE@1', label: 'Плащ .1', price: 1500 }] });
    // вход 0: 1000 + 96×10 + 96×10 = 2920; вход 1: 1500 + 96×10 (только души) = 2460 — дешевле, значит и выиграет как «после»
    const c = computeRow(r, ctx());
    expect(c.path).toBe('after');
    expect(c.cost).toBe(2460);
    expect(c.entryLevel).toBe(1);
  });
  it('вписанная цена входа .1 отменяет серверную и участвует в выборе кандидата (комиссия 2.5%)', () => {
    const r = row(4, 2, { capeDirect: { id: 'X', label: 'Плащ', price: 10000 }, capeByLevel: [{ level: 0, id: 'T4_CAPE', label: 'Плащ .0', price: 1000 }, { level: 1, id: 'T4_CAPE@1', label: 'Плащ .1', price: 3000 }] });
    // без своей цены вход 1 дороже входа 0 (3000+960=3960 > 2920) — побеждает 0
    expect(computeRow(r, ctx()).entryLevel).toBe(0);
    // своя цена делает вход 1 дешевле: 1000×1.025+960=1985
    const c = computeRow(r, ctx({ own: { 'mat:T4_CAPE@1': 1000 } }));
    expect(c.entryLevel).toBe(1);
    expect(c.cost).toBeCloseTo(1000 * 1.025 + 960, 6);
  });
  it('потолок штук: оборот × окно (не меньше 1), свой лимит важнее, нет истории — неизвестен', () => {
    expect(computeRow(row(4, 0), ctx()).cap).toBe(35);
    expect(computeRow(row(4, 0), ctx({ limits: { [rowKey(row(4, 0))]: 3 } })).cap).toBe(3);
    expect(computeRow(row(4, 0, { sale: { avgPrice: 1, dailyVolume: null } }), ctx()).cap).toBeNull();
  });
});

describe('buildPlan', () => {
  it('жадно по профиту на очко, не больше потолка (оборот × окно); T4 выгоднее на очко и забирает своё первым', () => {
    const rows = [computeRow(row(4, 0), ctx()), computeRow(row(5, 0), ctx())];
    const p = buildPlan(rows, { points: 200000, mode: 'points' });
    const t4 = p.rows.find((x) => x.c.r.tier === 4);
    const t5 = p.rows.find((x) => x.c.r.tier === 5);
    expect(t4.qty).toBe(35);                                          // потолок 5 шт/день × 7 дней
    expect(t5.qty).toBe(15);                                          // (200 000 − 119 000) ÷ 5 250
    expect(t4.points).toBe(35 * 3400);
    expect(t4.points + t5.points + p.left).toBe(200000);
    const short = buildPlan(rows, { points: 90000, mode: 'points' });
    expect(short.rows.find((x) => x.c.r.tier === 4).qty).toBe(26);     // очков хватает на 26 плащей T4 (26 × 3400), на T5 — уже нет
    expect(short.rows.find((x) => x.c.r.tier === 5).qty).toBe(0);
  });
  it('смешанный режим: очков не хватает на «всё за очки» — берётся вариант «деталь за серебро»', () => {
    const rows = [computeRow(row(4, 0, { sale: null }), ctx()), computeRow(row(5, 0), ctx())];
    const p = buildPlan(rows, { points: 2250, mode: 'mixed' });
    const t5 = p.rows.find((x) => x.c.r.tier === 5);
    expect(t5.qty).toBe(1);
    expect(t5.byVariant).toEqual({ crest: 1 });                        // герб T5 за 2250 очков, сердце — за серебро
    expect(p.left).toBe(0);
    expect(buildPlan(rows, { points: 2250, mode: 'points' }).rows.every((x) => x.qty === 0)).toBe(true);   // в режиме «всё за очки» на плащ не хватает
  });
  it('сортировка: позиции в плане всегда сверху; план уходит в лист строками по вариантам', () => {
    const rows = [computeRow(row(4, 0, { sale: null }), ctx()), computeRow(row(5, 0), ctx())];
    const p = buildPlan(rows, { points: 2250, mode: 'mixed' });
    expect(sortPlanRows(p.rows, { key: 'name', dir: 'asc' })[0].c.r.tier).toBe(5);
    expect(planToListItems(p.rows)).toEqual([expect.objectContaining({ itemId: 'T5_CAPEITEM_FW_MARTLOCK', quantity: 1, crestSilver: false, heartSilver: true, faction: true })]);
  });
});

describe('стек: профит позиции и автовыбор «после крафта»', () => {
  const calc = (cost) => ({ effectiveCostPerUnit: cost, taxRate: 0.08, setupFeeRate: 0, recipe: [], patientSell: null, profitPerUnit: null });
  it('профит по цене продажи из плана (своя важнее); нет цены материала — позиция без профита', () => {
    const item = { salePrice: 100000 };
    expect(itemProfit(item, calc(50000)).unit).toBeCloseTo(100000 * 0.92 - 50000, 6);
    expect(itemProfit({ ...item, salePriceOwn: 60000 }, calc(50000)).unit).toBeCloseTo(60000 * 0.92 - 50000, 6);
    const missing = { ...calc(1), recipe: [{ resource: 'X', materialSource: 'buy', cheapestPrice: null }] };
    expect(missingPrices(missing)).toHaveLength(1);
    expect(itemProfit(item, missing)).toBeNull();
  });
  it('после крафта — только если профит выше на 7% и больше', () => {
    const item = { salePrice: 100000 };
    expect(decideAfter(item, { direct: calc(50000), after: calc(40000) })).toBe(true);     // 52 000 против 42 000: +23.8%
    expect(decideAfter(item, { direct: calc(50000), after: calc(49000) })).toBe(false);    // 43 000 против 42 000: +2.4%
    expect(decideAfter(item, { direct: { error: 'x' }, after: calc(40000) })).toBe(true);
  });
  it('итоги: очки, вложения, профит по включённым; позиции без данных считаются отдельно', () => {
    const items = [{ uid: 'a', quantity: 2, salePrice: 100000, on: true }, { uid: 'b', quantity: 1, on: true }, { uid: 'c', quantity: 5, on: false }];
    const results = new Map([['a', { ...calc(50000), totalCost: 100000, faction: { pointsPerCape: 3400 } }], ['c', { ...calc(1), totalCost: 5, faction: { pointsPerCape: 1 } }]]);
    const t = stackTotals(items, results, 10000);
    expect(t).toMatchObject({ items: 2, capes: 3, cost: 100000, points: 6800, pending: 1, noPrice: 0 });
    expect(t.profit).toBeCloseTo(2 * (100000 * 0.92 - 50000), 6);
  });
});
