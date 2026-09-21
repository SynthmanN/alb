// Свои цены материалов: общие для калькулятора, крафт-листа и стека калькулятора (цена материала — факт рынка, а не свойство предмета).
// Живут в памяти страницы; «Сбросить свои цены» очищает всё. Единая цена, цены по городам и лог закупок по лотам.
import { createStore } from './lib.js';

export const prices = createStore({ own: {}, cityOwn: {}, lots: {} });
const set = (p) => prices.set(p);
const num = (raw) => { const v = parseFloat(raw); return Number.isFinite(v) && v >= 0 ? v : null; };

export function setOwn(key, raw) {
  const own = { ...prices.get().own };
  const v = num(raw);
  if (v !== null && raw !== '') own[key] = v; else delete own[key];
  set({ own });
}
export function setCityOwn(res, city, raw) {
  const cityOwn = { ...prices.get().cityOwn };
  const m = { ...(cityOwn[res] || {}) };
  const v = num(raw);
  if (v !== null && raw !== '') m[city] = v; else delete m[city];
  if (Object.keys(m).length) cityOwn[res] = m; else delete cityOwn[res];
  set({ cityOwn });
}
export function addLot(res) { const lots = { ...prices.get().lots }; lots[res] = [...(lots[res] || []), { qty: '', price: '' }]; set({ lots }); }
export function setLot(res, idx, field, raw) {
  const lots = { ...prices.get().lots };
  lots[res] = lots[res].map((l, i) => (i === idx ? { ...l, [field]: Number.isFinite(parseFloat(raw)) ? parseFloat(raw) : '' } : l));
  set({ lots });
}
export function delLot(res, idx) { const lots = { ...prices.get().lots }; lots[res] = lots[res].filter((_, i) => i !== idx); set({ lots }); }
export const resetPrices = () => set({ own: {}, cityOwn: {}, lots: {} });
export const hasAnyPrices = (p = prices.get()) => Object.keys(p.own).length > 0 || Object.keys(p.cityOwn).length > 0 || Object.values(p.lots).some((l) => l.some((x) => x.qty > 0));
