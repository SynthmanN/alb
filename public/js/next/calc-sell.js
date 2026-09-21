// Вкладка «Продажа»: мгновенно в Buy Order (со своей ценой) и терпеливо через Sell Order — план по городам с включением городов, своим количеством,
// своей ценой города и стратегией распределения; порог продажи, потолок себестоимости и полоса цены, сравнение по качеству. И «Сравнение по тирам».
import { html, useStore, fmt, signed, tone, fmtDays, QN } from './lib.js';
import { calcStore, emptyManual, setSellPrice, setCityPrice, setToggle, setManualQty, setStrategy, resetPlan } from './calc-store.js';
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
        <tbody>${d.sellPrices.map((sp) => html`<tr key=${sp.city} class=${bs && sp.city === bs.city ? 'sel' : ''}><td><${CityPill} name=${sp.city} /></td><td>${sp.sellMin ?? '—'}</td><td>${sp.buyMax ?? '—'}</td></tr>`)}</tbody></table></div></details></div>`;
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
  const { minPrice, marketShare, serverPlan, auto, anyManual, rowsData, totalQty, planDays, avgPrice, netPrice, profitUnit, noVolume } = st;
  const sumOk = totalQty === d.quantity;
  const acquireDays = d.acquire && d.acquire.days !== null ? d.acquire.days : null;
  return html`<div class="card" style="margin-top:14px" id="city-plan">
    <div class="box" style="padding-bottom:0"><h2 class="sec">План продажи через Sell Order по городам${minPrice !== null ? ` (серые — ниже порога ${fmt(minPrice)}, в автоплан не входят)` : ''}</h2>
      <label class="f" style="max-width:420px" title="«Максимизировать профит» — города с лучшим индексом профита берут партию первыми, но не больше разумной вместимости. «Равномерно по времени» — партия делится пропорционально обороту">Распределение партии
        <select id="sale-strategy" value=${c.strategy} onChange=${(e) => setStrategy(e.target.value)}><option value="profit" selected=${c.strategy === 'profit'}>Максимизировать профит — по индексу профита</option><option value="even" selected=${c.strategy === 'even'}>Равномерно по времени</option></select></label></div>
    <div class="tw"><table id="city-table"><thead><tr><th>В плане</th><th>Город</th><th>Средняя цена</th><th>Сделок в день</th><th>Профит / шт</th><th>Везти сюда, шт</th><th>Дней здесь</th><th>Профит с города</th><th title="Индекс профита = профит% × log2(2 + оборот)">Индекс</th></tr></thead>
      <tbody>${rowsData.map(({ c: cc, qty, days, manual, tolerance, inPlan, enabled }) => {
        const priced = cc.avgSellPrice !== null;
        const dim = (priced && minPrice !== null && cc.avgSellPrice < minPrice && !manual) || !enabled;
        const canToggle = cc.avgDailyVolume > 0 || (priced && has(c.manualQty, cc.city));
        return html`<tr key=${cc.city} class=${dim ? 'below-threshold' : ''}>
          <td><input type="checkbox" class="ck plan-toggle" data-city=${cc.city} checked=${enabled} disabled=${!canToggle} onChange=${(e) => setToggle(cc.city, e.target.checked)} title=${canToggle ? 'Включить или выключить город в плане продажи — партия пересчитается' : 'Нет сделок за период: впиши свою цену и количество'} aria-label=${`В плане: ${cc.city}`} /></td>
          <td><${CityPill} name=${cc.city} />${cc.blackMarket ? ' ⚫' : ''}</td>
          <td>${priced ? fmt(cc.avgSellPrice) : html`<span class="pill w">нет данных</span>`}${cc.blackMarket ? null : html`<br /><input class=${`plan-city-price ${cc.ownPrice ? 'is-manual' : ''}`} data-city=${cc.city} type="number" min="0" step="1" value=${has(c.cityPrices, cc.city) ? c.cityPrices[cc.city] : ''} placeholder="своя цена" onInput=${(e) => setCityPrice(cc.city, e.target.value)} title=${priced ? 'Видишь в игре другую цену продажи в этом городе — впиши: расчёт обновится сразу' : 'Сделок за период нет — впиши цену, которую видишь в игре'} aria-label=${`Своя цена: ${cc.city}`} />`}</td>
          <td>${fmt(cc.avgDailyVolume, 1)}</td>
          <td class=${tone(cc.profitPerUnit)}>${cc.profitPerUnit === null || cc.profitPerUnit === undefined ? '—' : signed(cc.profitPerUnit)}</td>
          <td><input class=${`plan-qty ${manual ? 'is-manual' : ''}`} type="number" min="0" step="1" value=${qty} data-city=${cc.city} disabled=${!priced} onInput=${(e) => setManualQty(cc.city, e.target.value)} title="Сколько штук планируешь продать в этом городе (введи своё — остальное пересчитается)" aria-label=${`Штук в ${cc.city}`} /></td>
          <td>${qty > 0 ? fmtDays(days) : '—'}${inPlan && tolerance && !manual ? html` <small>(допуск ${(tolerance * 100).toFixed(0)}%)</small>` : null}</td>
          <td class=${tone(cc.profitPerUnit)}>${qty > 0 && priced ? signed(cc.profitPerUnit * qty) : '—'}</td>
          <td>${cc.profitIndex ? fmt(cc.profitIndex, 0) : '—'}</td></tr>`;
      })}</tbody></table></div>
    <div class="box plan-summary"><div class="kv">
      <div><span>Распределено</span><b class=${sumOk ? '' : 'scan-stale'}>${fmt(totalQty)} из ${fmt(d.quantity)} шт${sumOk ? '' : ' ⚠ (сумма плана не равна партии)'}${anyManual ? html` <button type="button" class="btn sm plan-reset" onClick=${resetPlan}>Сбросить к автоплану</button>` : null}</b></div>
      <div><span>Срок распродажи по плану</span><b>${totalQty > 0 ? fmtDays(planDays) : '—'}${acquireDays !== null && totalQty > 0 ? ` · весь цикл (закупка ${fmtDays(acquireDays)} + продажа): ${fmtDays(acquireDays + planDays)}` : ''}</b></div>
      <div><span>Средняя цена · после налога</span><b>${avgPrice !== null ? fmt(avgPrice) : '—'} · ${netPrice !== null ? fmt(netPrice) : '—'}</b></div>
      <div><span>Профит / шт · итого</span><b class=${tone(profitUnit)}>${profitUnit !== null ? signed(profitUnit) : '—'} · ${profitUnit !== null ? signed(profitUnit * totalQty) : '—'}</b></div>
      ${noVolume ? html`<div><span class="scan-stale">⚠ В одном из городов нет сделок за период — срок продажи там посчитать нельзя.</span><b></b></div>` : null}</div>
      <p class="note">В автоплан входят все прибыльные города${d.blackMarket ? ' (включая Чёрный Рынок со своим налогом)' : ''}; при доле рынка ${fmt(marketShare * 100)}% автоплан занимает ${fmtDays(auto.days)}.${serverPlan && serverPlan.excluded.length ? ` Вне автоплана: ${serverPlan.excluded.map((e) => `${e.city} — ${e.reason}`).join('; ')}.` : ''} Включай и выключай города галочкой «В плане» или впиши своё количество — всё пересчитается сразу.</p></div></div>`;
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

function QualityCard({ c, d }) {
  const q = d.qualityComparison;
  if (!q || q.length < 2) return null;
  const best = q.reduce((a, b) => ((b.daysToSellBatch ?? Infinity) < (a.daysToSellBatch ?? Infinity) ? b : a));
  return html`<div class="card tw" style="margin-top:14px"><table id="quality-table"><thead><tr><th>Качество</th><th>Средняя цена</th><th>Сделок в день</th><th>Дней на распродажу</th><th>Профит / шт</th></tr></thead>
    <tbody>${q.map((x) => { const slow = x.daysToSellBatch !== null && x.daysToSellBatch > 30; return html`<tr key=${x.quality} class=${x.quality === d.quality ? 'sel' : ''}><td><span class=${`tag q${x.quality}`}>${QN[x.quality]}</span>${x.quality === best.quality ? ' ⚡' : ''}</td><td>${fmt(x.avgSellPrice)}</td><td>${fmt(x.avgDailyVolume, 1)}</td><td class=${slow ? 'scan-stale' : ''}>${fmtDays(x.daysToSellBatch)}${slow ? ' ⚠' : ''}</td><td class=${tone(x.profitPerUnit)}>${signed(x.profitPerUnit)}</td></tr>`; })}</tbody></table>
    <div class="statusline">⚡ — самая быстрая распродажа; выбранное качество выделено. Ликвидность разных качеств отличается на порядки.</div></div>`;
}

export function SellTab({ c, d, p, st }) {
  return html`<div id="sub-sell">
    <div class="two"><${BuyOrderCard} c=${c} d=${d} /><${SellOrderCard} c=${c} d=${d} p=${p} st=${st} /></div>
    ${st ? html`<${CityPlan} c=${c} d=${d} p=${p} st=${st} />` : null}
    <${QualityCard} c=${c} d=${d} /></div>`;
}

export function TiersTab({ c, d }) {
  const rows = d.tierComparison || [];
  if (!rows.length) return html`<div class="card empty">Сравнение по тирам для этого предмета недоступно.</div>`;
  return html`<div id="sub-tiers"><div class="card tw"><table><thead><tr><th>Тир</th><th>Себестоимость / шт</th><th>Лучшее качество</th><th>Продать (Buy Order)</th><th>Профит / шт (Buy Order)</th><th>Профит / шт (Sell Order, по истории)</th></tr></thead>
    <tbody>${rows.map((t) => html`<tr key=${t.itemId} class=${t.isCurrent ? 'sel' : 'click'} title=${`Переключить на T${t.tier}`} onClick=${() => { if (!t.isCurrent) calcStore.set({ itemId: t.itemId, data: null, sig: '', ...emptyManual() }); }}>
      <td><span class=${`tag t${t.tier}`}>T${t.tier}</span>${t.enchant ? html` <span class="tag e">.${t.enchant}</span>` : null}${t.enchantCapped && t.tier < 4 ? html` <span class="scan-stale" title="Зачарование доступно только с T4">без чарки</span>` : null}</td>
      <td class="neg">${t.cost !== null ? fmt(t.cost) : 'нет цен на материалы'}</td>
      <td>${t.bestQuality ? html`<span class=${`tag q${t.bestQuality}`}>${QN[t.bestQuality]}</span>` : '—'}</td>
      <td>${t.bestSell ? html`<${CityPill} name=${t.bestSell.city} /> ${fmt(t.bestSell.price)}` : html`<span class="muted">нет предложений</span>`}</td>
      <td class=${tone(t.profitPerUnit)}>${t.profitPerUnit !== null ? `${signed(t.profitPerUnit)} (${fmt(t.profitPct, 1)}%)` : '—'}</td>
      <td class=${tone(t.patient && t.patient.profitPerUnit)}>${t.patient ? `${signed(t.patient.profitPerUnit)} (${fmt(t.patient.profitPct, 1)}%), ${QN[t.patient.quality]}, ${fmt(t.patient.avgDailyVolume, 1)}/день` : '—'}</td></tr>`)}</tbody></table></div>
    <p class="note">Клик по строке переключает тир: зачарование, качество и количество сохраняются. Buy Order — мгновенная продажа в чужой ордер, Sell Order — свой ордер по средней цене истории.</p></div>`;
}
