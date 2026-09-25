// Таблица плана продажи через Sell Order по городам: включение города, своя цена, своё количество, стратегия. Общая для одиночного
// калькулятора и позиций стека: состояние правок (plan) и действия (actions) приходят снаружи — компонент ничего не хранит.
// single — единственный экземпляр на странице (нужны id для тестов и ссылок); в стеке таблиц несколько.
import { html, fmt, signed, tone, fmtDays } from './lib.js';
import { CityPill } from './ui.js';
import { hasKey as has } from './logic/planEdit.js';

export const cityPlanTitle = (st) => `План продажи через Sell Order по городам${st.minPrice !== null ? ` (серые — ниже порога ${fmt(st.minPrice)}, в автоплан не входят)` : ''}`;

export function CityPlanTable({ d, st, plan, actions, single = false }) {
  const { minPrice, marketShare, serverPlan, auto, anyManual, rowsData, totalQty, planDays, avgPrice, netPrice, profitUnit, noVolume } = st;
  const sumOk = totalQty === d.quantity;
  const acquireDays = d.acquire && d.acquire.days !== null ? d.acquire.days : null;
  const sid = single ? 'sale-strategy' : undefined;
  return html`<div>
    <div class="box" style="padding-bottom:0"><label class="f" style="max-width:420px" title="«Максимизировать профит» — города с лучшим индексом профита берут партию первыми, но не больше разумной вместимости. «Равномерно по времени» — партия делится пропорционально обороту">Распределение партии
        <select id=${sid} class="sale-strategy" value=${plan.strategy} onChange=${(e) => actions.setStrategy(e.target.value)}><option value="profit" selected=${plan.strategy === 'profit'}>Максимизировать профит — по индексу профита</option><option value="even" selected=${plan.strategy === 'even'}>Равномерно по времени</option></select></label></div>
    <div class="tw"><table id=${single ? 'city-table' : undefined} class="city-table"><thead><tr><th>В плане</th><th>Город</th><th>Средняя цена</th><th>Сделок в день</th><th>Профит / шт</th><th>Везти сюда, шт</th><th>Дней здесь</th><th>Профит с города</th><th title="Индекс профита = профит% × log2(2 + оборот)">Индекс</th></tr></thead>
      <tbody>${rowsData.map(({ c: cc, qty, days, manual, tolerance, inPlan, enabled }) => {
        const priced = cc.avgSellPrice !== null;
        const dim = (priced && minPrice !== null && cc.avgSellPrice < minPrice && !manual) || !enabled;
        const canToggle = cc.avgDailyVolume > 0 || (priced && has(plan.manualQty, cc.city));
        return html`<tr key=${cc.city} class=${dim ? 'below-threshold' : ''} data-city=${cc.city}>
          <td><input type="checkbox" class="ck plan-toggle" data-city=${cc.city} checked=${enabled} disabled=${!canToggle} onChange=${(e) => actions.setToggle(cc.city, e.target.checked)} title=${canToggle ? 'Включить или выключить город в плане продажи — партия пересчитается' : 'Нет сделок за период: впиши свою цену и количество'} aria-label=${`В плане: ${cc.city}`} /></td>
          <td><${CityPill} name=${cc.city} />${cc.blackMarket ? ' ⚫' : ''}${cc.inactive && !enabled ? html` <small class="cp-off" title="Город вне расчёта: данные для справки. Включи галочкой «В плане» — и он войдёт в план">вне расчёта</small>` : null}</td>
          <td>${priced ? fmt(cc.avgSellPrice) : html`<span class="pill w">нет данных</span>`}${cc.blackMarket ? null : html`<br /><input class=${`plan-city-price ${cc.ownPrice ? 'is-manual' : ''}`} data-city=${cc.city} type="number" min="0" step="1" value=${has(plan.cityPrices, cc.city) ? plan.cityPrices[cc.city] : ''} placeholder="своя цена" onInput=${(e) => actions.setCityPrice(cc.city, e.target.value)} title=${priced ? 'Видишь в игре другую цену продажи в этом городе — впиши: расчёт обновится сразу' : 'Сделок за период нет — впиши цену, которую видишь в игре'} aria-label=${`Своя цена: ${cc.city}`} />`}</td>
          <td>${cc.orderOnly ? html`<span class="pill w" title=${`Сделок за период нет — цена самого дешёвого ордера на продажу (${cc.orderDate ? String(cc.orderDate).replace('T', ' ') : ''} UTC); оборот неизвестен: в план город входит только с вписанным количеством`}>по ордеру</span>` : fmt(cc.avgDailyVolume, 1)}</td>
          <td class=${tone(cc.profitPerUnit)}>${cc.profitPerUnit === null || cc.profitPerUnit === undefined ? '—' : signed(cc.profitPerUnit)}</td>
          <td><input class=${`plan-qty ${manual ? 'is-manual' : ''}`} type="number" min="0" step="1" value=${qty} data-city=${cc.city} disabled=${!priced} onInput=${(e) => actions.setManualQty(cc.city, e.target.value)} title="Сколько штук планируешь продать в этом городе (введи своё — остальное пересчитается)" aria-label=${`Штук в ${cc.city}`} /></td>
          <td>${qty > 0 ? fmtDays(days) : '—'}${inPlan && tolerance && !manual ? html` <small>(допуск ${(tolerance * 100).toFixed(0)}%)</small>` : null}</td>
          <td class=${tone(cc.profitPerUnit)}>${qty > 0 && priced ? signed(cc.profitPerUnit * qty) : '—'}</td>
          <td>${cc.profitIndex ? fmt(cc.profitIndex, 0) : '—'}</td></tr>`;
      })}</tbody></table></div>
    <div class="box plan-summary"><div class="kv">
      <div><span>Распределено</span><b class=${sumOk ? '' : 'scan-stale'}>${fmt(totalQty)} из ${fmt(d.quantity)} шт${sumOk ? '' : ' ⚠ (сумма плана не равна партии)'}${anyManual ? html` <button type="button" class="btn sm plan-reset" onClick=${actions.reset}>Сбросить к автоплану</button>` : null}</b></div>
      <div><span>Срок распродажи по плану</span><b>${totalQty > 0 ? fmtDays(planDays) : '—'}${acquireDays !== null && totalQty > 0 ? ` · весь цикл (закупка ${fmtDays(acquireDays)} + продажа): ${fmtDays(acquireDays + planDays)}` : ''}</b></div>
      <div><span>Средняя цена · после налога</span><b>${avgPrice !== null ? fmt(avgPrice) : '—'} · ${netPrice !== null ? fmt(netPrice) : '—'}</b></div>
      <div><span>Профит / шт · итого</span><b class=${tone(profitUnit)}>${profitUnit !== null ? signed(profitUnit) : '—'} · ${profitUnit !== null ? signed(profitUnit * totalQty) : '—'}</b></div>
      ${d.patientSell && d.patientSell.orderOnly ? html`<div><span class="scan-stale">⚠ Сделок за период нет ни в одном городе: цена — по самому дешёвому ордеру, оборот и срок продажи неизвестны.</span><b></b></div>` : null}
      ${noVolume ? html`<div><span class="scan-stale">⚠ В одном из городов нет сделок за период — срок продажи там посчитать нельзя.</span><b></b></div>` : null}</div>
      <p class="note">В автоплан входят все прибыльные города${d.blackMarket ? '; Чёрный Рынок вне расчёта, пока его не включишь галочкой (свой налог)' : ''}; при доле рынка ${fmt(marketShare * 100)}% автоплан занимает ${fmtDays(auto.days)}.${serverPlan && serverPlan.excluded.length ? ` Вне автоплана: ${serverPlan.excluded.map((e) => `${e.city} — ${e.reason}`).join('; ')}.` : ''} Включай и выключай города галочкой «В плане» или впиши своё количество — всё пересчитается сразу.</p></div></div>`;
}
