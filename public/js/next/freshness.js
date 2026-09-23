// «Свежесть данных»: окно со списком материалов и самого предмета для позиций крафт-листа, стека калькулятора или фракционного
// плана — что устарело (старше порога) или совсем без цены. Мысль: краулер обновляет всё по расписанию, а AODP далеко не всегда
// знает редкие вещи (гербы фракций, авантюрный гир, тонко торгуемые полуфабрикаты) — вместо того чтобы гадать, идёшь в игру,
// открываешь эти предметы на рынке (клиент AODP их считает) и жмёшь «Обновить» — сайт тянет настоящие свежие данные с AODP прямо
// сейчас, не дожидаясь своего часа. Компонент не знает, откуда взялись id — их собирает вызывающая сторона (logic/freshness.js).
// Список сгруппирован ПО ГОРОДАМ (сервер отдаёт возраст отдельно на каждый город, не «лучший из всех»): так сразу видно, в каком
// городе что открыть на рынке в игре, а не только «что-то где-то устарело».
import { html, createStore, useStore, fmtDays, apiGet, apiPost, copyText, auctionName } from './lib.js';
import { Icon, ICONS, Spinner, toast, MaterialName, CityPill } from './ui.js';
import { Select } from './params.js';

const STALE_PRESETS = [[1, '1 день'], [3, '3 дня'], [7, '7 дней']];   // те же числа, что у «Истории гира» в параметрах — знакомый выбор
const REFRESH_CHUNK = 60; // сервер режет запрос на обновление до 60 id за раз — при большем количестве бьём на порции сами

// staleDays — свой порог «устарело» (пресет или вписанный текстом: 12ч/2д), запоминается в браузере между сессиями
export const freshnessStore = createStore({ open: false, onRefreshed: null, items: [], cities: [], names: new Map(), loading: false, error: '', refreshingId: null, refreshingAll: false, staleDays: 3 },
  { key: 'albion_next_freshness', pick: (s) => ({ staleDays: s.staleDays }) });

async function load(ids) {
  try {
    const data = await apiGet('/api/freshness', { ids: [...ids].join(','), staleDays: freshnessStore.get().staleDays });
    if (!freshnessStore.get().open) return;                 // окно закрыли, пока грузилось — ответ не нужен
    freshnessStore.set({ items: data.items, cities: data.cities, loading: false, staleDays: data.staleDays });   // сервер мог обрезать порог до границ 1ч–30д
  } catch (err) {
    freshnessStore.set({ loading: false, error: err.message });
  }
}
// named — Map(id → название): logic/freshness.js (collectAllIds — крафт-лист/стек, collectFactionIds — фракционный план).
// onRefreshed — что сделать после обновления, чтобы список/план перестал показывать старые цифры (см. invalidateDef ниже).
export function openFreshness(named, onRefreshed) {
  freshnessStore.set({ open: true, onRefreshed: onRefreshed || null, names: named, items: [], cities: [], loading: true, error: '' });
  load(named.keys());
}
export const closeFreshness = () => freshnessStore.set({ open: false });
// Смена порога, пока окно открыто, сразу перепроверяет тот же список с новым порогом — как «вписанная цена мгновенно пересчитывает» везде на сайте
export function setStaleDays(v) {
  freshnessStore.set({ staleDays: v });
  const s = freshnessStore.get();
  if (s.open && s.names.size) { freshnessStore.set({ loading: true, error: '' }); load(s.names.keys()); }
}

// Крафт-лист и стек калькулятора считают позиции сами (def = listDef/stackDef из listcalc.js) — обновлённые материалы для них
// нужно пересчитать явно, иначе старые цифры провисят до истечения кэша. У фракционного плана явного def нет: он использует
// свой onRefreshed напрямую (faction.js — сброс sig, чтобы перезапросить /api/faction-plan заново).
export const invalidateDef = (def) => { for (const it of def.ops.store.get().items) def.engine.invalidate(it.uid); };

function afterRefresh() { const cb = freshnessStore.get().onRefreshed; if (cb) cb(); }
async function applyRefresh(ids) {
  const data = await apiPost('/api/freshness/refresh', { ids, staleDays: freshnessStore.get().staleDays });
  const byId = new Map(data.items.map((x) => [x.id, x]));
  freshnessStore.set((s) => ({ items: s.items.map((x) => byId.get(x.id) || x) }));
}
export async function refreshOne(id) {
  freshnessStore.set({ refreshingId: id });
  try { await applyRefresh([id]); afterRefresh(); } catch (err) { toast(`Не удалось обновить: ${err.message}`); }
  freshnessStore.set({ refreshingId: null });
}
export async function refreshAllStale() {
  const ids = freshnessStore.get().items.filter((x) => x.stale).map((x) => x.id);
  if (!ids.length) return;
  freshnessStore.set({ refreshingAll: true });
  try {
    for (let i = 0; i < ids.length; i += REFRESH_CHUNK) await applyRefresh(ids.slice(i, i + REFRESH_CHUNK));  // порции — прогресс виден по ходу
    afterRefresh();
  } catch (err) {
    toast(`Не удалось обновить: ${err.message}`);
  }
  freshnessStore.set({ refreshingAll: false });
}

const ageLabel = (c) => {
  if (!c || (c.priceAgeMinutes === null && c.historyAgeDays === null)) return 'нет данных';
  const days = Math.min(c.priceAgeMinutes === null ? Infinity : c.priceAgeMinutes / 1440, c.historyAgeDays === null ? Infinity : c.historyAgeDays);
  return `обновлялось ${fmtDays(days)} назад`;
};
const copyItemName = (name) => copyText(auctionName(name)).then((ok) => toast(ok ? `Скопировано: ${auctionName(name)}` : 'Не удалось скопировать'));

// Разворачивает плоский список позиций в «город → что в нём устарело/без данных» — по порядку городов, как отдал сервер;
// город без единой устаревшей позиции не показываем (нечего там делать).
function byCityGroups(s) {
  const groups = [];
  for (const city of s.cities) {
    const rows = [];
    for (const it of s.items) {
      const c = it.byCity[city];
      if (c && c.stale) rows.push({ id: it.id, name: s.names.get(it.id) || it.id, c });
    }
    if (rows.length) groups.push({ city, rows });
  }
  return groups;
}

// Кнопка-триггер: ids — уже собранный Map(id → название) через collectAllIds/collectFactionIds; пусто — кнопки нет
export function FreshnessButton({ ids, onRefreshed }) {
  if (!ids || !ids.size) return null;
  return html`<button class="btn" type="button" id="freshness-open" onClick=${() => openFreshness(ids, onRefreshed)} title="Что устарело или совсем без цены — по городам, среди материалов и предметов в этом списке"><${Icon} d=${ICONS.refresh} />Свежесть данных</button>`;
}

export function FreshnessDialog() {
  const s = useStore(freshnessStore);
  if (!s.open) return null;
  const anyStale = s.items.filter((x) => x.stale);
  const groups = s.loading || s.error ? [] : byCityGroups(s);
  return html`<div class="scrim modal-scrim" onClick=${closeFreshness}>
    <aside class="modal modal-wide" id="freshness-dialog" role="dialog" aria-label="Свежесть данных" onClick=${(e) => e.stopPropagation()}>
      <header><h3>Свежесть данных</h3><button class="btn sm" type="button" onClick=${closeFreshness}>Закрыть</button></header>
      <div style="padding:2px 22px 0"><${Select} id="freshness-stale" label="Считать устаревшим, если старше" value=${s.staleDays} options=${STALE_PRESETS} onChange=${setStaleDays} kind="days" /></div>
      <p class="note" style="margin:10px 22px 14px">По городам — что открыть на рынке в игре: нет цены или сделки свежее ${fmtDays(s.staleDays)}. Клик по названию — скопировать для поиска на аукционе.</p>
      <div class="scroll">
        ${s.loading ? html`<div class="empty"><${Spinner} />Проверяю…</div>`
          : s.error ? html`<div class="card err" role="alert">Ошибка: ${s.error}</div>`
          : !s.items.length ? html`<div class="empty">Нечего проверять — список пуст.</div>`
          : !groups.length ? html`<div class="empty">Всё свежее — обновлять нечего.</div>`
          : html`<div class="fresh-cities">${groups.map((g) => html`<div class="fresh-city" key=${g.city} data-city=${g.city}>
              <div class="fresh-city-head"><${CityPill} name=${g.city} /><span class="cp-count">${g.rows.length}</span></div>
              <div class="fresh-list">${g.rows.map((r) => html`<div class="fresh-row" key=${r.id} data-id=${r.id}>
                  <${MaterialName} id=${r.id} name=${r.name} onCopy=${() => copyItemName(r.name)} />
                  <div class="fresh-age muted">${ageLabel(r.c)}</div>
                  <button class="btn sm" type="button" disabled=${s.refreshingId === r.id || s.refreshingAll} onClick=${() => refreshOne(r.id)}>${s.refreshingId === r.id ? html`<${Spinner} />` : 'Обновить'}</button>
                </div>`)}</div>
            </div>`)}</div>`}
      </div>
      ${anyStale.length > 1 ? html`<div class="modal-foot"><button class="btn primary" type="button" id="freshness-refresh-all" disabled=${s.refreshingAll || !!s.refreshingId} onClick=${refreshAllStale}>${s.refreshingAll ? html`<${Spinner} />Обновляю…` : `Обновить всё (${anyStale.length})`}</button></div>` : null}
    </aside></div>`;
}
