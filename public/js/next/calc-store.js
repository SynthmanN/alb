// Состояние калькулятора: предмет и параметры расчёта, ответ сервера и всё «своё»: цены материалов, лог закупок, цена продажи, цены городов,
// план продажи по городам. Своё пересчитывает результат на месте (logic/manual.js) — без запроса к серверу.
import { createStore } from './lib.js';
import { applyManualPrices, salePlanState } from './logic/manual.js';
import { applyChainChoice } from './logic/enchantChain.js';
import { emptyPlan, withCityPrice, withToggle, withManualQty, withStrategy, resetPlanState } from './logic/planEdit.js';
import { profitOf } from './logic/profit.js';
import { priceLists, SETUP_FEE } from './logic/cityPrices.js';
import { makeOverride } from './logic/adjust.js';
import { resetPrices } from './prices.js';
import { activeCities } from './settings.js';

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// своё для одной вещи (цены материалов — общие, в prices.js): цена мгновенной продажи, цены городов продажи, план продажи по городам,
// ручной выбор пути «после крафта» (дропдаун рецептов + тумблер «только основной рецепт», logic/enchantChain.js applyChainChoice)
export const emptyManual = () => ({ sellPrice: null, chainChoice: { entryLevel: null, forceMain: false }, ...emptyPlan() });
export const manualFromPlan = (plan) => ({ sellPrice: null, chainChoice: { entryLevel: null, forceMain: false }, ...emptyPlan(), ...(plan || {}) });
export const calcStore = createStore({
  itemId: null, enchant: 0, quality: 4, qty: 10, after: false, faction: false, crestSilver: false, heartSilver: false, sub: 'buy',
  data: null, loading: false, error: '', sig: '', checks: {}, ...emptyManual(),
  stackMode: false, stackFocus: null,          // режим стека: общий вид активных позиций или одна позиция в фокусе (uid)
});
const set = (p) => calcStore.set(p);
const num = (raw) => { const v = parseFloat(raw); return Number.isFinite(v) && v >= 0 ? v : null; };

export const setSellPrice = (raw) => set({ sellPrice: raw === '' ? null : num(raw) });
// правки плана продажи: чистые функции из logic/planEdit.js над полями calcStore
const planOfStore = (c) => ({ toggles: c.toggles, manualQty: c.manualQty, cityPrices: c.cityPrices, strategy: c.strategy });
const patientOf = (c) => (c.data && c.data.patientSell) || null;
export const setCityPrice = (city, raw) => set(withCityPrice(planOfStore(calcStore.get()), city, raw));
export const setToggle = (city, on) => { const c = calcStore.get(); set(withToggle(planOfStore(c), patientOf(c), city, on)); };
export const setManualQty = (city, raw) => { const c = calcStore.get(); set(withManualQty(planOfStore(c), patientOf(c), city, raw)); };
export const setStrategy = (strategy) => set(withStrategy(planOfStore(calcStore.get()), strategy));
export const resetPlan = () => set(resetPlanState(planOfStore(calcStore.get())));
export const calcPlanActions = { setStrategy, setToggle, setManualQty, setCityPrice, reset: resetPlan };
export { planOfStore };
export const resetOwn = () => { resetPrices(); set({ sellPrice: null }); };
// Дропдаун «Рецепт зачарования» и тумблер «Только основной рецепт» — рядом, в панели «Зачарование после крафта» (calc-buy.js)
export const setChainEntry = (entryLevel) => set({ chainChoice: { entryLevel, forceMain: false } });
export const setForceMain = (on) => set({ chainChoice: { entryLevel: null, forceMain: on } });

// Всё производное от ответа сервера и «своего»: пересчитанный результат, живой план продажи, профит
export function derive(c, settings, prices) {
  if (!c.data) return { d: null, st: null, p: null };
  const lists = priceLists(c.data);
  const cities = activeCities(settings);
  const fee = c.data.setupFeeRate ?? SETUP_FEE;
  const m = makeOverride(lists, prices, { purchaseLog: settings.purchaseLog, cities, fee });
  const chosen = applyChainChoice(c.data, c.chainChoice);
  const d = applyManualPrices(chosen, { ownPrice: m.ownPrice, buyPrice: m.buyPrice, hasOwn: m.hasOwn, sellPrice: c.sellPrice, cityPrices: c.cityPrices });
  const st = d.patientSell ? salePlanState(d.patientSell, d, { toggles: c.toggles, manualQty: c.manualQty, strategy: c.strategy }) : null;
  const p = profitOf(d, st);
  return { d, st, p, override: m.override, lists };
}
