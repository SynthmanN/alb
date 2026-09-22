// Скан маржи и ликвидности: весь гир × зачарование × качество по данным кувшина. Строка раскрывается на месте: детали, количество, «в крафт-лист»,
// «открыть в калькуляторе». Результат хранится в памяти — переключение вкладок его не сбрасывает.
import { html, createStore, useStore, useState, fmt, signed, apiGet, findItem, itemLabel, itemTier, fmtAge } from './lib.js';
import { commonParams, settings } from './settings.js';
import { meta } from './params.js';
import { Glyph, Tags, CityPill, CityPills, Seg, Switch, Icon, ICONS, Spinner } from './ui.js';
import { addToList } from './list.js';
import { nav } from './nav.js';

export const scanStore = createStore({ mode: 'patient', category: 'all', minDaily: 3, after: true, data: null, loading: false, error: '', sort: { k: 'marketProfitPerDay', dir: -1 }, open: null });

export async function runScan() {
  const sc = scanStore.get();
  scanStore.set({ loading: true, error: '' });
  try {
    const params = { ...commonParams(), mode: sc.mode, category: sc.category, enchantMode: sc.after ? 'auto' : 'direct', liquidity: 'sum', minDaily: sc.minDaily || 0 };
    const data = await apiGet('/api/unified-scan', params);
    if (data.jug && data.jug.lastPricePass) meta.set({ jugAt: data.jug.lastPricePass });
    scanStore.set({ data, loading: false, open: null });
  } catch (err) {
    scanStore.set({ loading: false, error: err.message });
  }
}

const COLS = [['name', 'Предмет', ''], ['cost', 'Себестоимость → продажа', 'r hide-n'], ['profitPerUnit', 'Профит с штуки', 'r'], ['marketProfitPerDay', 'Маржа рынка в день', 'r hide-n']];
// чары после крафта у строки: сервер помечает её сам (режим auto — только там, где выгоднее прямого на 7%); старые ответы — по режиму скана
const isAfter = (r, data) => (r.after !== undefined ? !!r.after && r.enchant > 0 : data.enchantMode === 'after' && r.enchant > 0);
const rowKey = (r) => `${r.itemId}|${r.enchant}|${r.quality}`;

function sortRows(rows, { k, dir }) {
  const val = (r) => (k === 'name' ? itemLabel(r.itemId) : r[k]);
  return [...rows].sort((a, b) => {
    const x = val(a); const y = val(b);
    return (typeof x === 'string' ? x.localeCompare(y, 'ru') : (x ?? -Infinity) - (y ?? -Infinity)) * dir;
  });
}

function Detail({ r, data }) {
  const [qty, setQty] = useState(10);
  const net = r.cost + r.profitPerUnit;
  const stale = r.freshMinutes !== null && r.freshMinutes !== undefined && r.freshMinutes > 180;
  const add = () => addToList({ itemId: r.itemId, enchant: r.enchant, quality: r.quality, quantity: qty, cost: r.cost, profit: r.profitPerUnit, after: isAfter(r, data) });
  const open = () => nav.openCalc({ itemId: r.itemId, enchant: r.enchant, quality: r.quality, quantity: qty, after: isAfter(r, data) });
  return html`<div class="detail">
    <div class="k"><span>Себестоимость</span><b class="neg">${fmt(r.cost)}</b></div>
    <div class="k"><span>Продажа после налога</span><b>${fmt(net)}</b></div>
    <div class="k"><span>Оборот в день</span><b>${fmt(r.dailyVolume, 1)}</b></div>
    <div class="k"><span>Города продажи</span><${CityPills} list=${r.sellCities || []} max=${2} /></div>
    <div class="k"><span>Свежесть цен</span><b class=${stale ? 'fresh-old' : ''}>${fmtAge(r.freshMinutes)}</b></div>
    <div class="dextra">
      ${r.blackMarket ? html`<div class="note">⚫ Продажа через Чёрный Рынок: налог ${fmt((r.sellTaxRate || 0) * 100, 1)}% (налог + Setup Fee всегда).</div>` : null}
      ${r.dataAgeDays !== null && r.dataAgeDays !== undefined && r.dataAgeDays >= 2 ? html`<div class="scan-stale" title="Последняя сделка в городах продажи была давно — оборот считан по старым данным">Данные устарели на ${fmt(r.dataAgeDays, 1)} дн.</div>` : null}
      ${r.filledCities ? html`<div class="scan-stale" title="В окне скана в этих городах сделок нет — взят средний оборот прошлых дней (до 10 дней)">${r.filledCities} г. — оборот из прошлых дней</div>` : null}
      ${r.refined && r.refined.length ? html`<div class="refine-source" title=${r.refined.map((m) => `${itemLabel(m.id)}: ${m.crafted ? 'скрафтить самому' : `переработать в ${m.city}`} — ${fmt(m.price)} вместо ${fmt(m.buyPrice)}`).join('; ')}>${[r.refined.some((m) => !m.crafted) ? `♻ переработка: ${r.refined.filter((m) => !m.crafted).length}` : '', r.refined.some((m) => m.crafted) ? `🔨 плащ самому: ${r.refined.filter((m) => m.crafted).length}` : ''].filter(Boolean).join(' · ')}</div>` : null}
      ${r.confidence !== undefined ? html`<div class="muted" style="font-size:13px" title="Доверие — по числу разных часов, в которые торговались материалы (слабое звено)">Доверие ${Math.round(r.confidence * 100)}%${r.tradeHours ? ` · ${r.tradeHours} ч торговли` : ''}</div>` : null}
      ${r.byCity && r.byCity.length > 1 ? html`<details class="city-prices" open><summary>Оборот по городам</summary><ul class="bycity">${r.byCity.map((x) => html`<li key=${x.city} class=${x.inPlan ? '' : 'city-out'}><${CityPill} name=${x.city} /> ${fmt(x.dailyVolume, 1)}/день · цена ${fmt(x.avgPrice)} <small>${x.inPlan ? 'в расчёте' : 'вне расчёта'}</small>${x.filled ? html` <small class="scan-stale">за прошлые дни</small>` : null}</li>`)}</ul></details>` : null}
    </div>
    <div class="dactions">
      <div class="qty"><button type="button" aria-label="Меньше" onClick=${() => setQty(Math.max(1, qty - 1))}>−</button><input type="number" min="1" value=${qty} onInput=${(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))} aria-label="Количество" /><button type="button" aria-label="Больше" onClick=${() => setQty(qty + 1)}>+</button></div>
      <button class="btn primary sm" type="button" onClick=${add}>В крафт-лист</button>
      <button class="btn sm" type="button" onClick=${open}>Открыть в калькуляторе →</button>
    </div></div>`;
}

export function ScanTab() {
  const sc = useStore(scanStore);
  const set = (p) => scanStore.set(p);
  const { data } = sc;
  const rows = data ? sortRows(data.results, sc.sort) : [];
  const setSort = (k) => set({ sort: { k, dir: sc.sort.k === k ? -sc.sort.dir : (k === 'name' ? 1 : -1) } });
  return html`<section class="panel" id="panel-scan">
    <div class="card filterbox">
      <${Seg} label="Тип продажи" value=${sc.mode} onChange=${(v) => set({ mode: v })} options=${[['patient', 'Терпеливая'], ['instant', 'Мгновенная']]} />
      <label class="f">Категория<select id="s-cat" value=${sc.category} onChange=${(e) => set({ category: e.target.value })}>
        ${[['all', 'Всё'], ['weapon', 'Оружие'], ['armor', 'Броня'], ['cape', 'Плащи']].map(([v, t]) => html`<option value=${v} selected=${sc.category === v}>${t}</option>`)}</select></label>
      <label class="f" style="width:130px">Оборот от, шт/день<input id="s-min" type="number" min="0" step="0.5" value=${sc.minDaily} onInput=${(e) => set({ minDaily: e.target.value })} /></label>
      <${Switch} checked=${sc.after} onChange=${(v) => set({ after: v })} title="Чары после крафта («плащ .0 + руны, души, реликты») считаются только там, где они выгоднее прямого крафта не меньше чем на 7% профита; остальной гир — прямым крафтом">Зачарка после крафта</${Switch}>
    </div>
    <div class="runbox">
      <button class="btn primary big" id="scan-run" type="button" disabled=${sc.loading} onClick=${runScan}>${sc.loading ? html`<${Spinner} />Считаю…` : html`<${Icon} d=${ICONS.search} />${data ? 'Обновить скан' : 'Сканировать'}`}</button>
      <span class="muted" style="font-size:13px" id="scan-note">${data ? `Найдено ${data.results.length} · клик по заголовку — сортировка · клик по строке — подробности` : 'Скан просматривает весь гир, зачарование и качество и ставит наверх самое выгодное'}</span>
    </div>
    ${sc.error ? html`<div class="card err" role="alert">Ошибка: ${sc.error}</div>` : null}
    ${data && rows.length === 0 ? html`<div class="card empty">Ничего не нашлось. Попробуй снизить «Оборот от» или сменить тип продажи.</div>` : null}
    ${rows.length ? html`<div class="headrow" id="scan-head">${COLS.map(([k, label, c]) => html`<button type="button" key=${k} class=${c} aria-sort=${sc.sort.k === k ? (sc.sort.dir < 0 ? 'descending' : 'ascending') : null} onClick=${() => setSort(k)}>${label}${sc.sort.k === k ? (sc.sort.dir < 0 ? ' ↓' : ' ↑') : ''}</button>`)}<span></span></div>
      <div class="rows" id="scan-rows">${rows.map((r) => {
        const key = rowKey(r);
        const isOpen = sc.open === key;
        const it = findItem(r.itemId);
        return html`<div key=${key}>
          <div class=${`row ${isOpen ? 'open' : ''}`} onClick=${() => set({ open: isOpen ? null : key })} role="button" tabindex="0" onKeyDown=${(e) => { if (e.key === 'Enter') set({ open: isOpen ? null : key }); }}>
            <div class="it"><${Glyph} id=${r.itemId} tier=${r.tier || itemTier(r.itemId)} enchant=${r.enchant} quality=${r.quality} /><div style="min-width:0"><b>${itemLabel(r.itemId)}</b><${Tags} tier=${r.tier || itemTier(r.itemId)} enchant=${r.enchant} quality=${r.quality} />${isAfter(r, data) ? html` <span class="pill n" title="Выгоднее прямого крафта: плащ .0 + руны, души, реликты (не меньше чем на 7% профита)">чары после крафта</span>` : null}</div></div>
            <div class="cell r hide-n"><span class="neg">${fmt(r.cost)}</span> <span class="muted">→</span> ${fmt(r.cost + r.profitPerUnit)}<small>расходы → доход</small></div>
            <div class="cell r"><b class="pos">${signed(r.profitPerUnit)}</b><small>${fmt(r.profitPct, 0)}% к вложениям</small></div>
            <div class="cell r hide-n"><b>${fmt(r.marketProfitPerDay)}</b><small>${fmt(r.dailyVolume, 0)} шт/день</small></div>
            <div><button class="btn sm" type="button" title="В крафт-лист" aria-label="В крафт-лист" onClick=${(e) => { e.stopPropagation(); addToList({ itemId: r.itemId, enchant: r.enchant, quality: r.quality, quantity: 1, cost: r.cost, profit: r.profitPerUnit, after: isAfter(r, data) }); }}>+</button></div>
          </div>
          ${isOpen ? html`<${Detail} r=${r} data=${data} />` : null}</div>`;
      })}</div>` : null}
  </section>`;
}
