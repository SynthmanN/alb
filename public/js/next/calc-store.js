// Состояние калькулятора: предмет и параметры расчёта, ответ сервера и всё «своё»: цены материалов, лог закупок, цена продажи, цены городов,
// план продажи по городам. Своё пересчитывает результат на месте (logic/manual.js) — без запроса к серверу.
import { createStore } from './lib.js';
import { applyManualPrices, salePlanState } from './logic/manual.js';
import { profitOf } from './logic/profit.js';
import { priceLists, SETUP_FEE } from './logic/cityPrices.js';
import { makeOverride } from './logic/adjust.js';
import { resetPrices } from './prices.js';
import { activeCities } from './settings.js';

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// своё для одной вещи (цены материалов — общие, в prices.js): цена мгновенной продажи, цены городов продажи, план продажи по городам
export const emptyManual = () => ({ sellPrice: null, cityPrices: {}, toggles: null, manualQty: {}, strategy: 'profit' });
export const calcStore = createStore({
  itemId: null, enchant: 0, quality: 4, qty: 10, after: false, faction: false, crestSilver: false, heartSilver: false, sub: 'buy',
  data: null, loading: false, error: '', sig: '', checks: {}, ...emptyManual(),
  stackMode: false, stackFocus: null,          // режим стека: общий вид активных позиций или одна позиция в фокусе (uid)
});
const set = (p) => calcStore.set(p);
const num = (raw) => { const v = parseFloat(raw); return Number.isFinite(v) && v >= 0 ? v : null; };

export const setSellPrice = (raw) => set({ sellPrice: raw === '' ? null : num(raw) });
export function setCityPrice(city, raw) {
  const cityPrices = { ...calcStore.get().cityPrices };
  const v = num(raw);
  if (v !== null && raw !== '') cityPrices[city] = v; else delete cityPrices[city];
  set({ cityPrices });
}
// первое включение/выключение города фиксирует набор городов автоплана, дальше набор ведёт пользователь
function ensureToggles(c) {
  if (c.toggles && Object.keys(c.toggles).length) return { ...c.toggles };
  const p = c.data && c.data.patientSell;
  const auto = p && p.plan ? p.plan.cities.map((x) => x.city) : [];
  const t = {};
  for (const x of (p ? p.byCity : [])) t[x.city] = auto.includes(x.city);
  return t;
}
export function setToggle(city, on) {
  const c = calcStore.get();
  const toggles = ensureToggles(c);
  toggles[city] = on;
  const manualQty = { ...c.manualQty };
  if (!on) delete manualQty[city];
  set({ toggles, manualQty });
}
export function setManualQty(city, raw) {
  const c = calcStore.get();
  const manualQty = { ...c.manualQty, [city]: Math.max(Math.floor(Number(raw) || 0), 0) };
  let toggles = c.toggles;
  if (Number(raw) > 0) { toggles = ensureToggles(c); toggles[city] = true; }       // вписанное количество включает город в план
  set({ manualQty, toggles });
}
export const setStrategy = (strategy) => set({ strategy });
export const resetPlan = () => set({ manualQty: {}, toggles: null, cityPrices: {} });
export const resetOwn = () => { resetPrices(); set({ sellPrice: null }); };

// Всё производное от ответа сервера и «своего»: пересчитанный результат, живой план продажи, профит
export function derive(c, settings, prices) {
  if (!c.data) return { d: null, st: null, p: null };
  const lists = priceLists(c.data);
  const cities = activeCities(settings);
  const fee = c.data.setupFeeRate ?? SETUP_FEE;
  const m = makeOverride(lists, prices, { purchaseLog: settings.purchaseLog, cities, fee });
  const d = applyManualPrices(c.data, { ownPrice: m.ownPrice, buyPrice: m.buyPrice, hasOwn: m.hasOwn, sellPrice: c.sellPrice, cityPrices: c.cityPrices });
  const st = d.patientSell ? salePlanState(d.patientSell, d, { toggles: c.toggles, manualQty: c.manualQty, strategy: c.strategy }) : null;
  const p = profitOf(d, st);
  return { d, st, p, override: m.override, lists };
}
