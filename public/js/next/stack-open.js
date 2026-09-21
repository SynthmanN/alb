// «Открыть активные в калькуляторе»: копия включённых позиций попадает в стек калькулятора (дальше у него свои правки), калькулятор переходит в режим стека.
import { list, stack } from './list.js';
import { calcStore } from './calc-store.js';
import { nav, drawerStore } from './nav.js';

export function openStackInCalculator(items, faction) {
  const active = items.filter((i) => i.on !== false);
  if (!active.length) return false;
  stack.replaceAll(active, faction);
  calcStore.set({ stackMode: true, stackFocus: null, sub: 'buy' });
  drawerStore.set({ open: false });
  nav.tab('calc');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  return true;
}
export const openListInCalculator = () => { const s = list.store.get(); return openStackInCalculator(s.items, s.faction); };
