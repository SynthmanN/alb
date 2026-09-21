// План продажи стека: у каждой включённой позиции — продажа через Sell Order по городам (как во вкладке «Продажа» одиночного калькулятора,
// но только для просмотра). Свои цены и количества по городам правятся в подробном виде позиции.
import { html, fmt, signed, tone, fmtDays, itemLabel, itemTier } from './lib.js';
import { Glyph, Tags, CityPill, Turnover } from './ui.js';
import { salePlanState } from './logic/manual.js';
import { itemProfit } from './logic/stack.js';
import { turnoverPerDay, turnoverInfo } from './logic/turnover.js';
import { emptyManual } from './calc-store.js';

// Расчёт плана по городам для позиции стека: тот же salePlanState, что и в калькуляторе, со стратегией и порогом по умолчанию
export function salePlanOf(d) {
  if (!d || d.error || !d.patientSell) return null;
  return salePlanState(d.patientSell, d, { toggles: emptyManual().toggles, manualQty: {}, strategy: emptyManual().strategy });
}

function CityRows({ st }) {
  return html`<div class="tw"><table class="stack-city-table"><thead><tr><th>Город</th><th>Средняя цена</th><th>Сделок в день</th><th>Профит / шт</th><th>Продать, шт</th><th>Дней</th><th>Профит с города</th></tr></thead>
    <tbody>${st.rowsData.map(({ c: cc, qty, days, enabled }) => {
      const priced = cc.avgSellPrice !== null;
      return html`<tr key=${cc.city} class=${enabled && qty > 0 ? '' : 'below-threshold'} data-city=${cc.city}>
        <td><${CityPill} name=${cc.city} />${cc.blackMarket ? ' ⚫' : ''}</td>
        <td>${priced ? fmt(cc.avgSellPrice) : html`<span class="pill w">нет данных</span>`}</td>
        <td>${fmt(cc.avgDailyVolume, 1)}</td>
        <td class=${tone(cc.profitPerUnit)}>${cc.profitPerUnit === null || cc.profitPerUnit === undefined ? '—' : signed(cc.profitPerUnit)}</td>
        <td><b>${qty > 0 ? fmt(qty) : '—'}</b></td>
        <td>${qty > 0 ? fmtDays(days) : '—'}</td>
        <td class=${tone(cc.profitPerUnit)}>${qty > 0 && priced ? signed(cc.profitPerUnit * qty) : '—'}</td></tr>`;
    })}</tbody></table></div>`;
}

function SalePlanCard({ x, d, windowDays, onDetail }) {
  const st = salePlanOf(d);
  const pf = itemProfit(x, d);
  const tinfo = turnoverInfo(x.quantity, turnoverPerDay(x, d).perDay, windowDays);
  return html`<div class="card box sale-plan" data-uid=${x.uid}>
    <div class="sp-head"><div class="item"><${Glyph} id=${x.itemId} tier=${itemTier(x.itemId)} enchant=${x.enchant} quality=${x.quality} />
      <div><b>${itemLabel(x.itemId)}</b> <span class="muted">× ${fmt(x.quantity)}</span><div style="margin-top:3px"><${Tags} tier=${itemTier(x.itemId)} enchant=${x.enchant} quality=${x.quality} /> <${Turnover} info=${tinfo} qty=${x.quantity} short /></div></div></div>
      <button type="button" class="linkbtn" onClick=${() => onDetail(x)}>Изменить план</button></div>
    ${!st ? html`<div class="muted">Нет истории сделок за период — плана продажи по городам нет.</div>` : html`
      <${CityRows} st=${st} />
      <div class="kv sp-sum">
        <div><span>Распределено</span><b class=${st.totalQty === x.quantity ? '' : 'scan-stale'}>${fmt(st.totalQty)} из ${fmt(x.quantity)} шт</b></div>
        <div><span>Срок распродажи по плану</span><b>${st.totalQty > 0 ? fmtDays(st.planDays) : '—'}</b></div>
        <div><span>Средняя цена · после налога</span><b>${st.avgPrice !== null ? fmt(st.avgPrice) : '—'} · ${st.netPrice !== null ? fmt(st.netPrice) : '—'}</b></div>
        <div><span>Профит / шт · итого по городам</span><b class=${tone(st.profitUnit)}>${st.profitUnit !== null ? signed(st.profitUnit) : '—'} · ${st.profitUnit !== null ? signed(st.profitUnit * st.totalQty) : '—'}</b></div>
        ${pf && pf.basis === 'plan' ? html`<div><span title="Цена продажи плаща берётся из фракционного плана (или своя) — на неё опираются итоги стека">Профит в итогах стека (цена из плана)</span><b class=${tone(pf.unit)}>${signed(pf.unit)} / шт</b></div>` : null}
      </div>`}
  </div>`;
}

export function StackSalePlans({ data, windowDays, onDetail }) {
  const { items, results } = data;
  const active = items.filter((x) => x.on !== false);
  const ready = active.filter((x) => results.get(x.uid) && !results.get(x.uid).error);
  if (!active.length) return html`<div class="card empty">Нет включённых позиций — включи хотя бы одну, чтобы увидеть план продажи.</div>`;
  return html`<div id="stack-sale-plans"><div class="grouphead">План продажи через Sell Order по городам</div>
    <div class="sale-plans">${ready.map((x) => html`<${SalePlanCard} key=${x.uid} x=${x} d=${results.get(x.uid)} windowDays=${windowDays} onDetail=${onDetail} />`)}</div>
    ${ready.length < active.length ? html`<div class="note">Считается позиций: ${active.length - ready.length}.</div>` : null}</div>`;
}
