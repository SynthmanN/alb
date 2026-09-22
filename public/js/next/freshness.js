// «Свежесть данных»: окно со списком материалов и самого предмета для всех позиций листа/стека — что устарело (старше 3 дней)
// или совсем без цены. Мысль: краулер обновляет всё по расписанию, а AODP далеко не всегда знает редкие вещи (гербы фракций,
// авантюрный гир, тонко торгуемые полуфабрикаты) — вместо того чтобы гадать, идёшь в игру, открываешь эти предметы на рынке
// (клиент AODP их считает) и жмёшь «Обновить» — сайт тянет настоящие свежие данные с AODP прямо сейчас, не дожидаясь своего часа.
import { html, createStore, useStore, fmt, fmtDays, apiGet, apiPost } from './lib.js';
import { collectAllIds } from './logic/freshness.js';
import { Icon, ICONS, Spinner, toast } from './ui.js';

const STALE_DAYS = 3; // как на сервере (FRESHNESS_STALE_DAYS) — только для подписи, решение «устарело» всегда приходит с сервера
const REFRESH_CHUNK = 60; // сервер режет запрос на обновление до 60 id за раз — при большем количестве бьём на порции сами

export const freshnessStore = createStore({ open: false, def: null, items: [], names: new Map(), loading: false, error: '', refreshingId: null, refreshingAll: false });

async function load(ids) {
  try {
    const data = await apiGet('/api/freshness', { ids: [...ids].join(',') });
    if (!freshnessStore.get().open) return;                 // окно закрыли, пока грузилось — ответ не нужен
    freshnessStore.set({ items: data.items, loading: false });
  } catch (err) {
    freshnessStore.set({ loading: false, error: err.message });
  }
}
// def — { ops, engine } крафт-листа или стека калькулятора (listDef/stackDef); results — уже посчитанные позиции (data.results из useStackData)
export function openFreshness(def, results) {
  const named = collectAllIds(results);
  freshnessStore.set({ open: true, def, names: named, items: [], loading: true, error: '' });
  load(named.keys());
}
export const closeFreshness = () => freshnessStore.set({ open: false });

// Материалы обновились — старые посчитанные позиции листа/стека держат прежние цены, пока их не пересчитать заново
function invalidateAll() {
  const def = freshnessStore.get().def;
  if (!def) return;
  for (const it of def.ops.store.get().items) def.engine.invalidate(it.uid);
}
async function applyRefresh(ids) {
  const data = await apiPost('/api/freshness/refresh', { ids });
  const byId = new Map(data.items.map((x) => [x.id, x]));
  freshnessStore.set((s) => ({ items: s.items.map((x) => byId.get(x.id) || x) }));
}
export async function refreshOne(id) {
  freshnessStore.set({ refreshingId: id });
  try { await applyRefresh([id]); invalidateAll(); } catch (err) { toast(`Не удалось обновить: ${err.message}`); }
  freshnessStore.set({ refreshingId: null });
}
export async function refreshAllStale() {
  const ids = freshnessStore.get().items.filter((x) => x.stale).map((x) => x.id);
  if (!ids.length) return;
  freshnessStore.set({ refreshingAll: true });
  try {
    for (let i = 0; i < ids.length; i += REFRESH_CHUNK) await applyRefresh(ids.slice(i, i + REFRESH_CHUNK));  // порции — прогресс виден по ходу
    invalidateAll();
  } catch (err) {
    toast(`Не удалось обновить: ${err.message}`);
  }
  freshnessStore.set({ refreshingAll: false });
}

const ageLabel = (x) => {
  if (x.priceAgeMinutes === null && x.historyAgeDays === null) return 'нет данных';
  const days = Math.min(x.priceAgeMinutes === null ? Infinity : x.priceAgeMinutes / 1440, x.historyAgeDays === null ? Infinity : x.historyAgeDays);
  return `обновлялось ${fmtDays(days)} назад`;
};

// Кнопка-триггер: сколько позиций нужно проверить, открывает окно. results — Map(uid → ответ /api/craft-calc) уже посчитанных позиций
export function FreshnessButton({ def, results }) {
  const count = collectAllIds(results).size;
  if (!count) return null;
  return html`<button class="btn" type="button" id="freshness-open" onClick=${() => openFreshness(def, results)} title="Что устарело или совсем без цены — среди материалов и предметов в этом списке"><${Icon} d=${ICONS.refresh} />Свежесть данных</button>`;
}

export function FreshnessDialog() {
  const s = useStore(freshnessStore);
  if (!s.open) return null;
  const stale = s.items.filter((x) => x.stale);
  return html`<div class="scrim modal-scrim" onClick=${closeFreshness}>
    <aside class="modal" id="freshness-dialog" role="dialog" aria-label="Свежесть данных" onClick=${(e) => e.stopPropagation()}>
      <header><h3>Свежесть данных</h3><button class="btn sm" type="button" onClick=${closeFreshness}>Закрыть</button></header>
      <p class="note" style="margin:0 22px 14px">Материалы и предметы этого списка, у которых нет цены или сделки свежее ${STALE_DAYS} дн. Открой их на рынке в игре (клиент AODP их посчитает) и обнови здесь.</p>
      <div class="scroll">
        ${s.loading ? html`<div class="empty"><${Spinner} />Проверяю…</div>`
          : s.error ? html`<div class="card err" role="alert">Ошибка: ${s.error}</div>`
          : !s.items.length ? html`<div class="empty">Нечего проверять — список пуст.</div>`
          : !stale.length ? html`<div class="empty">Всё свежее — обновлять нечего.</div>`
          : html`<div class="fresh-list">${stale.map((x) => html`<div class="fresh-row" key=${x.id} data-id=${x.id}>
              <div class="fresh-name">${s.names.get(x.id) || x.id}</div>
              <div class="fresh-age muted">${ageLabel(x)}</div>
              <button class="btn sm" type="button" disabled=${s.refreshingId === x.id || s.refreshingAll} onClick=${() => refreshOne(x.id)}>${s.refreshingId === x.id ? html`<${Spinner} />` : 'Обновить'}</button>
            </div>`)}</div>`}
      </div>
      ${stale.length > 1 ? html`<div class="modal-foot"><button class="btn primary" type="button" id="freshness-refresh-all" disabled=${s.refreshingAll || !!s.refreshingId} onClick=${refreshAllStale}>${s.refreshingAll ? html`<${Spinner} />Обновляю…` : `Обновить всё (${stale.length})`}</button></div>` : null}
    </aside></div>`;
}
