// Калькулятор крафта одного предмета: вердикт сверху (профит, ROI, доходы и расходы), ниже вкладки «Закупка», «Продажа», «Сравнение по тирам».
import { html, createStore, useStore, useState, useEffect, useMemo, allItems, itemsReady, fmt, signed, tone, apiGet, apiPost, findItem, itemLabel, itemTier, fmtAge, fmtDays, QN, copyText, auctionName } from './lib.js';
import { commonParams, settings } from './settings.js';
import { meta } from './params.js';
import { Glyph, Tags, CityPill, CityPills, Switch, Icon, ICONS, Spinner, toast } from './ui.js';
import { addToList } from './list.js';
import { navStore, nav } from './nav.js';
import { acquisitionRows } from './logic/acquire.js';
import { profitOf } from './logic/profit.js';

export const calcStore = createStore({ itemId: null, enchant: 0, quality: 4, qty: 10, after: false, sub: 'buy', data: null, loading: false, error: '', sig: '', checks: {} });
const GEAR = (i) => i.category === 'weapon' || i.category === 'armor' || i.category === 'cape';
const maxEnchant = (id) => (itemTier(id) >= 4 ? 4 : 0);
let runId = 0;

export async function runCalc(sig) {
  const c = calcStore.get();
  if (!c.itemId) return;
  const id = ++runId;
  calcStore.set({ loading: true, error: '' });
  try {
    const params = { ...commonParams(), item: c.itemId, enchant: c.enchant, quality: c.quality, quantity: c.qty, ...(c.after ? { enchantAfterCraft: 'true' } : {}) };
    const data = await apiGet('/api/craft-calc', params);
    if (id !== runId) return;
    if (data.jug && data.jug.lastPricePass) meta.set({ jugAt: data.jug.lastPricePass });
    calcStore.set({ data, sig, loading: false, checks: {} });
  } catch (err) {
    if (id === runId) calcStore.set({ loading: false, error: err.message, sig });
  }
}

// «Открыть в калькуляторе» из других вкладок
navStore.subscribe(() => {
  const t = navStore.get().calc;
  if (!t || t.handled) return;
  navStore.set({ calc: { ...t, handled: true } });
  calcStore.set({ itemId: t.itemId, enchant: t.enchant || 0, quality: t.quality || 1, qty: t.quantity || 1, after: !!t.after, data: null, sig: '', error: '' });
});

function ItemPicker({ value, onPick }) {
  const [q, setQ] = useState('');
  const [openList, setOpenList] = useState(false);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return allItems().filter((it) => GEAR(it) && (it.name.toLowerCase().includes(s) || it.id.toLowerCase().includes(s))).slice(0, 12);
  }, [q]);
  return html`<label class="f picker" style="flex:1 1 260px;width:auto;position:relative">Предмет
    <input id="c-search" type="search" autocomplete="off" placeholder=${value ? itemLabel(value) : 'Найди предмет: меч, плащ, шлем…'} value=${q} onInput=${(e) => { setQ(e.target.value); setOpenList(true); }} onFocus=${() => setOpenList(true)} onBlur=${() => setTimeout(() => setOpenList(false), 150)} />
    ${openList && matches.length ? html`<div class="suggest" role="listbox">${matches.map((it) => html`<button type="button" key=${it.id} role="option" onMouseDown=${(e) => { e.preventDefault(); onPick(it.id); setQ(''); setOpenList(false); }}><${Glyph} id=${it.id} tier=${it.tier} size=${48} /><span>${itemLabel(it.id)}</span><span class=${`tag t${it.tier}`}>T${it.tier}</span></button>`)}</div>` : null}
  </label>`;
}

function Verdict({ c, d, p }) {
  const it = findItem(c.itemId);
  const ok = p && p.unit !== null && p.unit > 0;
  const add = () => { addToList({ itemId: c.itemId, enchant: c.enchant, quality: c.quality, quantity: c.qty, cost: d.effectiveCostPerUnit, profit: p ? p.unit : 0, after: c.after && c.enchant > 0 }); toast(`В крафт-листе: ${itemLabel(c.itemId)} × ${c.qty}`); };
  return html`<div class="card verdict" id="verdict">
    <div>
      <div class="v-head"><${Glyph} id=${c.itemId} tier=${itemTier(c.itemId)} enchant=${c.enchant} quality=${c.quality} size=${96} />
        <div><h2>${itemLabel(c.itemId)}</h2><${Tags} tier=${itemTier(c.itemId)} enchant=${c.enchant} quality=${c.quality} /> <span class="muted">· ${fmt(c.qty)} шт</span></div></div>
      <div class="v-pills">
        ${p && p.unit !== null ? html`<span class=${`pill ${ok ? 'g' : 'w'}`}>${ok ? 'Стоит крафтить' : 'Невыгодно'} · ${p.basis === 'sell' ? 'Sell Order' : 'Buy Order'}</span>` : html`<span class="pill w">нет цены продажи</span>`}
        ${p && p.days !== null ? html`<span class="pill n">продажа партии ≈ ${fmtDays(p.days)}</span>` : null}
        ${p && !p.complete ? html`<span class="pill w">нет цены части материалов</span>` : null}
      </div>
      <div class="pair"><div class="soft-good"><span>Доходы (после налога)</span><b class="pos">${p ? fmt(p.income) : '—'}</b></div><div class="soft-bad"><span>Расходы</span><b class="neg">${fmt(d.totalCost)}</b></div></div>
      <div class="v-actions"><button class="btn primary" type="button" id="calc-add" onClick=${add}><${Icon} d=${ICONS.plus} />В крафт-лист</button><button class="btn ghost" type="button" onClick=${() => nav.tab('scan')}>← К скану</button></div>
    </div>
    <div class="stats">
      <div class=${`stat lead ${ok ? '' : 'bad'}`}><span>Профит с одной штуки</span><b class=${tone(p && p.unit)}>${p ? signed(p.unit) : '—'}</b></div>
      <div class="stat"><span>ROI</span><b>${p && p.roi !== null ? `${fmt(p.roi, 0)}%` : '—'}</b></div>
      <div class="stat"><span>Профит всего</span><b class=${tone(p && p.total)}>${p ? signed(p.total) : '—'}</b></div>
      <div class="stat"><span>Вложения на штуку</span><b class="neg">${fmt(d.effectiveCostPerUnit)}</b></div>
      <div class="stat"><span>Оборот в день</span><b>${d.patientSell ? fmt(d.patientSell.marketDailyVolume, 1) : '—'}</b></div>
      <div class="stat"><span>Мгновенно (Buy Order)</span><b class=${tone(d.profitPerUnit)}>${signed(d.profitPerUnit)}</b></div>
    </div></div>`;
}

function MissingPrice({ row, onSaved }) {
  const [v, setV] = useState('');
  const save = async () => {
    const price = parseFloat(v);
    if (!(price > 0)) return;
    await apiPost('/api/manual-price', { id: row.id, quality: 1, price });
    toast(`Цена сохранена: ${row.name}`);
    onSaved();
  };
  return html`<span class="mp"><input type="number" min="0" placeholder="цена" value=${v} onInput=${(e) => setV(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') save(); }} aria-label=${`Цена: ${row.name}`} /><button type="button" class="btn sm" onClick=${save}>ОК</button></span>`;
}

function BuyTab({ c, d }) {
  const rows = useMemo(() => acquisitionRows(d, itemLabel), [d]);
  const done = rows.filter((r) => c.checks[r.id]).length;
  const total = rows.reduce((s, r) => s + (r.sum || 0), 0);
  const copy = async (r) => { const ok = await copyText(auctionName(r.name)); toast(ok ? `Скопировано: ${auctionName(r.name)}` : 'Не удалось скопировать'); };
  const eac = d.enchantAfterCraft;
  return html`<div id="sub-buy"><div class="card"><div class="tw"><table id="buy-table">
    <thead><tr><th>Что покупаем</th><th>Нужно</th><th>Где и по чём</th><th>Цена / шт</th><th>Сумма</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr key=${r.id + r.why} class=${c.checks[r.id] ? 'done' : ''}>
      <td><input type="checkbox" class="ck" checked=${!!c.checks[r.id]} onChange=${(e) => calcStore.set({ checks: { ...c.checks, [r.id]: e.target.checked } })} aria-label=${`Куплено: ${r.name}`} />
        <button type="button" class="namebtn" title="Скопировать название для поиска на аукционе" onClick=${() => copy(r)}>${r.name}</button>
        ${r.why ? html`<div class="muted" style="font-size:12.5px;margin-left:28px">${r.why}</div>` : null}</td>
      <td>${fmt(r.needed)}</td>
      <td class="plan-cities">${r.cities.length ? r.cities.map((x) => html`<div key=${x.city}><${CityPill} name=${x.city} /> <span class="muted">${fmt(x.qty)} шт по ${fmt(x.price, x.price < 100 ? 1 : 0)}</span></div>`) : html`<span class="pill w">нет данных</span>`}</td>
      <td class="neg">${r.missing ? html`<${MissingPrice} row=${r} onSaved=${() => calcStore.set({ sig: '' })} />` : fmt(r.unit, r.unit < 100 ? 1 : 0)}</td>
      <td class="neg">${r.missing ? '—' : fmt(r.sum)}</td></tr>`)}</tbody>
    <tfoot><tr class="materials-total"><td colspan="4">Итого на закупку</td><td class="neg">${fmt(total)}</td></tr></tfoot></table></div>
    <div class="statusline">Куплено ${done} из ${rows.length} позиций${d.rrrPreset ? ` · возврат при крафте ${fmt((d.rrrOptions && d.rrrOptions.gearRate ? d.rrrOptions.gearRate : 0) * 100, 1)}%` : ''}</div></div>
    ${eac && eac.baseSource === 'buy' ? html`<p class="note">Плащ .0 выгоднее купить готовым (${fmt(eac.baseBuy.price)}), чем крафтить (${fmt(eac.baseCraftCostPerUnit)}); затем чары до .${eac.targetLevel} рунами, душами и реликтами.</p>` : null}
    <p class="note">Клик по названию копирует его для поиска на аукционе. Галочки — чек-лист закупки.</p></div>`;
}

function SellTab({ c, d }) {
  const p = d.patientSell;
  const plan = p && p.plan ? p.plan : null;
  const qtyBy = new Map((plan ? plan.cities : []).map((x) => [x.city, x.qty]));
  const net = (d.netSellPrice);
  return html`<div id="sub-sell">
    <div class="two">
      <div class="card box"><h2 class="sec">Sell Order — свой ордер по средней цене</h2>
        ${p ? html`<div class="kv" id="sell-patient"><div><span>Средняя цена сделок</span><b>${fmt(p.avgSellPrice)}</b></div><div><span>После налога и сбора</span><b>${fmt(p.netSellPrice)}</b></div><div><span>Продаётся в день (рынок)</span><b>${fmt(p.marketDailyVolume, 1)}</b></div><div><span>Срок на партию</span><b>${fmtDays(p.daysToSellBatch)}</b></div><div><span>Профит / шт</span><b class=${tone(p.profitPerUnit)}>${signed(p.profitPerUnit)}</b></div></div>` : html`<div class="muted">Истории сделок за период нет — своей продажи не посчитать.</div>`}</div>
      <div class="card box"><h2 class="sec">Buy Order — мгновенно в чужой ордер</h2>
        <div class="kv" id="sell-instant"><div><span>Лучшая цена покупки</span><b>${d.bestSell ? fmt(d.bestSell.price) : '—'}</b></div><div><span>Город</span><b>${d.bestSell ? html`<${CityPill} name=${d.bestSell.city} />` : '—'}</b></div><div><span>После налога</span><b>${fmt(net)}</b></div><div><span>Профит / шт</span><b class=${tone(d.profitPerUnit)}>${signed(d.profitPerUnit)}</b></div><div><span>Когда выбирать</span><b>деньги нужны сразу</b></div></div></div>
    </div>
    ${p && p.byCity && p.byCity.length ? html`<div class="card tw" style="margin-top:14px"><table id="city-table"><thead><tr><th>Город</th><th>Средняя цена</th><th>Сделок/день</th><th>Профит/шт</th><th>Везти, шт</th></tr></thead>
      <tbody>${p.byCity.map((x) => html`<tr key=${x.city}><td><${CityPill} name=${x.city} /></td><td>${x.avgSellPrice ? fmt(x.avgSellPrice) : html`<span class="pill w">нет данных</span>`}</td><td>${fmt(x.avgDailyVolume, 1)}</td><td class=${tone(x.profitPerUnit)}>${x.profitPerUnit === null || x.profitPerUnit === undefined ? '—' : signed(x.profitPerUnit)}</td><td>${fmt(qtyBy.get(x.city) || 0)}</td></tr>`)}</tbody></table></div>` : null}
    ${d.qualityComparison && d.qualityComparison.length > 1 ? html`<div class="card tw" style="margin-top:14px"><table><thead><tr><th>Качество</th><th>Средняя цена</th><th>Сделок/день</th><th>Дней на распродажу</th><th>Профит/шт</th></tr></thead>
      <tbody>${d.qualityComparison.map((x) => html`<tr key=${x.quality} class=${x.quality === c.quality ? 'sel' : ''}><td><span class=${`tag q${x.quality}`}>${QN[x.quality]}</span></td><td>${fmt(x.avgSellPrice)}</td><td>${fmt(x.avgDailyVolume, 1)}</td><td>${fmtDays(x.daysToSellBatch)}</td><td class=${tone(x.profitPerUnit)}>${signed(x.profitPerUnit)}</td></tr>`)}</tbody></table></div>` : null}
  </div>`;
}

function TiersTab({ c, d }) {
  const rows = d.tierComparison || [];
  if (!rows.length) return html`<div class="card empty">Сравнение по тирам для этого предмета недоступно.</div>`;
  return html`<div id="sub-tiers"><div class="card tw"><table><thead><tr><th>Тир</th><th>Себестоимость</th><th>Лучшее качество</th><th>Buy Order</th><th>Sell Order (по истории)</th></tr></thead>
    <tbody>${rows.map((t) => html`<tr key=${t.itemId} class=${t.isCurrent ? 'sel' : 'click'} onClick=${() => { if (!t.isCurrent) calcStore.set({ itemId: t.itemId, data: null, sig: '' }); }}>
      <td><span class=${`tag t${t.tier}`}>T${t.tier}</span></td><td class="neg">${t.hasPrice ? fmt(t.cost) : '—'}</td>
      <td>${t.bestQuality ? html`<span class=${`tag q${t.bestQuality}`}>${QN[t.bestQuality]}</span>` : '—'}</td>
      <td>${t.bestSell ? html`<${CityPill} name=${t.bestSell.city} /> ${fmt(t.bestSell.price)} <span class=${tone(t.profitPerUnit)}>${signed(t.profitPerUnit)}</span>` : html`<span class="muted">нет предложений</span>`}</td>
      <td>${t.patient ? html`<span class=${tone(t.patient.profitPerUnit)}>${signed(t.patient.profitPerUnit)}</span> <span class="muted">(${fmt(t.patient.profitPct, 1)}%, ${fmt(t.patient.avgDailyVolume, 1)}/день)</span>` : '—'}</td></tr>`)}</tbody></table></div>
    <p class="note">Клик по строке переключает тир: зачарование, качество и количество сохраняются.</p></div>`;
}

export function CalcTab() {
  const c = useStore(calcStore);
  const s = useStore(settings);
  const [, force] = useState(0);
  useEffect(() => { itemsReady.then(() => force((n) => n + 1)); }, []);
  const sig = JSON.stringify([c.itemId, c.enchant, c.quality, c.qty, c.after, commonParams(s)]);
  useEffect(() => {
    if (!c.itemId || sig === c.sig) return undefined;
    const t = setTimeout(() => runCalc(sig), 350);
    return () => clearTimeout(t);
  }, [sig, c.itemId]);
  const set = (p) => calcStore.set(p);
  const d = c.data;
  const p = d ? profitOf(d) : null;
  const maxE = c.itemId ? maxEnchant(c.itemId) : 4;
  const family = c.itemId ? allItems().filter((i) => GEAR(i) && i.category === (findItem(c.itemId) || {}).category && i.id.replace(/^T\d+_/, '') === c.itemId.replace(/^T\d+_/, '')).sort((a, b) => a.tier - b.tier) : [];
  const subs = [['buy', 'Закупка'], ['sell', 'Продажа'], ['tiers', 'Сравнение по тирам']];
  return html`<section class="panel" id="panel-calc">
    <div class="filters">
      <${ItemPicker} value=${c.itemId} onPick=${(id) => set({ itemId: id, enchant: Math.min(c.enchant, maxEnchant(id)), data: null, sig: '' })} />
      <label class="f" style="width:120px">Зачарование<select id="c-ench" value=${c.enchant} onChange=${(e) => set({ enchant: +e.target.value })}>${[0, 1, 2, 3, 4].map((e) => html`<option value=${e} selected=${c.enchant === e} disabled=${e > maxE}>.${e}</option>`)}</select></label>
      <label class="f" style="width:150px">Качество<select id="c-q" value=${c.quality} onChange=${(e) => set({ quality: +e.target.value })}>${[1, 2, 3, 4, 5].map((q) => html`<option value=${q} selected=${c.quality === q}>${QN[q]}</option>`)}</select></label>
      <label class="f" style="width:110px">Количество<input id="c-qty" type="number" min="1" value=${c.qty} onInput=${(e) => set({ qty: Math.max(1, parseInt(e.target.value, 10) || 1) })} /></label>
      <${Switch} checked=${c.after} onChange=${(v) => set({ after: v })} title="Считать чары как «плащ .0 + руны, души, реликты»">Чары после крафта</${Switch}>
    </div>
    ${family.length > 1 ? html`<div class="tiers-switch"><span class="pl">Тир</span>${family.map((i) => html`<button type="button" key=${i.id} class=${`tag t${i.tier} tierbtn ${i.id === c.itemId ? 'on' : ''}`} onClick=${() => set({ itemId: i.id, data: null, sig: '' })}>T${i.tier}</button>`)}</div>` : null}
    ${!c.itemId ? html`<div class="card empty">Выбери предмет в поиске или открой его из скана — здесь появится расчёт: вердикт, закупка, продажа и сравнение по тирам.</div>` : null}
    ${c.error ? html`<div class="card err" role="alert">Ошибка: ${c.error}</div>` : null}
    ${c.itemId && !d && c.loading ? html`<div class="card empty"><${Spinner} />Считаю…</div>` : null}
    ${d ? html`<div class=${c.loading ? 'is-loading' : ''}>
      <div class="statusnote" style="margin:0 2px 10px;text-align:left" id="calc-source">${d.dataSource === 'aodp' ? 'Данные: AODP напрямую' : `Данные: краулер${d.jug && d.jug.lastPricePass ? ` · цены обновлены ${fmtAge((Date.now() - d.jug.lastPricePass) / 60000)}` : ''}`}${c.loading ? ' · пересчитываю…' : ''}</div>
      <${Verdict} c=${c} d=${d} p=${p} />
      <div class="subtabs" role="tablist">${subs.map(([id, t]) => html`<button type="button" role="tab" key=${id} aria-selected=${String(c.sub === id)} onClick=${() => set({ sub: id })}>${t}</button>`)}</div>
      ${c.sub === 'buy' ? html`<${BuyTab} c=${c} d=${d} />` : c.sub === 'sell' ? html`<${SellTab} c=${c} d=${d} />` : html`<${TiersTab} c=${c} d=${d} />`}</div>` : null}
  </section>`;
}
