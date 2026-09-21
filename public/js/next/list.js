// Крафт-лист: позиции из скана, калькулятора, ленивого крафтера и фракционного плана. Живёт в браузере.
import { createStore } from './lib.js';

let uid = 0;
export const craftList = createStore({ items: [], faction: null, autoAfter: true, cityOwn: {} }, { key: 'albion_next_list' });
const keyOf = (i) => [i.itemId, i.enchant, i.quality, i.after ? 1 : 0, i.crestSilver ? 1 : 0, i.heartSilver ? 1 : 0].join('|');

// item: { itemId, enchant, quality, quantity, cost?, profit?, points?, after?, salePrice?, crestSilver?, heartSilver?, faction? }
export function addToList(item) {
  craftList.set((s) => {
    const items = s.items.map((x) => ({ ...x }));
    const ex = items.find((x) => keyOf(x) === keyOf(item));
    if (ex) ex.quantity += item.quantity;
    else items.push({ ...item, uid: `l${Date.now().toString(36)}${++uid}`, on: true });
    return { items };
  });
}
export const setQuantity = (id, q) => craftList.set((s) => ({ items: s.items.map((x) => (x.uid === id ? { ...x, quantity: Math.max(parseInt(q, 10) || 1, 1) } : x)) }));
export const removeFromList = (id) => craftList.set((s) => ({ items: s.items.filter((x) => x.uid !== id) }));
export const clearList = () => craftList.set({ items: [], faction: null, cityOwn: {} });
// План очков заменяет прежние фракционные позиции листа (остальные позиции остаются)
export function replaceFactionItems(newItems, faction) {
  craftList.set((s) => ({ faction, items: [...s.items.filter((x) => !x.faction), ...newItems.map((i) => ({ ...i, uid: `l${Date.now().toString(36)}${++uid}`, on: true }))] }));
}
export const patchItem = (id, patch) => craftList.set((s) => ({ items: s.items.map((x) => (x.uid === id ? { ...x, ...patch } : x)) }));
export const setAutoAfter = (v) => craftList.set((s) => ({ autoAfter: v, items: v ? s.items : s.items.map((x) => ({ ...x, after: false })) }));
export const setFaction = (faction) => craftList.set({ faction });
// своя цена материала в городе для всего листа: { материал: { город: цена } } — общая для всех позиций (рынок один)
export function setListCityOwn(res, city, raw) {
  craftList.set((s) => {
    const cityOwn = { ...(s.cityOwn || {}) };
    const m = { ...(cityOwn[res] || {}) };
    const v = parseFloat(raw);
    if (Number.isFinite(v) && v >= 0 && raw !== '') m[city] = v; else delete m[city];
    if (Object.keys(m).length) cityOwn[res] = m; else delete cityOwn[res];
    return { cityOwn };
  });
}
