// Вкладка «Продажа»: мгновенно в Buy Order (со своей ценой) и терпеливо через Sell Order — план по городам с включением городов, своим количеством,
// своей ценой города и стратегией распределения; порог продажи, потолок себестоимости и полоса цены. Внизу — свёрнутый блок «Ещё сравнения»
// (по качеству и по тирам, с переключением тира кликом по строке): смотрят их редко, поэтому вместе и по умолчанию свёрнуто, а не отдельной вкладкой.
import { html, useStore, fmt, signed, tone, fmtDays, QN } from './lib.js';
import { calcStore, emptyManual, setSellPrice, calcPlanActions, planOfStore } from './calc-store.js';
import { CityPlanTable, cityPlanTitle } from './cityplan.js';
import { CityPill } from './ui.js';

const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

function BuyOrderCard({ c, d }) {
  const bs = d.bestSell;
  const rate = bs && bs.taxRate !== undefined ? bs.taxRate : d.taxRate;
  const tone1 = d.profitPerUnit;
  return html`<div class="card box"><h2 class="sec">Buy Order — мгновенно в чужой ордер</h2><div class="kv" id="sell-instant">
    <div><span>Лучшая цена покупки</span><b>${bs && !bs.manual ? html`${bs.blackMarket ? '⚫ ' : ''}<${CityPill} name=${bs.city} /> ${fmt(bs.price)}` : bs ? `своя цена: ${fmt(bs.price)}` : 'нет данных'}
      <input id="manual-sell-price" class=${`manual-price ${c.sellPrice !== null ? 'is-manual' : ''}`} type="number" min="0" step="1" placeholder="своя цена" value=${c.sellPrice ?? ''} onInput=${(e) => setSellPrice(e.target.value)} title="Видишь в игре другую цену — впиши: расчёт обновится сразу" aria-label="Своя цена продажи" /></b></div>
    <div><span>После налога с продажи (${fmt(rate * 100, bs && bs.blackMarket ? 1 : 0)}%${bs && bs.blackMarket ? ', Чёрный Рынок' : ''})</span><b>${d.netSellPrice !== null && d.netSellPrice !== undefined ? fmt(Math.round(d.netSellPrice)) : '—'}</b></div>
    <div><span>Профит / шт</span><b class=${tone(tone1)}>${d.profitPerUnit !== null ? signed(Math.round(d.profitPerUnit)) : '—'}</b></div>
    <div><strong>Итого на ${fmt(d.quantity)} шт</strong><b class=${tone(d.totalProfit)}>${d.totalProfit !== null ? signed(Math.round(d.totalProfit)) : '—'}</b></div></div>
    <details style="margin-top:10px"><summary class="muted" style="cursor:pointer;font-size:13px">Цены готового предмета по городам</summary>
      <div class="tw"><table id="craft-sell-table"><thead><tr><th>Город</th><th>Купить</th><th>Продать</th></tr></thead>
        <tbody>${d.sellPrices.map((sp) => html`<tr key=${sp.city} class=${`${bs && sp.city === bs.city ? 'sel' : ''} ${sp.inactive ? 'below-threshold' : ''}`}><td><${CityPill} name=${sp.city} />${sp.blackMarket ? ' ⚫' : ''}${sp.inactive ? html` <small class="cp-off" title="${sp.blackMarket ? 'Чёрный Рынок' : 'Город'} вне расчёта: цены для справки, в выбор лучшей цены не входят">вне расчёта</small>` : null}</td><td>${sp.sellMin ?? '—'}</td><td>${sp.buyMax ?? '—'}</td></tr>`)}</tbody></table></div></details></div>`;
}

function SellPlanBand({ d }) {
  const sp = d.sellPlan;
  if (!sp) return null;
  const band = sp.sellLow === null ? '—' : sp.sellLow === sp.sellHigh ? fmt(sp.sellLow) : `${fmt(sp.sellLow)}—${fmt(sp.sellHigh)}`;
  const range = (a, b) => (a === null ? '—' : a === b ? fmt(a) : `${fmt(a)} … ${fmt(b)}`);
  return html`<${Fragment}>
    ${sp.ceiling !== null ? html`<div><span>Потолок себестоимости ${fmt(sp.ceiling)}: проходит?</span><b class=${sp.withinCeiling ? 'pos' : 'neg'}>${sp.withinCeiling ? 'да' : 'нет'}</b></div>` : null}
    <div><span>Профит / шт в полосе продажи ${band} (после налога ${fmt(d.taxRate * 100)}%)</span><b class=${sp.profitLow > 0 ? 'pos' : 'neg'}>${range(sp.profitLow, sp.profitHigh)}</b></div>
    <div><strong>Итого на партию в этой полосе</strong><b class=${sp.profitLow > 0 ? 'pos' : 'neg'}>${range(sp.totalLow, sp.totalHigh)}</b></div></${Fragment}>`;
}
import { Fragment } from './lib.js';

function Threshold({ p }) {
  const t = p.threshold;
  if (!t) return null;
  if (!t.cities.length) return html`<div><span>Города с ценой не ниже ${fmt(t.value)}</span><b>нет ни одного</b></div>`;
  const slow = t.daysToSellBatch !== null && t.daysToSellBatch > 30;
  return html`<${Fragment}><div><span>Города с ценой не ниже ${fmt(t.value)}</span><b>${t.cities.map((x) => html`<span key=${x.city} style="margin-left:6px"><${CityPill} name=${x.city} /> ${fmt(x.avgPrice)} <span class="muted">(${fmt(x.avgDailyVolume, 1)}/день)</span></span>`)}</b></div>
    <div><span>Суммарный спрос: ${fmt(t.totalDailyVolume, 1)} в день → дней на распродажу партии</span><b class=${slow ? 'scan-stale' : ''}>${fmtDays(t.daysToSellBatch)}${slow ? ' ⚠' : ''}</b></div></${Fragment}>`;
}

function CityPlan({ c, d, p, st }) {
  return html`<div class="card" style="margin-top:14px" id="city-plan">
    <div class="box" style="padding-bottom:0"><h2 class="sec">${cityPlanTitle(st)}</h2></div>
    <${CityPlanTable} d=${d} st=${st} plan=${planOfStore(c)} actions=${calcPlanActions} single />
  </div>`;
}

function SellOrderCard({ c, d, p, st }) {
  const ps = d.patientSell;
  if (!ps) return html`<div class="card box"><h2 class="sec">Sell Order — свой ордер</h2><div class="muted">Нет истории сделок за период — своей продажи не посчитать.</div></div>`;
  const live = st && st.totalQty > 0 ? st : null;
  const avg = live ? live.avgPrice : ps.avgSellPrice;
  const net = live ? live.netPrice : ps.netSellPrice;
  const unit = live ? live.profitUnit : ps.profitPerUnit;
  const days = live ? live.planDays : ps.daysToSellBatch;
  const sold = live ? live.totalQty : d.quantity;
  const slow = days !== null && days > 30;
  const a = d.acquire;
  const bottleneck = a && a.byResource.find((r) => r.resource === a.bottleneckResource);
  const cycle = a && a.days !== null ? (live ? a.days + live.planDays : a.cycleDays) : null;
  return html`<div class="card box"><h2 class="sec">Sell Order — свой ордер, история за ${ps.days} дн.</h2><div class="kv" id="sell-patient">
    <div><span>Средняя цена сделок${live ? ' (по плану продажи)' : ''}</span><b>${fmt(avg)}</b></div>
    <div><span>Лучший город по цене</span><b>${ps.bestCity ? html`<${CityPill} name=${ps.bestCity.city} /> ${fmt(ps.bestCity.avgPrice)}` : '—'}</b></div>
    <div><span>Спрос: сделок в день (по выбранным городам)</span><b>${fmt(ps.avgDailyVolume, 1)}</b></div>
    <div><span>Дней на распродажу ${fmt(sold)} шт (доля рынка ${fmt((ps.marketShare ?? 1) * 100)}%: тебе ~${fmt(ps.avgDailyVolume * (ps.marketShare ?? 1), 1)} из ${fmt(ps.avgDailyVolume, 1)} сделок в день)</span><b class=${slow ? 'scan-stale' : ''}>${fmtDays(days)}${slow ? ' ⚠' : ''}</b></div>
    ${a && a.days !== null ? html`<div><span>Дней на закупку сырья (узкое место: ${bottleneck ? bottleneck.resourceName : '—'})</span><b>${fmtDays(a.days)}</b></div><div><strong>Весь цикл: закупка + продажа</strong><b>${cycle !== null ? fmtDays(cycle) : '—'}</b></div>` : null}
    <${SellPlanBand} d=${d} />
    <div><span>После налога с продажи (${d.blackMarket ? 'у каждого города свой' : `${fmt(d.taxRate * 100)}%`})</span><b>${fmt(net)}</b></div>
    <div><span>Профит / шт</span><b class=${tone(unit)}>${signed(unit)}</b></div>
    <div><strong>Итого на ${fmt(sold)} шт</strong><b class=${tone(unit)}>${signed(unit * sold)}</b></div>
    <${Threshold} p=${ps} /></div></div>`;
}

function QualityTable({ d }) {
  const q = d.qualityComparison;
  if (!q || q.length < 2) return null;
  const best = q.reduce((a, b) => ((b.daysToSellBatch ?? Infinity) < (a.daysToSellBatch ?? Infinity) ? b : a));
  return html`<div class="tw"><span class="pl">По качеству</span><table id="quality-table"><thead><tr><th>Качество</th><th>Средняя цена</th><th>Сделок в день</th><th>Дней на распродажу</th><th>Профит / шт</th></tr></thead>
    <tbody>${q.map((x) => { const slow = x.daysToSellBatch !== null && x.daysToSellBatch > 30; return html`<tr key=${x.quality} class=${x.quality === d.quality ? 'sel' : ''}><td><span class=${`tag q${x.quality}`}>${QN[x.quality]}</span>${x.quality === best.quality ? ' ⚡' : ''}</td><td>${fmt(x.avgSellPrice)}</td><td>${fmt(x.avgDailyVolume, 1)}</td><td class=${slow ? 'scan-stale' : ''}>${fmtDays(x.daysToSellBatch)}${slow ? ' ⚠' : ''}</td><td class=${tone(x.profitPerUnit)}>${signed(x.profitPerUnit)}</td></tr>`; })}</tbody></table>
    <p class="note">⚡ — самая быстрая распродажа; выбранное качество выделено. Ликвидность разных качеств отличается на порядки.</p></div>`;
}

function TierTable({ d }) {
  const rows = d.tierComparison || [];
  if (!rows.length) return null;
  return html`<div class="tw"><span class="pl">По тирам</span><table id="tier-table"><thead><tr><th>Тир</th><th>Себестоимость / шт</th><th>Лучшее качество</th><th>Продать (Buy Order)</th><th>Профит / шт (Buy Order)</th><th>Профит / шт (Sell Order, по истории)</th></tr></thead>
    <tbody>${rows.map((t) => html`<tr key=${t.itemId} class=${t.isCurrent ? 'sel' : 'click'} title=${`Переключить на T${t.tier}`} onClick=${() => { if (!t.isCurrent) calcStore.set({ itemId: t.itemId, data: null, sig: '', ...emptyManual() }); }}>
      <td><span class=${`tag t${t.tier}`}>T${t.tier}</span>${t.enchant ? html` <span class="tag e">.${t.enchant}</span>` : null}${t.enchantCapped && t.tier < 4 ? html` <span class="scan-stale" title="Зачарование доступно только с T4">без чарки</span>` : null}</td>
      <td class="neg">${t.cost !== null ? fmt(t.cost) : 'нет цен на материалы'}</td>
      <td>${t.bestQuality ? html`<span class=${`tag q${t.bestQuality}`}>${QN[t.bestQuality]}</span>` : '—'}</td>
      <td>${t.bestSell ? html`<${CityPill} name=${t.bestSell.city} /> ${fmt(t.bestSell.price)}` : html`<span class="muted">нет предложений</span>`}</td>
      <td class=${tone(t.profitPerUnit)}>${t.profitPerUnit !== null ? `${signed(t.profitPerUnit)} (${fmt(t.profitPct, 1)}%)` : '—'}</td>
      <td class=${tone(t.patient && t.patient.profitPerUnit)}>${t.patient ? `${signed(t.patient.profitPerUnit)} (${fmt(t.patient.profitPct, 1)}%), ${QN[t.patient.quality]}, ${fmt(t.patient.avgDailyVolume, 1)}/день` : '—'}</td></tr>`)}</tbody></table>
    <p class="note">Клик по строке переключает тир: зачарование, качество и количество сохраняются. Buy Order — мгновенная продажа в чужой ордер, Sell Order — свой ордер по средней цене истории.</p></div>`;
}

// Обе таблицы сравнения — по качеству и по тирам — были раньше в двух разных местах (карточка под продажей и отдельная третья вкладка).
// Смотрят их редко, а место на экране занимали всегда; теперь это один свёрнутый по умолчанию блок.
function MoreComparisons({ c, d }) {
  if ((!d.qualityComparison || d.qualityComparison.length < 2) && !(d.tierComparison || []).length) return null;
  return html`<details class="card more" id="more-comparisons"><summary>Ещё сравнения</summary>
    <div class="in"><${QualityTable} d=${d} /><${TierTable} d=${d} /></div></details>`;
}

export function SellTab({ c, d, p, st }) {
  return html`<div id="sub-sell">
    <div class="two"><${BuyOrderCard} c=${c} d=${d} /><${SellOrderCard} c=${c} d=${d} p=${p} st=${st} /></div>
    ${st ? html`<${CityPlan} c=${c} d=${d} p=${p} st=${st} />` : null}
    <${MoreComparisons} c=${c} d=${d} /></div>`;
}
