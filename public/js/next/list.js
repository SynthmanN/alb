// Стеки позиций: крафт-лист (копится по ходу работы, живёт в браузере) и стек калькулятора (копия активных позиций листа, со своими правками).
// Оба — один и тот же объект «стек»: те же операции, тот же расчёт (listcalc.js) и те же компоненты (stack-ui.js).
import { createStore } from './lib.js';

let uid = 0;
const newUid = () => `l${Date.now().toString(36)}${++uid}`;
const keyOf = (i) => [i.itemId, i.enchant, i.quality, i.after ? 1 : 0, i.crestSilver ? 1 : 0, i.heartSilver ? 1 : 0].join('|');

// item: { itemId, enchant, quality, quantity, cost?, profit?, points?, after?, salePrice?, crestSilver?, heartSilver?, faction? }
export function createStack(key) {
  const store = createStore({ items: [], faction: null, autoAfter: true }, { key });
  return {
    store,
    add(item) {
      store.set((s) => {
        const items = s.items.map((x) => ({ ...x }));
        const ex = items.find((x) => keyOf(x) === keyOf(item));
        if (ex) ex.quantity += item.quantity;
        else items.push({ ...item, uid: newUid(), on: true });
        return { items };
      });
    },
    setQuantity: (id, q) => store.set((s) => ({ items: s.items.map((x) => (x.uid === id ? { ...x, quantity: Math.max(parseInt(q, 10) || 1, 1) } : x)) })),
    remove: (id) => store.set((s) => ({ items: s.items.filter((x) => x.uid !== id) })),
    clear: () => store.set({ items: [], faction: null }),
    patch: (id, patch) => store.set((s) => ({ items: s.items.map((x) => (x.uid === id ? { ...x, ...patch } : x)) })),
    toggle: (id) => store.set((s) => ({ items: s.items.map((x) => (x.uid === id ? { ...x, on: x.on === false } : x)) })),
    setAutoAfter: (v) => store.set((s) => ({ autoAfter: v, items: v ? s.items : s.items.map((x) => ({ ...x, after: false })) })),
    // план очков заменяет прежние фракционные позиции (остальные остаются)
    replaceFaction(newItems, faction) {
      store.set((s) => ({ faction, items: [...s.items.filter((x) => !x.faction), ...newItems.map((i) => ({ ...i, uid: newUid(), on: true }))] }));
    },
    // копия позиций целиком (стек калькулятора из активных позиций листа)
    replaceAll(items, faction) {
      store.set({ faction, items: items.map((i) => ({ ...i, uid: newUid(), on: i.on !== false })) });
    },
  };
}

export const list = createStack('albion_next_list');
export const craftList = list.store;
export const addToList = list.add;
export const clearList = list.clear;
export const replaceFactionItems = list.replaceFaction;

export const stack = createStack('albion_next_calc_stack');
