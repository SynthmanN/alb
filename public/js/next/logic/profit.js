// Профит позиции по ответу /api/craft-calc: главный показатель — продажа своим ордером (Sell Order, как в плане), запасной — мгновенная.
// live — живой план продажи по городам (salePlanState): правка плана меняет профит и срок в вердикте сразу
export function profitOf(data, live = null) {
  if (!data) return null;
  const q = data.quantity || 1;
  const cost = data.effectiveCostPerUnit;
  const p = data.patientSell;
  let unit = null;
  let basis = null;
  if (p) {
    const u = p.plan && p.plan.cities && p.plan.cities.length ? p.plan.profitPerUnit : p.profitPerUnit;
    if (u !== null && u !== undefined) { unit = u; basis = 'sell'; }
  }
  if (unit === null && data.profitPerUnit !== null && data.profitPerUnit !== undefined) { unit = data.profitPerUnit; basis = 'buy'; }
  const instant = data.profitPerUnit === undefined ? null : data.profitPerUnit;
  let days = p ? (p.plan && p.plan.totalDays !== null && p.plan.totalDays !== undefined ? p.plan.totalDays : p.daysToSellBatch) : null;
  let soldQty = q;
  let net = null;
  if (live && live.totalQty > 0 && live.profitUnit !== null) { unit = live.profitUnit; basis = 'sell'; days = live.planDays; soldQty = live.totalQty; net = live.netPrice; }
  return {
    unit, basis, total: unit === null ? null : unit * soldQty, soldQty, cost, totalCost: data.totalCost, instant, days,
    roi: unit !== null && cost > 0 ? (unit / cost) * 100 : null,
    income: unit === null ? null : (unit + cost) * soldQty,
    complete: data.hasAllMaterialPrices !== false && cost !== null && cost !== undefined,
  };
}
