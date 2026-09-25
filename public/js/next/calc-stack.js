// Калькулятор в режиме стека: общий вид активных позиций (итоги, сводная закупка, таблица продаж) и переход к одной позиции («подробнее»).
// Стек — копия активных позиций крафт-листа со своими правками (включение, количество, добавление, удаление); расчёт и компоненты общие с листом.
import { html, useStore, useState, fmt, signed, tone, fmtDays, itemLabel, itemTier } from './lib.js';
import { stack } from './list.js';
import { stackDef } from './listcalc.js';
import { calcStore, emptyManual } from './calc-store.js';
import { StackCards, StackTotals, useStackData } from './stack-ui.js';
import { StackShopping } from './stack-shopping.js';
import { ItemPicker } from './picker.js';
import { Glyph, Tags, Icon, ICONS, toast } from './ui.js';
import { itemProfit } from './logic/stack.js';
import { profitOf } from './logic/profit.js';
import { turnoverPerDay, turnoverInfo } from './logic/turnover.js';
import { salePlanOf } from './stack-sales.js';
import { manualFromPlan } from './calc-store.js';
import { settings } from './settings.js';
import { StackSalePlans } from './stack-sales.js';
import { FreshnessButton, invalidateDef } from './freshness.js';
import { collectAllIds } from './logic/freshness.js';

// «Подробнее»: позиция открывается в обычном калькуляторе (все вкладки и ручной план продажи), стек остаётся полосой сверху
export function focusStackItem(x) {
  calcStore.set({ stackFocus: x.uid, itemId: x.itemId, enchant: x.enchant, quality: x.quality, qty: x.quantity, after: !!x.after, faction: !!x.faction, crestSilver: !!x.crestSilver, heartSilver: !!x.heartSilver, data: null, sig: '', error: '', sub: 'buy', ...manualFromPlan(x.plan) });
}
export const leaveStack = () => calcStore.set({ stackMode: false, stackFocus: null });

// Полоса стека над обычным расчётом позиции: назад к стеку и переключение между позициями
export function StackFocusBar() {
  const c = useStore(calcStore);
  const { items } = useStore(stack.store);
  return html`<div class="stackbar card" id="stack-focus-bar">
    <button class="btn sm" type="button" id="stack-back" onClick=${() => calcStore.set({ stackFocus: null })}>← К стеку (${items.filter((i) => i.on !== false).length})</button>
    <div class="stack-chips" role="tablist" aria-label="Позиции стека">${items.map((x) => html`<button type="button" role="tab" key=${x.uid} class=${`stack-chip ${x.on === false ? 'off' : ''}`} aria-selected=${String(x.uid === c.stackFocus)} title=${itemLabel(x.itemId)} onClick=${() => focusStackItem(x)}>
      <${Glyph} id=${x.itemId} tier=${itemTier(x.itemId)} enchant=${x.enchant} quality=${x.quality} /><${Tags} tier=${itemTier(x.itemId)} enchant=${x.enchant} quality=${x.quality} /></button>`)}</div>
  </div>`;
}

// Таблица продаж стека: по каждой позиции цена, профит, срок продажи и очки; клик по строке — «подробнее»
function SalesTable({ data }) {
  const { items, results } = data;
  const windowDays = useStore(settings).hist;
  return html`<div class="card tw" id="stack-sales"><table><thead><tr><th>Позиция</th><th>Кол-во</th><th>Вложения / шт</th><th>Профит / шт</th><th>Профит всего</th><th>Оборот / день</th><th>Срок продажи</th><th>Очки</th></tr></thead>
    <tbody>${items.map((x) => {
      const d = results.get(x.uid);
      const ok = d && !d.error;
      const pf = ok ? itemProfit(x, d) : null;
      const p = ok ? profitOf(d) : null;
      return html`<tr key=${x.uid} class=${`click ${x.on === false ? 'off' : ''}`} title="Открыть позицию подробно" onClick=${() => focusStackItem(x)}>
        <td><div class="item"><${Glyph} id=${x.itemId} tier=${itemTier(x.itemId)} enchant=${x.enchant} quality=${x.quality} /><div><b>${itemLabel(x.itemId)}</b><div style="margin-top:3px"><${Tags} tier=${itemTier(x.itemId)} enchant=${x.enchant} quality=${x.quality} />${x.on === false ? html` <span class="pill n">не в расчёте</span>` : null}</div></div></div></td>
        <td>${fmt(x.quantity)}</td>
        <td class="neg">${ok ? fmt(d.effectiveCostPerUnit) : '—'}</td>
        <td class=${tone(pf && pf.unit)}>${pf ? signed(pf.unit) : '—'}</td>
        <td class=${tone(pf && pf.unit)}>${pf ? signed(pf.unit * x.quantity) : '—'}</td>
        <td>${ok ? (() => { const t = turnoverInfo(x.quantity, turnoverPerDay(x, d).perDay, windowDays); return t.perDay === null ? '—' : html`<span class=${t.slow ? 'scan-stale' : ''} title=${`${fmt(x.quantity)} шт при обороте ${fmt(t.perDay, 1)} шт/день: ≈ ${fmtDays(t.days)}`}>${fmt(t.perDay, 1)}</span>`; })() : '—'}</td>
        <td>${(() => { const sp = ok ? salePlanOf(x, d) : null; const days = sp && sp.totalQty > 0 ? sp.planDays : p && p.days; return days !== null && days !== undefined ? fmtDays(days) : '—'; })()}</td>
        <td>${ok && d.faction ? fmt(d.faction.pointsPerCape * x.quantity) : '—'}</td></tr>`;
    })}</tbody></table>
    <div class="statusline">Цена продажи — из плана или своя (в карточке позиции); срок — по плану продажи по городам выше. Клик по строке открывает позицию подробно.</div></div>`;
}

export function StackView() {
  const data = useStackData(stackDef);
  const c = useStore(calcStore);
  const [adding, setAdding] = useState(false);
  const { items, faction, autoAfter } = data;
  const set = (p) => calcStore.set(p);
  const add = (id) => { stack.add({ itemId: id, enchant: 0, quality: 4, quantity: 1 }); setAdding(false); toast(`В стек добавлено: ${itemLabel(id)}`); };
  const subs = [['buy', 'Закупка'], ['sell', 'Продажа']];
  const windowDays = useStore(settings).hist;
  return html`<section class="panel" id="panel-calc">
    <div class="stackhead">
      <div><div class="grouphead">Стек калькулятора <span class="muted" style="text-transform:none;letter-spacing:0">· ${items.filter((i) => i.on !== false).length} из ${items.length} в расчёте${faction ? ` · ${faction.name}` : ''}</span></div>
        <p class="note" style="margin:4px 0 0">Клик по позиции включает и выключает её; серые не входят в расчёт. Это копия листа: правки здесь лист не меняют.</p></div>
      <div class="stackactions"><button class="btn" type="button" id="stack-add" onClick=${() => setAdding(!adding)}><${Icon} d=${ICONS.plus} />Добавить позицию</button><${FreshnessButton} ids=${collectAllIds(data.results, (d) => itemLabel(d.itemId), data.pairs)} onRefreshed=${() => invalidateDef(stackDef)} /><button class="btn ghost" type="button" id="stack-exit" onClick=${leaveStack}>Выйти из стека</button></div>
    </div>
    ${adding ? html`<div class="card" style="padding:14px 18px;margin-bottom:16px"><${ItemPicker} value=${null} onPick=${add} /></div>` : null}
    ${items.length === 0 ? html`<div class="card empty">Стек пуст. Добавь позицию или открой активные позиции из крафт-листа.</div>` : html`
      <div class="card verdict stackverdict" id="stack-verdict"><div class="stackbody"><${StackTotals} data=${data} /></div></div>
      <${StackCards} def=${stackDef} data=${data} onDetail=${focusStackItem} detailLabel="Подробнее" />
      <div class="subtabs" role="tablist" style="margin-top:20px">${subs.map(([id, t]) => html`<button type="button" role="tab" key=${id} aria-selected=${String(c.sub === id)} onClick=${() => set({ sub: id })}>${t}</button>`)}</div>
      ${c.sub === 'sell' ? html`<${StackSalePlans} def=${stackDef} data=${data} windowDays=${windowDays} /><div class="grouphead" style="margin-top:22px">Сводка по позициям</div><${SalesTable} data=${data} />` : html`<${StackShopping} data=${data} />`}`}
  </section>`;
}
