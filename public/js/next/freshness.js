// «Свежесть данных»: окно со списком материалов и самого предмета для позиций крафт-листа, стека калькулятора или фракционного
// плана, где у калькулятора совсем НЕТ данных — ровно то же самое, что показывают «нет данных» в закупке материалов и в плане
// продажи, просто собранное в одном месте по всему, что относится к запланированному крафту. Мысль: AODP знает не про всё
// (авантюрный гир, гербы фракций, тонко торгуемые полуфабрикаты) — вместо того чтобы гадать, идёшь в игру, открываешь эти
// предметы на рынке (клиент AODP их считает) и жмёшь «Обновить» — сайт тянет настоящие данные с AODP прямо сейчас, либо
// вписываешь свою цену вручную, если сканировать нечем. Компонент не знает, откуда взялись id — их собирает вызывающая
// сторона (logic/freshness.js), вместе с качеством и kind ('self' — сам предмет, 'material' — всё остальное).
// Порога «устарело» нет: сканированием чинится только отсутствие данных, а не их возраст (сделку задним числом не создать) —
// список идёт от тех же окон «История сырья»/«История гира», что стоят в панели параметров сейчас.
import { html, useState, createStore, useStore, apiGet, apiPost, copyText, auctionName, CITY_CLS } from './lib.js';
import { Icon, ICONS, Spinner, toast, MaterialName, CityPill } from './ui.js';
import { settings, ALL_CITIES } from './settings.js';

const REFRESH_CHUNK = 60; // сервер режет запрос на обновление до 60 id за раз — при большем количестве бьём на порции сами
const MANUAL_SAVE_DELAY = 700;   // как и вписанные цены фракционного плана (faction.js) — не долбим сервер на каждый символ

// names — Map(id → {name, quality, kind}); enabledCities — какие города вообще проверять (свой выбор для этого окна,
// отдельно от «активных городов» сайта — те решают, что входит в расчёт профита, тут — что вообще смотреть на нехватку данных).
export const freshnessStore = createStore({ open: false, onRefreshed: null, items: [], cities: [], names: new Map(), loading: false, error: '', refreshingId: null, refreshingAll: false, enabledCities: ALL_CITIES.slice() },
  { key: 'albion_next_freshness', pick: (s) => ({ enabledCities: s.enabledCities }) });

const qualityOf = (id) => { const it = freshnessStore.get().names.get(id); return (it && it.quality) || 1; };
const kindOf = (id) => { const it = freshnessStore.get().names.get(id); return (it && it.kind) === 'self' ? 'self' : 'material'; };

async function load() {
  const s0 = freshnessStore.get();
  const ids = [...s0.names.keys()];
  const st = settings.get();
  try {
    const data = await apiGet('/api/freshness', {
      ids: ids.join(','), qualities: ids.map(qualityOf).join(','), kinds: ids.map(kindOf).join(','),
      cities: s0.enabledCities.join(','), materialHours: st.mhist, days: st.hist,
    });
    if (!freshnessStore.get().open) return;                 // окно закрыли, пока грузилось — ответ не нужен
    freshnessStore.set({ items: data.items, cities: data.cities, loading: false });
  } catch (err) {
    freshnessStore.set({ loading: false, error: err.message });
  }
}
// named — Map(id → {name, quality, kind}): logic/freshness.js (collectAllIds — крафт-лист/стек, collectFactionIds — фракционный план).
// onRefreshed — что сделать после обновления, чтобы список/план перестал показывать старые цифры (см. invalidateDef ниже).
export function openFreshness(named, onRefreshed) {
  freshnessStore.set({ open: true, onRefreshed: onRefreshed || null, names: named, items: [], cities: [], loading: true, error: '' });
  load();
}
export const closeFreshness = () => freshnessStore.set({ open: false });
// Включить/выключить город прямо в окне — свой список, не общие «активные города» сайта. Хотя бы один город должен остаться
// включённым (пустой список городов сервер принял бы за «умолчание — все семь», а не за «ни одного»).
export function toggleCity(city) {
  const s = freshnessStore.get();
  const on = s.enabledCities.includes(city);
  if (on && s.enabledCities.length <= 1) return;
  const enabledCities = on ? s.enabledCities.filter((c) => c !== city) : [...s.enabledCities, city];
  freshnessStore.set({ enabledCities });
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
  const s = freshnessStore.get();
  const st = settings.get();
  const qualities = Object.fromEntries(ids.map((id) => [id, qualityOf(id)]));
  const kinds = Object.fromEntries(ids.map((id) => [id, kindOf(id)]));
  const data = await apiPost('/api/freshness/refresh', { ids, qualities, kinds, cities: s.enabledCities, materialHours: st.mhist, days: st.hist });
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

// Своя цена — когда нет возможности отсканировать рынок клиентом AODP (например, играя с телефона): такие же полноценные
// данные для калькулятора, как и рыночные (freshnessOf на сервере учитывает её наравне с котировкой/сделкой), одна на
// предмет — сразу на все его города, как и вписанные цены герба/сердца фракции (та же таблица manual_prices, тот же /api/manual-price).
const manualTimers = new Map();
async function saveManualPrice(id, price) {
  const quality = qualityOf(id);
  try {
    await apiPost('/api/manual-price', { id, quality, price });
    const s = freshnessStore.get();
    const st = settings.get();
    const data = await apiGet('/api/freshness', { ids: id, qualities: quality, kinds: kindOf(id), cities: s.enabledCities.join(','), materialHours: st.mhist, days: st.hist });
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

const copyItemName = (name) => copyText(auctionName(name)).then((ok) => toast(ok ? `Скопировано: ${auctionName(name)}` : 'Не удалось скопировать'));

// Разворачивает плоский список позиций в «город → что в нём нет данных» — по порядку городов, как отдал сервер;
// город без единой такой позиции не показываем (нечего там делать).
function byCityGroups(s) {
  const groups = [];
  for (const city of s.cities) {
    const rows = [];
    for (const it of s.items) {
      const c = it.byCity[city];
      if (c && c.stale) {
        const named = s.names.get(it.id) || {};
        // качество показываем только у самого предмета — у материалов оно всегда 1 (сайт торгует ими по Обычному),
        // тег «Обычное» на каждой строке материала был бы только шумом, не информацией.
        const quality = named.kind === 'self' ? it.quality : 0;
        rows.push({ id: it.id, name: named.name || it.id, quality, manual: it.manual });
      }
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

// Кнопка-триггер: ids — уже собранный Map(id → {name, quality, kind}) через collectAllIds/collectFactionIds; пусто — кнопки нет
export function FreshnessButton({ ids, onRefreshed }) {
  if (!ids || !ids.size) return null;
  return html`<button class="btn" type="button" id="freshness-open" onClick=${() => openFreshness(ids, onRefreshed)} title="Где у калькулятора совсем нет данных — по городам, среди материалов и предметов в этом списке"><${Icon} d=${ICONS.refresh} />Свежесть данных</button>`;
}

export function FreshnessDialog() {
  const s = useStore(freshnessStore);
  if (!s.open) return null;
  const anyStale = s.items.filter((x) => x.stale);
  const groups = s.loading || s.error ? [] : byCityGroups(s);
  return html`<div class="scrim modal-scrim fresh-scrim" onClick=${closeFreshness}>
    <aside class="modal modal-wide" id="freshness-dialog" role="dialog" aria-label="Свежесть данных" onClick=${(e) => e.stopPropagation()}>
      <header><h3>Свежесть данных</h3><button class="btn sm" type="button" onClick=${closeFreshness}>Закрыть</button></header>
      <div class="fresh-toggles">${ALL_CITIES.map((city) => html`<button key=${city} type="button" class=${`city ${CITY_CLS[city] || ''} ${s.enabledCities.includes(city) ? '' : 'off'}`} aria-pressed=${String(s.enabledCities.includes(city))} title=${s.enabledCities.includes(city) ? 'Проверять этот город' : 'Не проверять этот город'} onClick=${() => toggleCity(city)}>${city}</button>`)}</div>
      <p class="note" style="margin:8px 22px 14px">По городам — где у калькулятора совсем нет данных для расчёта (столько же, сколько в «Истории сырья»/«Истории гира» в параметрах). Клик по названию — скопировать для поиска на аукционе, поле справа — своя цена, если сканировать нечем.</p>
      <div class="scroll">
        ${s.loading ? html`<div class="empty"><${Spinner} />Проверяю…</div>`
          : s.error ? html`<div class="card err" role="alert">Ошибка: ${s.error}</div>`
          : !s.items.length ? html`<div class="empty">Нечего проверять — список пуст.</div>`
          : !groups.length ? html`<div class="empty">Данные есть везде — обновлять нечего.</div>`
          : html`<div class="fresh-cities">${groups.map((g) => html`<div class="fresh-city" key=${g.city} data-city=${g.city}>
              <div class="fresh-city-head"><${CityPill} name=${g.city} /><span class="cp-count">${g.rows.length}</span></div>
              <div class="fresh-list">${g.rows.map((r) => html`<div class="fresh-row" key=${r.id} data-id=${r.id}>
                  <${MaterialName} id=${r.id} name=${r.name} quality=${r.quality} onCopy=${() => copyItemName(r.name)} />
                  <div class="fresh-actions">
                    <${ManualPriceInput} id=${r.id} manual=${r.manual} disabled=${s.refreshingId === r.id || s.refreshingAll} />
                    <button class="btn sm" type="button" disabled=${s.refreshingId === r.id || s.refreshingAll} onClick=${() => refreshOne(r.id)}>${s.refreshingId === r.id ? html`<${Spinner} />` : 'Обновить'}</button>
                  </div>
                </div>`)}</div>
            </div>`)}</div>`}
      </div>
      ${anyStale.length > 1 ? html`<div class="modal-foot"><button class="btn primary" type="button" id="freshness-refresh-all" disabled=${s.refreshingAll || !!s.refreshingId} onClick=${refreshAllStale}>${s.refreshingAll ? html`<${Spinner} />Обновляю…` : `Обновить всё (${anyStale.length})`}</button></div>` : null}
    </aside></div>`;
}
