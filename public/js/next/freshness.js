// «Свежесть данных»: окно со списком материалов и самого предмета для позиций крафт-листа, стека калькулятора или фракционного
// плана — что устарело (старше порога) или совсем без цены. Мысль: краулер обновляет всё по расписанию, а AODP далеко не всегда
// знает редкие вещи (гербы фракций, авантюрный гир, тонко торгуемые полуфабрикаты) — вместо того чтобы гадать, идёшь в игру,
// открываешь эти предметы на рынке (клиент AODP их считает) и жмёшь «Обновить» — сайт тянет настоящие свежие данные с AODP прямо
// сейчас, не дожидаясь своего часа. Компонент не знает, откуда взялись id — их собирает вызывающая сторона (logic/freshness.js),
// вместе с качеством — самого предмета (гира), у материалов оно всегда 1.
// Список сгруппирован ПО ГОРОДАМ (сервер отдаёт возраст отдельно на каждый город, не «лучший из всех»): так сразу видно, в каком
// городе что открыть на рынке в игре, а не только «что-то где-то устарело».
import { html, useState, createStore, useStore, fmtDays, apiGet, apiPost, copyText, auctionName } from './lib.js';
import { Icon, ICONS, Spinner, toast, MaterialName, CityPill } from './ui.js';
import { Select } from './params.js';

const STALE_PRESETS = [[1, '1 день'], [3, '3 дня'], [7, '7 дней']];   // те же числа, что у «Истории гира» в параметрах — знакомый выбор
const REFRESH_CHUNK = 60; // сервер режет запрос на обновление до 60 id за раз — при большем количестве бьём на порции сами
const MANUAL_SAVE_DELAY = 700;   // как и вписанные цены фракционного плана (faction.js) — не долбим сервер на каждый символ

// staleDays — свой порог «устарело» (пресет или вписанный текстом: 12ч/2д), запоминается в браузере между сессиями.
// names — Map(id → {name, quality}): quality нужен и для запроса свежести (материалы всегда 1, гир — своё), и для вписанной цены.
export const freshnessStore = createStore({ open: false, onRefreshed: null, items: [], cities: [], names: new Map(), loading: false, error: '', refreshingId: null, refreshingAll: false, staleDays: 3 },
  { key: 'albion_next_freshness', pick: (s) => ({ staleDays: s.staleDays }) });

const qualityOf = (id) => { const s = freshnessStore.get(); const it = s.names.get(id); return (it && it.quality) || 1; };

async function load() {
  const s0 = freshnessStore.get();
  const ids = [...s0.names.keys()];
  try {
    const data = await apiGet('/api/freshness', { ids: ids.join(','), qualities: ids.map(qualityOf).join(','), staleDays: s0.staleDays });
    if (!freshnessStore.get().open) return;                 // окно закрыли, пока грузилось — ответ не нужен
    freshnessStore.set({ items: data.items, cities: data.cities, loading: false, staleDays: data.staleDays });   // сервер мог обрезать порог до границ 1ч–30д
  } catch (err) {
    freshnessStore.set({ loading: false, error: err.message });
  }
}
// named — Map(id → {name, quality}): logic/freshness.js (collectAllIds — крафт-лист/стек, collectFactionIds — фракционный план).
// onRefreshed — что сделать после обновления, чтобы список/план перестал показывать старые цифры (см. invalidateDef ниже).
export function openFreshness(named, onRefreshed) {
  freshnessStore.set({ open: true, onRefreshed: onRefreshed || null, names: named, items: [], cities: [], loading: true, error: '' });
  load();
}
export const closeFreshness = () => freshnessStore.set({ open: false });
// Смена порога, пока окно открыто, сразу перепроверяет тот же список с новым порогом — как «вписанная цена мгновенно пересчитывает» везде на сайте
export function setStaleDays(v) {
  freshnessStore.set({ staleDays: v });
  const s = freshnessStore.get();
  if (s.open && s.names.size) { freshnessStore.set({ loading: true, error: '' }); load(); }
}

// Крафт-лист и стек калькулятора считают позиции сами (def = listDef/stackDef из listcalc.js) — обновлённые материалы для них
// нужно пересчитать явно, иначе старые цифры провисят до истечения кэша. У фракционного плана явного def нет: он использует
// свой onRefreshed напрямую (faction.js — сброс sig, чтобы перезапросить /api/faction-plan заново).
export const invalidateDef = (def) => { for (const it of def.ops.store.get().items) def.engine.invalidate(it.uid); };

function afterRefresh() { const cb = freshnessStore.get().onRefreshed; if (cb) cb(); }
function mergeItems(items) {
  const byId = new Map(items.map((x) => [x.id, x]));
  freshnessStore.set((s) => ({ items: s.items.map((x) => byId.get(x.id) || x) }));
}
async function applyRefresh(ids) {
  const qualities = Object.fromEntries(ids.map((id) => [id, qualityOf(id)]));
  const data = await apiPost('/api/freshness/refresh', { ids, qualities, staleDays: freshnessStore.get().staleDays });
  mergeItems(data.items);
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

// Своя цена — когда нет возможности отсканировать рынок клиентом AODP (например, играя с телефона): такой же полноценный сигнал
// свежести на сервере (freshnessOf учитывает её наравне с ценой и историей), одна на предмет — сразу на все его города, как и
// вписанные цены герба/сердца фракции (та же таблица manual_prices, тот же /api/manual-price).
const manualTimers = new Map();
async function saveManualPrice(id, price) {
  const quality = qualityOf(id);
  try {
    await apiPost('/api/manual-price', { id, quality, price });
    const data = await apiGet('/api/freshness', { ids: id, qualities: quality, staleDays: freshnessStore.get().staleDays });
    mergeItems(data.items);
    afterRefresh();
  } catch (err) {
    toast(`Не удалось сохранить цену: ${err.message}`);
  }
}
export function setManualPrice(id, raw) {
  clearTimeout(manualTimers.get(id));
  const v = parseFloat(raw);
  const price = Number.isFinite(v) && v >= 0 ? v : 0;
  manualTimers.set(id, setTimeout(() => saveManualPrice(id, price), MANUAL_SAVE_DELAY));
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
      if (c && c.stale) rows.push({ id: it.id, name: (s.names.get(it.id) || {}).name || it.id, c, manual: it.manual });
    }
    if (rows.length) groups.push({ city, rows });
  }
  return groups;
}

// Ключ на подтверждённой с сервера цене — при её смене (сохранили/убрали) поле переинициализируется свежим значением;
// пока идёт печать (сервер ещё не подтвердил), ключ не меняется — не сбивает то, что человек как раз набирает.
function ManualPriceInput({ id, manual, disabled }) {
  const [text, setText] = useState(String(manual ? manual.price : ''));
  return html`<input key=${manual ? manual.price : 'empty'} class=${`fresh-manual-input ${manual ? 'is-manual' : ''}`} type="number" min="0" step="1" inputmode="numeric"
    placeholder="своя цена" title="Впиши цену вручную — пригодится, если сейчас нет возможности отсканировать рынок клиентом AODP (например, играя с телефона). Действует на все города сразу, как и вписанная цена герба или сердца фракции."
    disabled=${disabled} value=${text} onInput=${(e) => { setText(e.target.value); setManualPrice(id, e.target.value); }} />`;
}

// Кнопка-триггер: ids — уже собранный Map(id → {name, quality}) через collectAllIds/collectFactionIds; пусто — кнопки нет
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
      <p class="note" style="margin:10px 22px 14px">По городам — что открыть на рынке в игре: нет цены или сделки свежее ${fmtDays(s.staleDays)}. Клик по названию — скопировать для поиска на аукционе, поле справа — своя цена, если сканировать нечем.</p>
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
                  <${ManualPriceInput} id=${r.id} manual=${r.manual} disabled=${s.refreshingId === r.id || s.refreshingAll} />
                  <button class="btn sm" type="button" disabled=${s.refreshingId === r.id || s.refreshingAll} onClick=${() => refreshOne(r.id)}>${s.refreshingId === r.id ? html`<${Spinner} />` : 'Обновить'}</button>
                </div>`)}</div>
            </div>`)}</div>`}
      </div>
      ${anyStale.length > 1 ? html`<div class="modal-foot"><button class="btn primary" type="button" id="freshness-refresh-all" disabled=${s.refreshingAll || !!s.refreshingId} onClick=${refreshAllStale}>${s.refreshingAll ? html`<${Spinner} />Обновляю…` : `Обновить всё (${anyStale.length})`}</button></div>` : null}
    </aside></div>`;
}
