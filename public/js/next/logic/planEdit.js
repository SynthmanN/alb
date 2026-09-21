// Правки плана продажи по городам: включение города, своё количество, своя цена города, стратегия. Чистые функции над состоянием
// plan = { toggles, manualQty, cityPrices, strategy } — им пользуются и одиночный калькулятор (calc-store), и позиции стека (поле item.plan).
import { applyManualPrices, salePlanState } from './manual.js';

const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const num = (raw) => { const v = parseFloat(raw); return Number.isFinite(v) && v >= 0 ? v : null; };
export const emptyPlan = () => ({ toggles: null, manualQty: {}, cityPrices: {}, strategy: 'profit' });
export const planOf = (item) => ({ ...emptyPlan(), ...((item && item.plan) || {}) });
export const isEdited = (plan) => !!plan && (!!(plan.toggles && Object.keys(plan.toggles).length) || Object.keys(plan.manualQty || {}).length > 0
  || Object.keys(plan.cityPrices || {}).length > 0 || (plan.strategy || 'profit') !== 'profit');

// первое включение/выключение города фиксирует набор городов автоплана, дальше набор ведёт пользователь
function ensureToggles(plan, p) {
  if (plan.toggles && Object.keys(plan.toggles).length) return { ...plan.toggles };
  const auto = p && p.plan ? p.plan.cities.map((x) => x.city) : [];
  const t = {};
  for (const x of (p ? p.byCity : [])) t[x.city] = auto.includes(x.city);
  return t;
}
export function withCityPrice(plan, city, raw) {
  const cityPrices = { ...plan.cityPrices };
  const v = num(raw);
  if (v !== null && raw !== '') cityPrices[city] = v; else delete cityPrices[city];
  return { ...plan, cityPrices };
}
export function withToggle(plan, p, city, on) {
  const toggles = ensureToggles(plan, p);
  toggles[city] = on;
  const manualQty = { ...plan.manualQty };
  if (!on) delete manualQty[city];
  return { ...plan, toggles, manualQty };
}
export function withManualQty(plan, p, city, raw) {
  const manualQty = { ...plan.manualQty, [city]: Math.max(Math.floor(Number(raw) || 0), 0) };
  let toggles = plan.toggles;
  if (Number(raw) > 0) { toggles = ensureToggles(plan, p); toggles[city] = true; }       // вписанное количество включает город в план
  return { ...plan, manualQty, toggles };
}
export const withStrategy = (plan, strategy) => ({ ...plan, strategy });
export const resetPlanState = (plan) => ({ ...plan, manualQty: {}, toggles: null, cityPrices: {} });

// Ответ калькулятора с учётом правок плана позиции: свои цены городов и живой план вместо серверного (профит позиции считается по нему)
export function applyItemPlan(d, plan) {
  if (!d || d.error || !d.patientSell || !isEdited(plan)) return d;
  const withPrices = Object.keys(plan.cityPrices || {}).length ? applyManualPrices(d, { cityPrices: plan.cityPrices }) : d;
  const st = salePlanState(withPrices.patientSell, withPrices, plan);
  if (!st || st.totalQty <= 0) return withPrices;
  const cities = st.rowsData.filter((r) => r.qty > 0).map((r) => ({ city: r.c.city, qty: r.qty, days: r.days }));
  return { ...withPrices, patientSell: { ...withPrices.patientSell, plan: { cities, excluded: [], totalDays: st.planDays, profitPerUnit: st.profitUnit, netPricePerUnit: st.netPrice } } };
}
export { has as hasKey };
