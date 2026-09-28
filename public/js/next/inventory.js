// Мои материалы: сколько чего уже лежит у игрока. Общие для калькулятора одной вещи, крафт-листа и стека (как свои цены), но живут в браузере.
import { createStore } from './lib.js';

export const inventory = createStore({ have: {} }, { key: 'albion_next_inventory' });

export function setHave(id, raw) {
  const have = { ...inventory.get().have };
  const v = Math.floor(parseFloat(raw));
  if (Number.isFinite(v) && v > 0) have[id] = v; else delete have[id];
  inventory.set({ have });
}
export const resetInventory = () => inventory.set({ have: {} });
