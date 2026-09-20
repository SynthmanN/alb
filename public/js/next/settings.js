// Общие параметры расчётов: одна панель на все инструменты страницы. Города, премиум и источник данных хранятся под теми же ключами,
// что и на старых страницах, поэтому выбор общий для всего сайта.
import { createStore } from './lib.js';

export const PROFILES = {
  bonus: { name: 'Бонус', craft: 24.8, refine: 36.7, note: 'город с бонусом' },
  plain: { name: 'Обычный', craft: 15.3, refine: 15.3, note: 'без бонуса города' },
  own: { name: 'Свой', craft: 24.8, refine: 36.7, note: 'вручную' },
};

const readLegacy = () => {
  try {
    return {
      premium: localStorage.getItem('albion_premium') === 'true',
      source: localStorage.getItem('albion_data_source') === 'aodp' ? 'aodp' : 'jug',
      optional: JSON.parse(localStorage.getItem('albion_optional_cities') || '[]'),
    };
  } catch (e) { return { premium: false, source: 'jug', optional: [] }; }
};
const legacy = readLegacy();

export const settings = createStore({
  profile: 'bonus', rrrCraft: 24.8, rrrRefine: 36.7, share: 0.25, hist: 3, mhist: 24,
  premium: legacy.premium, source: legacy.source, optional: legacy.optional,
  blackMarket: false, teleport: false, purchaseLog: false, ceiling: '', tolerance: 2,
}, { key: 'albion_next_settings' });

// общие ключи сайта — города, премиум, источник данных — пишем и туда
settings.subscribe(() => {
  const s = settings.get();
  try {
    localStorage.setItem('albion_premium', String(s.premium));
    localStorage.setItem('albion_data_source', s.source);
    localStorage.setItem('albion_optional_cities', JSON.stringify(s.optional));
  } catch (e) { /* хранилище недоступно */ }
});

export function setProfile(id) {
  const p = PROFILES[id];
  const s = settings.get();
  settings.set(id === 'own' ? { profile: 'own' } : { profile: id, rrrCraft: p.craft, rrrRefine: p.refine });
  return s;
}
export function setRrr(kind, value) {
  const v = Math.min(Math.max(parseFloat(value), 0), 95);
  settings.set({ [kind === 'craft' ? 'rrrCraft' : 'rrrRefine']: Number.isFinite(v) ? v : 0, profile: 'own' });
}
export function toggleCity(name) {
  const s = settings.get();
  const set = new Set(s.optional);
  if (set.has(name)) set.delete(name); else set.add(name);
  settings.set({ optional: [...set] });
}
export const activeCities = (s = settings.get()) => ['Fort Sterling', 'Bridgewatch', 'Lymhurst', 'Martlock', 'Thetford', ...s.optional.filter((c) => ['Caerleon', 'Brecilien'].includes(c))];

// Общие параметры запросов расчётов (ставки возврата всегда отправляются числом: пресеты старой страницы здесь не нужны)
export function commonParams(s = settings.get()) {
  return {
    cities: activeCities(s).join(','), premium: String(s.premium), source: s.source,
    gearRrr: 'city_bonus', gearRrrCustom: s.rrrCraft, refineRrr: 'city_bonus', refineRrrCustom: s.rrrRefine,
    marketShare: s.share, days: s.hist, materialHours: s.mhist, priceTolerance: s.tolerance,
    blackMarket: String(s.blackMarket), ...(s.teleport ? { teleport: 'true' } : {}), ...(s.ceiling ? { ceiling: s.ceiling } : {}),
  };
}
