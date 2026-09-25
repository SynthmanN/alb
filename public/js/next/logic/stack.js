// Позиции крафт-листа со фракционными плащами: профит по цене продажи из плана, недостающие цены, автовыбор «чары после крафта».
import { afterCraftWins } from './afterCraft.js';
export const afterPossible = (item) => item.enchant >= 1 && item.enchant <= 3;

// Недостающие цены материалов в ответе калькулятора (у деталей за очки цены нет и не нужно)
export function missingPrices(d) {
  const out = [];
  const label = (id, fb) => (d.names && d.names[id]) || fb || id;
  const eac = d.enchantAfterCraft;
  // Базовый рецепт (сырьё .0) нужен, только если путь реально идёт через него — либо нет «после крафта» вообще, либо есть,
  // но выбранный вход в цепочку — с нуля (chainEntryLevel 0) и база не куплена готовой. Купленный отдельно уровень .1/.2
  // (chainEntryLevel > 0) рецепт .0 вообще не использует — его материалы тут ни при чём.
  const usesBaseRecipe = !eac || (eac.chainEntryLevel === 0 && eac.baseSource !== 'buy');
  if (usesBaseRecipe) {
    for (const r of d.recipe || []) if (r.materialSource !== 'points' && r.cheapestPrice === null) out.push({ id: r.queryId || r.resource, label: label(r.queryId || r.resource, r.resourceName) });
  }
  // neededSteps — только шаги ПОСЛЕ выбранного входа (steps несёт полную цепочку с нуля для описания, даже когда вход не с неё)
  for (const st of (eac && eac.neededSteps) || eac?.steps || []) if (st.cheapestPrice === null) out.push({ id: st.materialId, label: st.materialName });
  return out;
}

// Профит позиции: цена продажи из плана (или своя) − налог и сбор − себестоимость калькулятора; нет цены продажи — терпеливая продажа, затем мгновенная
export function itemProfit(item, d) {
  if (!d || d.error || missingPrices(d).length) return null;
  const cost = d.effectiveCostPerUnit;
  if (cost === null || cost === undefined) return null;
  const gross = item.salePriceOwn !== undefined ? item.salePriceOwn : item.salePrice;
  if (gross > 0) return { unit: gross * (1 - d.taxRate - (d.setupFeeRate || 0)) - cost, basis: 'plan' };
  const p = d.patientSell;
  if (p) {
    const unit = p.plan && p.plan.cities && p.plan.cities.length ? p.plan.profitPerUnit : p.profitPerUnit;
    if (unit !== null && unit !== undefined) return { unit, basis: 'sell' };
  }
  if (d.profitPerUnit !== null && d.profitPerUnit !== undefined) return { unit: d.profitPerUnit, basis: 'buy' };
  return null;
}

// Автовыбор рецепта: прямой крафт против «чар после крафта» — а «после» бывает разной глубины: база .0 и вся цепочка (pair.after) или
// смешанный рецепт — база на уровне .L из зачарованного сырья (pair.hybrids[L]). Среди «после»-вариантов берётся самый выгодный по профиту,
// и только если он выигрывает у прямого крафта на 7%+ (logic/afterCraft.js) — иначе остаётся прямой. level — уровень базы победителя (0 — обычная).
export function pickAfter(item, pair) {
  const pd = itemProfit(item, pair.direct);
  let best = null;
  const variants = [[0, pair.after], ...Object.entries(pair.hybrids || {}).map(([lvl, d]) => [Number(lvl), d])];
  for (const [level, d] of variants) {
    const pf = d ? itemProfit(item, d) : null;
    if (pf && (!best || pf.unit > best.unit)) best = { level, unit: pf.unit, data: d };
  }
  const use = afterCraftWins(pd && pd.unit, best && best.unit);
  return { use, level: use ? best.level : 0, data: use ? best.data : pair.direct };
}
export const decideAfter = (item, pair) => pickAfter(item, pair).use;

export const silverParts = (item) => [item.crestSilver ? 'crest' : null, item.heartSilver ? 'heart' : null].filter(Boolean);

// Итоги по включённым позициям
export function stackTotals(items, results, available = 0) {
  const on = items.filter((i) => i.on !== false);
  const t = { items: on.length, capes: on.reduce((s, i) => s + i.quantity, 0), cost: 0, profit: 0, points: 0, noPrice: 0, pending: 0, errors: 0, fallback: 0, available };
  for (const item of on) {
    const raw = results.get(item.uid);
    if (!raw) { t.pending++; continue; }
    if (raw.error) { t.errors++; continue; }
    const pf = itemProfit(item, raw);
    if (!pf) { t.noPrice++; continue; }
    if (pf.basis !== 'plan') t.fallback++;
    t.cost += raw.totalCost;
    t.profit += pf.unit * item.quantity;
    if (raw.faction) t.points += raw.faction.pointsPerCape * item.quantity;
  }
  return t;
}
