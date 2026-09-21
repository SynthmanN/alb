// Состояние калькулятора: предмет и параметры расчёта, ответ сервера и всё «своё»: цены материалов, лог закупок, цена продажи, цены городов,
// план продажи по городам. Своё пересчитывает результат на месте (logic/manual.js) — без запроса к серверу.
import { createStore } from './lib.js';
import { applyManualPrices, lotsAverage, salePlanState } from './logic/manual.js';
import { profitOf } from './logic/profit.js';
import { priceLists, bestBuy, SETUP_FEE } from './logic/cityPrices.js';
import { activeCities } from './settings.js';

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
export const emptyManual = () => ({ own: {}, cityOwn: {}, lots: {}, sellPrice: null, cityPrices: {}, toggles: null, manualQty: {}, strategy: 'profit' });
export const calcStore = createStore({
  itemId: null, enchant: 0, quality: 4, qty: 10, after: false, faction: false, crestSilver: false, heartSilver: false, sub: 'buy',
  data: null, loading: false, error: '', sig: '', checks: {}, ...emptyManual(),
});
const set = (p) => calcStore.set(p);
const num = (raw) => { const v = parseFloat(raw); return Number.isFinite(v) && v >= 0 ? v : null; };

export function setOwn(key, raw) {
  const own = { ...calcStore.get().own };
  const v = num(raw);
  if (v !== null && raw !== '') own[key] = v; else delete own[key];
  set({ own });
}
export function addLot(res) { const lots = { ...calcStore.get().lots }; lots[res] = [...(lots[res] || []), { qty: '', price: '' }]; set({ lots }); }
export function setLot(res, idx, field, raw) {
  const lots = { ...calcStore.get().lots };
  lots[res] = lots[res].map((l, i) => (i === idx ? { ...l, [field]: Number.isFinite(parseFloat(raw)) ? parseFloat(raw) : '' } : l));
  set({ lots });
}
export function delLot(res, idx) { const lots = { ...calcStore.get().lots }; lots[res] = lots[res].filter((_, i) => i !== idx); set({ lots }); }
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
// своя цена материала в конкретном городе: { материал: { город: цена } }
export function setCityOwn(res, city, raw) {
  const cityOwn = { ...calcStore.get().cityOwn };
  const m = { ...(cityOwn[res] || {}) };
  const v = num(raw);
  if (v !== null && raw !== '') m[city] = v; else delete m[city];
  if (Object.keys(m).length) cityOwn[res] = m; else delete cityOwn[res];
  set({ cityOwn });
}
export const resetOwn = () => set({ own: {}, cityOwn: {}, lots: {}, sellPrice: null });

// Всё производное от ответа сервера и «своего»: пересчитанный результат, живой план продажи, профит
export function derive(c, settings) {
  if (!c.data) return { d: null, st: null, p: null };
  const lists = priceLists(c.data);
  const cities = activeCities(settings);
  const fee = c.data.setupFeeRate ?? SETUP_FEE;
  const buyPrice = (res) => bestBuy(lists[res], c.cityOwn[res], cities, fee);
  const ownPrice = (res) => {
    if (settings.purchaseLog) { const a = lotsAverage(c.lots[res]); if (a) return a.avg; }
    return has(c.own, res) ? c.own[res] : undefined;
  };
  // что покупаем по своей цене: единая своя цена (или лог лотов) важнее цен городов
  const override = (res) => { const o = ownPrice(res); if (o !== undefined) return { price: o }; const b = buyPrice(res); return b ? { price: b.price, city: b.city } : undefined; };
  const hasOwn = Object.keys(c.own).length > 0 || Object.keys(c.cityOwn).length > 0 || (settings.purchaseLog && Object.values(c.lots).some((l) => lotsAverage(l)));
  const d = applyManualPrices(c.data, { ownPrice, buyPrice, hasOwn, sellPrice: c.sellPrice, cityPrices: c.cityPrices });
  const st = d.patientSell ? salePlanState(d.patientSell, d, { toggles: c.toggles, manualQty: c.manualQty, strategy: c.strategy }) : null;
  const p = profitOf(d, st);
  return { d, st, p, ownPrice, override, lists };
}
