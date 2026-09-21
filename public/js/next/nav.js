// Навигация внутри страницы: активная вкладка и позиция, открытая в калькуляторе.
import { createStore } from './lib.js';

export const navStore = createStore({ tab: 'scan', calc: null });
// панель крафт-листа: открыта ли и отмеченные в закупке материалы
export const drawerStore = createStore({ open: false, checks: {} });
export const nav = {
  tab: (tab) => navStore.set({ tab }),
  // target: { itemId, enchant, quality, quantity, after }
  openCalc(target) { navStore.set({ tab: 'calc', calc: { ...target, at: Date.now() } }); window.scrollTo({ top: 0, behavior: 'smooth' }); },
};
