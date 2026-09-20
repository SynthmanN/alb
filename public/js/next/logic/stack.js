// Позиции крафт-листа со фракционными плащами: профит по цене продажи из плана, недостающие цены, автовыбор «чары после крафта».
export const AFTER_GAIN = 0.07;                          // «после крафта» применяется, если профит выше на 7% и больше
export const afterPossible = (item) => item.enchant >= 1 && item.enchant <= 3;

// Недостающие цены материалов в ответе калькулятора (у деталей за очки цены нет и не нужно)
export function missingPrices(d) {
  const out = [];
  const label = (id, fb) => (d.names && d.names[id]) || fb || id;
  const eac = d.enchantAfterCraft;
  if (!(eac && eac.baseSource === 'buy')) {
    for (const r of d.recipe || []) if (r.materialSource !== 'points' && r.cheapestPrice === null) out.push({ id: r.queryId || r.resource, label: label(r.queryId || r.resource, r.resourceName) });
  }
  for (const st of (eac && eac.steps) || []) if (st.cheapestPrice === null) out.push({ id: st.materialId, label: st.materialName });
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

// Автовыбор: чары после крафта — если профит выше на 7% и больше (прямой путь без данных — если хоть какие-то есть)
export function decideAfter(item, pair) {
  const pd = itemProfit(item, pair.direct);
  const pa = itemProfit(item, pair.after);
  if (!pa) return false;
  if (!pd) return true;
  return pa.unit > pd.unit + AFTER_GAIN * Math.abs(pd.unit);
}

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
