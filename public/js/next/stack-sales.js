// План продажи стека: у каждой включённой позиции — продажа через Sell Order по городам, правится прямо в карточке (галочки городов,
// свои цены, своё количество, стратегия). Правки хранятся в позиции (item.plan) и сразу меняют профит позиции и итоги стека.
import { html, fmt, itemLabel, itemTier } from './lib.js';
import { Glyph, Tags, Turnover } from './ui.js';
import { CityPlanTable } from './cityplan.js';
import { salePlanState } from './logic/manual.js';
import { turnoverPerDay, turnoverInfo } from './logic/turnover.js';
import { planOf, withCityPrice, withToggle, withManualQty, withStrategy, resetPlanState } from './logic/planEdit.js';

// Расчёт плана по городам для позиции стека (d — уже с учётом правок: useStackData → applyItemPlan)
export const salePlanOf = (item, d) => (d && !d.error && d.patientSell ? salePlanState(d.patientSell, d, planOf(item)) : null);

// Действия правки для одной позиции: состояние плана лежит в item.plan, пересчёт расчёта на сервере не нужен
function itemActions(def, x, d) {
  const p = d.patientSell;
  const save = (plan) => def.ops.patch(x.uid, { plan });
  const cur = () => planOf(x);
  return {
    setStrategy: (v) => save(withStrategy(cur(), v)),
    setToggle: (city, on) => save(withToggle(cur(), p, city, on)),
    setManualQty: (city, raw) => save(withManualQty(cur(), p, city, raw)),
    setCityPrice: (city, raw) => save(withCityPrice(cur(), city, raw)),
    reset: () => save(resetPlanState(cur())),
  };
}

function SalePlanCard({ def, x, d, windowDays }) {
  const st = salePlanOf(x, d);
  const tinfo = turnoverInfo(x.quantity, turnoverPerDay(x, d).perDay, windowDays);
  return html`<div class="card sale-plan" data-uid=${x.uid}>
    <div class="box sp-head"><div class="item"><${Glyph} id=${x.itemId} tier=${itemTier(x.itemId)} enchant=${x.enchant} quality=${x.quality} />
      <div><b>${itemLabel(x.itemId)}</b> <span class="muted">× ${fmt(x.quantity)}</span><div style="margin-top:3px"><${Tags} tier=${itemTier(x.itemId)} enchant=${x.enchant} quality=${x.quality} /> <${Turnover} info=${tinfo} qty=${x.quantity} short /></div></div></div></div>
    ${!st ? html`<div class="box muted">Нет истории сделок за период — плана продажи по городам нет.</div>`
      : html`<${CityPlanTable} d=${d} st=${st} plan=${planOf(x)} actions=${itemActions(def, x, d)} />`}
  </div>`;
}

export function StackSalePlans({ def, data, windowDays }) {
  const { items, results } = data;
  const active = items.filter((x) => x.on !== false);
  const ready = active.filter((x) => results.get(x.uid) && !results.get(x.uid).error);
  if (!active.length) return html`<div class="card empty">Нет включённых позиций — включи хотя бы одну, чтобы увидеть план продажи.</div>`;
  return html`<div id="stack-sale-plans"><div class="grouphead">План продажи через Sell Order по городам</div>
    <div class="sale-plans">${ready.map((x) => html`<${SalePlanCard} key=${x.uid} def=${def} x=${x} d=${results.get(x.uid)} windowDays=${windowDays} />`)}</div>
    ${ready.length < active.length ? html`<div class="note">Считается позиций: ${active.length - ready.length}.</div>` : null}</div>`;
}
