// Фракционный план: на какие плащи потратить очки фракции. Сервер отдаёт позиции и рыночные цены, расчёт плана — на клиенте (logic/factionPlan.js):
// любая вписанная цена или лимит сразу пересчитывает список. Зелёные позиции — в плане, серые — нет данных или менее выгодно.
import { html, Fragment, createStore, useStore, useState, useEffect, fmt, signed, tone, apiGet, apiPost, itemLabel, fmtAge } from './lib.js';
import { commonParams, settings } from './settings.js';
import { meta } from './params.js';
import { Glyph, Tags, Seg, Icon, ICONS, Spinner, toast } from './ui.js';
import { replaceFactionItems } from './list.js';
import { drawerStore } from './nav.js';
import { openStackInCalculator } from './stack-open.js';
import { computeRow, buildPlan, sortPlanRows, planToListItems, rowKey } from './logic/factionPlan.js';

export const FACTIONS = [['MARTLOCK', 'Мартлок'], ['LYMHURST', 'Лимхёрст'], ['BRIDGEWATCH', 'Бридгуотч'], ['FORTSTERLING', 'Форт Стерлинг'], ['THETFORD', 'Тетфорд'], ['CAERLEON', 'Каэрлеон'], ['BRECILIEN', 'Бресилиен']];
export const factionStore = createStore({
  faction: 'LYMHURST', points: 76000, mode: 'mixed', extras: [], own: {}, limits: {}, data: null, loading: false, error: '', sig: '',
  sort: { key: 'planProfit', dir: 'desc' }, showAll: false, edit: null, addOpen: false, add: { tier: 4, ench: 0, q: 4 },
}, { key: 'albion_next_faction', pick: (s) => ({ faction: s.faction, points: s.points, mode: s.mode, extras: s.extras, limits: s.limits }) });

let runId = 0;
async function loadPlan(sig) {
  const st = factionStore.get();
  const id = ++runId;
  factionStore.set({ loading: true, error: '' });
  try {
    const data = await apiGet('/api/faction-plan', { ...commonParams(), faction: st.faction, ...(st.extras.length ? { extra: st.extras.join(',') } : {}) }, { ttl: 60000 });
    if (id !== runId) return;
    if (data.jug && data.jug.lastPricePass) meta.set({ jugAt: data.jug.lastPricePass });
    factionStore.set({ data, sig, loading: false });
  } catch (err) {
    if (id === runId) factionStore.set({ loading: false, error: err.message, sig });
  }
}

const HEADS = [['name', 'Плащ'], ['sale', 'Продажа'], ['cost', 'Себестоимость'], ['profit', 'Профит/шт'], ['points', 'Очков'], ['perPoint', 'На очко'], ['qty', 'В плане'], ['planProfit', 'Профит по плану']];
const ROWS_SHOWN = 12;

// вписанная цена сохраняется на сервере (общая, «недостоверная», живёт до 10 дней), пока AODP не даст данные
const persistTimers = new Map();
function persistOwn(key, row, value) {
  clearTimeout(persistTimers.get(key));
  persistTimers.set(key, setTimeout(() => {
    let id = null;
    let quality = 1;
    if (key.startsWith('mat:') || key.startsWith('part:')) id = key.slice(key.indexOf(':') + 1);
    else if (key.startsWith('sale:')) { if (!row.sale || row.sale.manual) { id = row.finishedId; quality = row.quality; } }
    if (id) apiPost('/api/manual-price', { id, quality, price: value > 0 ? value : 0 });
  }, 700));
}
const setOwn = (key, row, raw) => {
  const v = parseFloat(raw);
  const own = { ...factionStore.get().own };
  if (Number.isFinite(v) && v >= 0 && raw !== '') own[key] = v; else delete own[key];
  factionStore.set({ own });
  persistOwn(key, row, own[key]);
};
const setLimit = (k, raw) => {
  const v = parseInt(raw, 10);
  const limits = { ...factionStore.get().limits };
  if (v > 0) limits[k] = v; else delete limits[k];
  factionStore.set({ limits });
};

function Field({ label, hint, value, placeholder, onInput, manual }) {
  return html`<label class="chipin" title=${hint}>${label}<input type="number" min="0" step="1" value=${value ?? ''} placeholder=${placeholder} class=${manual ? 'is-manual' : ''} onInput=${(e) => onInput(e.target.value)} /></label>`;
}

function Editor({ c, st }) {
  const r = c.r;
  const d = st.data;
  const own = st.own;
  const f = (key, label, serverPrice, hint) => html`<${Field} label=${label} hint=${hint} value=${own[key]} placeholder=${serverPrice !== null && serverPrice !== undefined ? Math.round(serverPrice) : 'нет данных'} onInput=${(v) => setOwn(key, r, v)} manual=${own[key] !== undefined} />`;
  return html`<tr class="editrow"><td colspan="9"><div class="editbox">
    <div class="pl">Свои цены — список пересчитается сразу; вписанное сохраняется как общая «недостоверная» цена на ${d.manualTtlDays} дн.</div>
    <div class="editgrid">
      ${f(`sale:${c.key}`, 'Цена продажи плаща', r.sale ? r.sale.avgPrice : null, 'Средняя цена сделок; своя — для позиций без истории')}
      ${f(`mat:${r.capeDirect.id}`, `Плащ ${r.enchant ? `.${r.enchant}` : ''}`, r.capeDirect.price, 'Обычный плащ нужного зачарования (рыночная цена)')}
      ${r.enchant > 0 ? f(`mat:${r.cape0.id}`, 'Плащ .0', r.cape0.price, 'Для пути «после крафта»') : null}
      ${r.runes.map((x) => f(`mat:${x.id}`, x.label, x.price, `${x.count} шт на плащ`))}
      ${f(`part:${r.crestId}`, `Герб T${r.tier}`, r.crest ? r.crest.price : null, 'Рыночная цена (за серебро)')}
      ${f(`part:${r.heartId}`, 'Сердце', r.heart ? r.heart.price : null, 'Рыночная цена (за серебро)')}
      <label class="chipin" title="Сколько плащей этой позиции брать не больше; по умолчанию оборот × окно истории">Лимит штук<input type="number" min="1" step="1" value=${st.limits[c.key] ?? ''} placeholder=${c.cap === null ? 'неизвестен' : `≤ ${c.cap}`} onInput=${(e) => setLimit(c.key, e.target.value)} /></label>
    </div></div></td></tr>`;
}

function AddForm({ st }) {
  const a = st.add;
  const set = (p) => factionStore.set({ add: { ...a, ...p } });
  const add = () => {
    const key = `${a.tier}:${a.ench}:${a.q}`;
    if (!st.extras.includes(key)) factionStore.set({ extras: [...st.extras, key], addOpen: false, sig: '' });
  };
  return html`<div class="addform card"><label class="f">Тир<select value=${a.tier} onChange=${(e) => set({ tier: +e.target.value })}>${[4, 5, 6, 7, 8].map((t) => html`<option value=${t} selected=${a.tier === t}>T${t}</option>`)}</select></label>
    <label class="f">Зачарование<select value=${a.ench} onChange=${(e) => set({ ench: +e.target.value })}>${[0, 1, 2, 3, 4].map((t) => html`<option value=${t} selected=${a.ench === t}>.${t}</option>`)}</select></label>
    <label class="f">Качество<select value=${a.q} onChange=${(e) => set({ q: +e.target.value })}>${[[1, 'Обычное'], [2, 'Хорошее'], [3, 'Выдающееся'], [4, 'Отличное'], [5, 'Шедевр']].map(([v, t]) => html`<option value=${v} selected=${a.q === v}>${t}</option>`)}</select></label>
    <button class="btn primary" type="button" id="f-add-ok" onClick=${add}>Добавить</button></div>`;
}

export function FactionTab() {
  const st = useStore(factionStore);
  const s = useStore(settings);
  const [pointsText, setPointsText] = useState(null);
  const sig = JSON.stringify([st.faction, st.extras, commonParams(s)]);
  useEffect(() => {
    if (sig === st.sig) return undefined;
    const t = setTimeout(() => loadPlan(sig), 250);
    return () => clearTimeout(t);
  }, [sig]);
  const d = st.data;
  const model = (() => {
    if (!d) return null;
    const ctx = { taxRate: d.taxRate, setupFeeRate: d.setupFeeRate, days: d.days, own: st.own, limits: st.limits, mode: st.mode };
    const computed = d.rows.map((r) => computeRow(r, ctx));
    const plan = buildPlan(computed, { points: st.points, mode: st.mode });
    const rows = sortPlanRows(plan.rows, st.sort);
    return { plan, rows, planned: plan.rows.filter((x) => x.qty > 0) };
  })();
  const set = (p) => factionStore.set(p);
  const setSort = (key) => set({ sort: { key, dir: st.sort.key === key ? (st.sort.dir === 'desc' ? 'asc' : 'desc') : 'desc' } });
  const send = () => {
    const items = planToListItems(model.plan.rows);
    if (!items.length) return;
    replaceFactionItems(items, { id: st.faction, name: (FACTIONS.find(([id]) => id === st.faction) || [, st.faction])[1], points: st.points });
    drawerStore.set({ open: true });
  };
  const sendCalc = () => {
    const items = planToListItems(model.plan.rows);
    if (items.length) openStackInCalculator(items, { id: st.faction, name: (FACTIONS.find(([id]) => id === st.faction) || [, st.faction])[1], points: st.points });
  };
  const spent = model ? st.points - model.plan.left : 0;
  const totalProfit = model ? model.plan.rows.reduce((a, x) => a + x.profit, 0) : 0;
  const capes = model ? model.planned.reduce((a, x) => a + x.qty, 0) : 0;
  const buyHearts = model ? model.plan.rows.reduce((a, x) => a + (x.byVariant.crest || 0), 0) : 0;
  const visible = model ? (st.showAll ? model.rows : model.rows.slice(0, ROWS_SHOWN)) : [];
  return html`<section class="panel" id="panel-faction">
    <div class="plan-h">
      <label class="f">Фракция<select id="f-fac" value=${st.faction} onChange=${(e) => set({ faction: e.target.value })}>${FACTIONS.map(([id, n]) => html`<option value=${id} selected=${st.faction === id}>${n}</option>`)}</select></label>
      <label class="f">Очков<input id="f-points" type="text" inputmode="numeric" value=${pointsText ?? fmt(st.points)} onFocus=${() => setPointsText(String(st.points))} onInput=${(e) => { setPointsText(e.target.value); set({ points: parseInt(e.target.value.replace(/\D/g, ''), 10) || 0 }); }} onBlur=${() => setPointsText(null)} /></label>
      <${Seg} label="Детали" value=${st.mode} onChange=${(v) => set({ mode: v })} options=${[['mixed', 'Оптимально'], ['points', 'Всё за очки']]} />
      <button class="btn" type="button" id="f-add" onClick=${() => set({ addOpen: !st.addOpen })}><${Icon} d=${ICONS.plus} />Добавить позицию</button>
    </div>
    ${st.addOpen ? html`<${AddForm} st=${st} />` : null}
    ${st.error ? html`<div class="card err" role="alert">Ошибка: ${st.error}</div>` : null}
    ${!d && st.loading ? html`<div class="card empty"><${Spinner} />Собираю позиции плана…</div>` : null}
    ${model ? html`
      <div class="card strip"><div class="srow">
        <div><span>Плащей в плане</span><b id="f-capes">${fmt(capes)}</b></div>
        <div><span>Очков потрачено</span><b>${fmt(spent)}</b> <span style="display:inline">из ${fmt(st.points)}</span></div>
        <div><span>Профит по плану</span><b class=${tone(totalProfit)} id="f-profit">${signed(totalProfit)}</b></div>
        ${model.plan.lastEff !== null ? html`<div title="Профит на очко у последней потраченной порции очков"><span>Цена очка</span><b>≈ ${fmt(model.plan.lastEff, 1)}</b></div>` : null}
        ${buyHearts ? html`<div><span>Докупить за серебро</span><b>${fmt(buyHearts)} сердец</b></div>` : null}</div>
        <div class="strip-actions"><button class="btn primary" type="button" id="f-send" disabled=${!model.planned.length} onClick=${send}><${Icon} d=${ICONS.arrow} />Крафтить план — в крафт-лист (${model.planned.length})</button>
          <button class="btn" type="button" id="f-send-calc" disabled=${!model.planned.length} onClick=${sendCalc} title="Позиции плана сразу открываются в калькуляторе одним стеком, минуя крафт-лист"><${Icon} d=${ICONS.calc} />Сразу в калькулятор</button></div></div>
      <div class="card"><div class="tw"><table id="plan-table">
        <thead><tr>${HEADS.map(([k, l]) => html`<th key=${k} class="sortable" aria-sort=${st.sort.key === k ? (st.sort.dir === 'desc' ? 'descending' : 'ascending') : null} onClick=${() => setSort(k)}>${l}${st.sort.key === k ? (st.sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}</th>`)}<th></th></tr></thead>
        <tbody>${visible.map((x) => {
          const c = x.c;
          const r = c.r;
          const on = x.qty > 0;
          const isEdit = st.edit === c.key;
          return html`<${Fragment} key=${c.key}><tr class=${on ? 'on-plan' : 'off'} data-row=${c.key}>
            <td><div class="item"><${Glyph} id=${r.itemId} tier=${r.tier} enchant=${r.enchant} quality=${r.quality} /><div><b>${itemLabel(r.itemId)}</b><div style="margin-top:3px"><${Tags} tier=${r.tier} enchant=${r.enchant} quality=${r.quality} />${c.path === 'after' ? html` <span class="pill n">чары после крафта</span>` : null}${r.source === 'extra' ? html` <span class="pill n">добавлено</span>` : null}</div></div></div></td>
            <td>${fmt(c.grossSale)}${r.sale && r.sale.manual ? html` <span class="fp-warn" title="Вписано вручную — недостоверная цена">⚠</span>` : null}</td>
            <td>${c.cost === null ? html`<button type="button" class="pill w" onClick=${() => set({ edit: isEdit ? null : c.key })}>нужна цена ✎</button>` : html`<span class="neg">${fmt(c.cost)}</span>`}</td>
            <td class=${tone(c.profitAll)}>${c.profitAll === null ? '—' : signed(c.profitAll)}</td>
            <td>${fmt(c.pointsAll)}</td>
            <td>${c.profitAll === null ? '—' : fmt(c.profitAll / c.pointsAll, 1)}${c.partsNet !== null ? html`<br /><small class="muted" title="Сколько дала бы продажа герба и сердца на рынке вместо крафта плаща">детали: ${fmt(c.partsNet)}</small>` : null}</td>
            <td>${on ? html`<span class="pill g">× ${fmt(x.qty)}</span>` : html`<span class="pill n">не в плане</span>`}</td>
            <td class=${on ? 'pos' : ''}>${on ? signed(x.profit) : '—'}</td>
            <td><button type="button" class="edit" title="Вписать свои цены или лимит" aria-label="Свои цены" onClick=${() => set({ edit: isEdit ? null : c.key })}>✎</button></td></tr>
            ${isEdit ? html`<${Editor} c=${c} st=${st} />` : null}</${Fragment}>`;
        })}</tbody></table></div>
        ${model.rows.length > ROWS_SHOWN ? html`<div class="more"><button class="btn ghost sm" type="button" id="f-more" onClick=${() => set({ showAll: !st.showAll })}>${st.showAll ? 'Свернуть' : `Показать все ${model.rows.length} позиций`}</button></div>` : null}</div>
      <p class="note">Зелёные — в плане, тусклые — нет данных или менее выгодно. «Оптимально» докупает часть гербов и сердец за серебро, если это выгоднее. Свежесть данных: ${d.jug && d.jug.lastPricePass ? fmtAge((Date.now() - d.jug.lastPricePass) / 60000) : '—'}.</p>` : null}
  </section>`;
}
