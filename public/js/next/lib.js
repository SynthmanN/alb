// Ядро новой страницы «Крафт»: Preact + htm без сборки, маленькое хранилище состояния, форматирование, названия предметов, запросы к API.
import { h, render, Fragment } from 'preact';
import { useState, useEffect, useRef, useMemo, useCallback } from 'preact/hooks';
import htm from 'htm';

export const html = htm.bind(h);
export { h, render, Fragment, useState, useEffect, useRef, useMemo, useCallback };

// ---------- хранилище ----------
// createStore(начальное, { key }) — состояние живёт в памяти; с key ещё и в localStorage (без падений, если хранилище недоступно).
export function createStore(initial, { key = null, pick = null } = {}) {
  let state = initial;
  if (key) {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (saved && typeof saved === 'object') state = { ...initial, ...saved };
    } catch (e) { /* повреждённое сохранение — начинаем с начального */ }
  }
  const subs = new Set();
  const persist = () => {
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify(pick ? pick(state) : state)); } catch (e) { /* хранилище недоступно */ }
  };
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      persist();
      subs.forEach((f) => f());
    },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
  };
}
export function useStore(store, select = (s) => s) {
  const [value, setValue] = useState(() => select(store.get()));
  useEffect(() => {
    const sync = () => setValue(select(store.get()));
    sync();
    return store.subscribe(sync);
  }, [store]);
  return value;
}

// ---------- форматирование ----------
export const fmt = (n, d = 0) => (n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: d }));
export const signed = (n, d = 0) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n), d)}`);
export const tone = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
export const QN = { 1: 'Обычное', 2: 'Хорошее', 3: 'Выдающееся', 4: 'Отличное', 5: 'Шедевр' };
export function fmtAge(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${Math.round(minutes)} мин назад`;
  if (minutes < 2880) return `${(minutes / 60).toFixed(minutes < 600 ? 1 : 0)} ч назад`;
  return `${(minutes / 1440).toFixed(1)} дн. назад`;
}
export function fmtDays(d) {
  if (d === null || d === undefined) return '—';
  if (d < 1 / 24) return 'меньше часа';
  if (d < 1) return `${(d * 24).toFixed(d * 24 < 10 ? 1 : 0)} ч`;
  return `${d.toFixed(d < 10 ? 1 : 0)} дн.`;
}

// ---------- города ----------
export const CITY_CLS = { Lymhurst: 'lym', Martlock: 'mar', Thetford: 'the', Bridgewatch: 'bri', 'Fort Sterling': 'fst', Caerleon: 'cae', Brecilien: 'bre' };
export const MAIN_CITIES = ['Lymhurst', 'Martlock', 'Thetford', 'Bridgewatch', 'Fort Sterling'];
export const OPTIONAL_CITIES = ['Caerleon', 'Brecilien'];

// ---------- предметы ----------
let itemsById = new Map();
export const findItem = (id) => itemsById.get(id) || null;
export const allItems = () => [...itemsById.values()];
// «T4 Меч (знаток)» → «Меч (знаток)»: тир показывает отдельная метка
export const itemLabel = (id) => { const it = itemsById.get(id); return it ? it.name.replace(/^T\d+\s+/, '') : id; };
export const itemTier = (id) => { const it = itemsById.get(id); return it ? it.tier : Number((String(id).match(/^T(\d)/) || [])[1]) || 0; };
export const iconUrl = (id, size = 64, enchant = 0, quality = 1) => `https://render.albiononline.com/v1/item/${encodeURIComponent(enchant > 0 ? `${id}@${enchant}` : id)}.png?quality=${quality}&size=${size}`;
// Название для поиска на аукционе (тир и «.N» отбрасываются; зачарование в игре — отдельный фильтр)
export const auctionName = (name) => String(name || '').replace(/^T\d+\s+/, '').replace(/\s\.\d$/, '');

// группы оружия (для выбора предмета по категориям и подсказки «где крафтить»)
let weaponGroups = [];
export const getWeaponGroups = () => weaponGroups;

// ---------- API ----------
// Сервер пускает не больше 60 запросов в минуту на /api с одного адреса (независимо от источника данных: краулер или AODP), поэтому страница
// держит общий бюджет: запросы сверх него ждут своей очереди, одинаковые запросы кэшируются и не дублируются, а 429 повторяется сам.
export const apiLimits = { windowMs: 60000, budget: 40, retries: 2, retryMs: 15000 };
const stamps = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function takeSlot() {
  for (;;) {
    const now = Date.now();
    while (stamps.length && now - stamps[0] > apiLimits.windowMs) stamps.shift();
    if (stamps.length < apiLimits.budget) { stamps.push(now); return; }
    await sleep(stamps[0] + apiLimits.windowMs - now + 50);
  }
}
const apiCache = new Map();                    // ключ запроса → { ts, promise }
export const clearApiCache = () => apiCache.clear();
export const resetApiBudget = () => { stamps.length = 0; };

async function fetchJsonOnce(url, init) {
  await takeSlot();
  let res;
  try { res = await fetch(url, init); } catch (e) { throw new Error('нет связи с сервером — проверь, что он запущен'); }
  return res;
}
async function request(url, init) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchJsonOnce(url, init);
    if (res.status === 429 && attempt < apiLimits.retries) {         // слишком много запросов: ждём и повторяем
      const ra = parseInt(res.headers.get('retry-after') || '', 10);
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : apiLimits.retryMs);
      continue;
    }
    if (!(res.headers.get('content-type') || '').includes('json')) {
      const hint = res.status === 404 ? 'этого запроса нет на сервере — перезапусти сервер после обновления кода' : res.status >= 500 ? 'сервер упал или перезапускается — подожди минуту и повтори' : 'сервер ответил не JSON';
      throw new Error(`сервер ответил HTTP ${res.status}: ${hint}`);
    }
    const data = await res.json();
    if (data && data.error) throw new Error(data.details ? `${data.error} (${data.details})` : data.error);
    return data;
  }
}
// ttl — сколько миллисекунд ответ считается свежим (расчёты позиций одинаковы для листа, стека и калькулятора; 0 — не кэшировать)
export async function apiGet(path, params, { ttl = 0 } = {}) {
  const qs = params instanceof URLSearchParams ? params : new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]));
  qs.sort();
  const url = `${path}?${qs}`;
  if (ttl > 0) {
    const hit = apiCache.get(url);
    if (hit && Date.now() - hit.ts < ttl) return hit.promise;
    const promise = request(url);
    apiCache.set(url, { ts: Date.now(), promise });
    promise.catch(() => { if (apiCache.get(url) && apiCache.get(url).promise === promise) apiCache.delete(url); });
    return promise;
  }
  return request(url);
}
export async function apiPost(path, body) {
  await takeSlot();
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (path.includes('manual-price')) clearApiCache();                    // вписанная цена меняет расчёты — кэш недействителен
  return res.json().catch(() => ({}));
}

// ---------- справочники (предметы и группы оружия) ----------
// Без них у предметов нет названий, а список категорий пуст, поэтому грузим через общий слой запросов: при «слишком много запросов» он ждёт и повторяет.
// Статус — в refStore: если справочник так и не загрузился, страница показывает предупреждение с кнопкой «Повторить», а не молча остаётся пустой.
export const refStore = createStore({ items: 'loading', groups: 'loading', error: '' });
const loadRef = (key, path, apply) => apiGet(path, {})
  .then((d) => { apply(d); refStore.set({ [key]: 'ok' }); })
  .catch((err) => { refStore.set({ [key]: 'failed', error: err.message }); });
const loadItems = () => loadRef('items', '/api/items', (items) => { itemsById = new Map(items.map((i) => [i.id, i])); });
const loadGroups = () => loadRef('groups', '/api/item-groups', (d) => { weaponGroups = d.weapon || []; });
export const itemsReady = loadItems();
export const groupsReady = loadGroups();
export const reloadReference = () => { refStore.set({ items: 'loading', groups: 'loading', error: '' }); return Promise.all([loadItems(), loadGroups()]); };

// ---------- буфер обмена ----------
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    ta.remove();
    return ok;
  }
}
