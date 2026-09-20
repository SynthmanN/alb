// Крафт-лист: позиции из скана, калькулятора, ленивого крафтера и фракционного плана. Живёт в браузере.
import { createStore } from './lib.js';

let uid = 0;
export const craftList = createStore({ items: [], faction: null }, { key: 'albion_next_list' });
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
export const clearList = () => craftList.set({ items: [], faction: null });
export const setFaction = (faction) => craftList.set({ faction });
