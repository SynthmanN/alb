// Ленивый крафтер: задаёшь бюджет и стратегию — получаешь готовый план из самых выгодных крафтов по истории торгов.
import { html, createStore, useStore, fmt, signed, tone, apiGet, itemLabel, itemTier, fmtDays } from './lib.js';
import { commonParams, settings } from './settings.js';
import { meta } from './params.js';
import { Glyph, Tags, CityPill, Icon, ICONS, Spinner } from './ui.js';
import { addToList, list, notifyListAdd } from './list.js';
import { nav } from './nav.js';

export const lazyStore = createStore({ budget: 5000000, strategy: 'balanced', sellDays: 1, data: null, loading: false, error: '', sort: { k: 'profitEarned', dir: -1 } }, { key: 'albion_next_lazy', pick: (s) => ({ budget: s.budget, strategy: s.strategy, sellDays: s.sellDays }) });
const STRATEGIES = [['balanced', 'Сбалансированная'], ['expensive', 'Дорогое: мало штук, большой профит'], ['mass', 'Массовое: много дешёвых штук']];

export async function runLazy() {
  const st = lazyStore.get();
  lazyStore.set({ loading: true, error: '' });
  try {
    const s = settings.get();
    const data = await apiGet('/api/lazy-crafter', { ...commonParams(s), budget: st.budget, strategy: st.strategy, sellDays: st.sellDays, days: s.hist < 3 ? 3 : s.hist });
    if (data.jug && data.jug.lastPricePass) meta.set({ jugAt: data.jug.lastPricePass });
    lazyStore.set({ data, loading: false });
  } catch (err) {
    lazyStore.set({ loading: false, error: err.message });
  }
}

const COLS = [['name', 'Предмет'], ['qty', 'Кол-во'], ['costPerUnit', 'Себестоимость'], ['profitPerUnit', 'Профит/шт'], ['costUsed', 'Потрачено'], ['profitEarned', 'Прибыль'], ['days', 'Закупка + продажа']];

export function LazyTab() {
  const st = useStore(lazyStore);
  const set = (p) => lazyStore.set(p);
  const d = st.data;
  const val = (it, k) => (k === 'name' ? itemLabel(it.itemId) : k === 'days' ? it.daysToAcquireBatch + it.daysToSellBatch : it[k]);
  const items = d ? [...d.items].sort((a, b) => {
    const x = val(a, st.sort.k); const y = val(b, st.sort.k);
    return (typeof x === 'string' ? x.localeCompare(y, 'ru') : x - y) * st.sort.dir;
  }) : [];
  const setSort = (k) => set({ sort: { k, dir: st.sort.k === k ? -st.sort.dir : (k === 'name' ? 1 : -1) } });
  // Массовое добавление — одно уведомление на весь план, а не по одному на позицию (list.add напрямую, addToList — только для одиночных)
  const addAll = () => {
    items.forEach((it) => list.add({ itemId: it.itemId, enchant: 0, quality: 1, quantity: it.qty, cost: it.costPerUnit, profit: it.profitPerUnit }));
    notifyListAdd({ kind: 'batch', count: items.length, label: 'из ленивого плана' });
  };
  return html`<section class="panel" id="panel-lazy">
    <div class="card filterbox">
      <label class="f">Бюджет, серебро<input id="l-budget" type="text" inputmode="numeric" value=${fmt(st.budget)} onInput=${(e) => set({ budget: parseInt(e.target.value.replace(/\D/g, ''), 10) || 0 })} /></label>
      <label class="f" style="width:260px">Стратегия<select id="l-strategy" value=${st.strategy} onChange=${(e) => set({ strategy: e.target.value })}>${STRATEGIES.map(([v, t]) => html`<option value=${v} selected=${st.strategy === v}>${t}</option>`)}</select></label>
      <label class="f" style="width:140px">Продавать за, дней<input id="l-days" type="number" min="0.5" step="0.5" value=${st.sellDays} onInput=${(e) => set({ sellDays: e.target.value })} /></label>
    </div>
    <div class="runbox"><button class="btn primary big" id="lazy-run" type="button" disabled=${st.loading || !(st.budget > 0)} onClick=${runLazy}>${st.loading ? html`<${Spinner} />Подбираю…` : html`<${Icon} d=${ICONS.couch} />${d ? 'Подобрать заново' : 'Подобрать план'}`}</button>
      <span class="muted" style="font-size:13px">Доля рынка, возврат и города берутся из панели параметров сверху</span></div>
    ${st.error ? html`<div class="card err" role="alert">Ошибка: ${st.error}</div>` : null}
    ${d && !items.length ? html`<div class="card empty">План не получился — при таком бюджете и доле рынка нет прибыльных позиций.</div>` : null}
    ${d && items.length ? html`
      <div class="card strip"><div class="srow">
        <div><span>Бюджет</span><b>${fmt(d.budget)}</b></div>
        <div><span>Потратим</span><b class="neg">${fmt(d.spent)}</b> <span style="display:inline">остаток ${fmt(d.remaining)}</span></div>
        <div><span>Ожидаемая прибыль</span><b class="pos" id="l-profit">${signed(d.totalProfit)}</b> <span style="display:inline">${fmt(d.profitPct, 1)}%</span></div>
        <div><span>Позиций в плане</span><b>${items.length}</b> <span style="display:inline">из ${d.candidates} прибыльных</span></div></div>
        <button class="btn primary" type="button" id="lazy-add-all" onClick=${addAll}><${Icon} d=${ICONS.plus} />Весь план — в крафт-лист</button></div>
      <div class="card"><div class="tw"><table id="lazy-table"><thead><tr>${COLS.map(([k, l]) => html`<th key=${k} class="sortable" aria-sort=${st.sort.k === k ? (st.sort.dir < 0 ? 'descending' : 'ascending') : null} onClick=${() => setSort(k)}>${l}${st.sort.k === k ? (st.sort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`)}<th>Продать</th><th></th></tr></thead>
        <tbody>${items.map((it) => html`<tr key=${it.itemId}>
          <td><div class="item"><${Glyph} id=${it.itemId} tier=${itemTier(it.itemId)} /><div><b>${itemLabel(it.itemId)}</b><div style="margin-top:3px"><${Tags} tier=${itemTier(it.itemId)} /></div></div></div></td>
          <td>${fmt(it.qty)}</td><td class="neg">${fmt(it.costPerUnit)}</td><td class="pos">${signed(it.profitPerUnit)}</td><td class="neg">${fmt(it.costUsed)}</td><td class="pos">${signed(it.profitEarned)}</td>
          <td>${fmtDays(it.daysToAcquireBatch)} + ${fmtDays(it.daysToSellBatch)}${it.bottleneckResource ? html`<div class="muted" style="font-size:12px">узкое место: ${itemLabel(it.bottleneckResource)}</div>` : null}</td>
          <td><${CityPill} name=${it.bestSellCity.city} /> ${fmt(it.bestSellCity.avgPrice)}</td>
          <td><button class="btn sm" type="button" title="В крафт-лист" aria-label="В крафт-лист" onClick=${() => addToList({ itemId: it.itemId, enchant: 0, quality: 1, quantity: it.qty, cost: it.costPerUnit, profit: it.profitPerUnit })}>+</button></td></tr>`)}</tbody></table></div></div>` : null}
  </section>`;
}
