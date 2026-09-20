// Профит позиции по ответу /api/craft-calc: главный показатель — продажа своим ордером (Sell Order, как в плане), запасной — мгновенная.
export function profitOf(data) {
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
  const days = p ? (p.plan && p.plan.totalDays !== null && p.plan.totalDays !== undefined ? p.plan.totalDays : p.daysToSellBatch) : null;
  return {
    unit, basis, total: unit === null ? null : unit * q, cost, totalCost: data.totalCost, instant, days,
    roi: unit !== null && cost > 0 ? (unit / cost) * 100 : null,
    income: unit === null ? null : (unit + cost) * q,
    complete: data.hasAllMaterialPrices !== false && cost !== null && cost !== undefined,
  };
}
