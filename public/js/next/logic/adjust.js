// Свои цены поверх ответа калькулятора: единая цена, лог лотов и цены городов превращаются в «перекрытия» цены материала.
// Одна логика для калькулятора одной вещи, крафт-листа и стека калькулятора.
import { priceLists, bestBuy, SETUP_FEE } from './cityPrices.js';
import { lotsAverage, applyManualPrices } from './manual.js';

const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

// lists — рыночные цены по городам { материал: [{ city, price }] }; prices — { own, cityOwn, lots }; opts — { purchaseLog, cities, fee }
export function makeOverride(lists, prices, { purchaseLog = false, cities = [], fee = SETUP_FEE } = {}) {
  const ownPrice = (res) => {
    if (purchaseLog) { const a = lotsAverage(prices.lots[res]); if (a) return a.avg; }
    return has(prices.own, res) ? prices.own[res] : undefined;
  };
  const buyPrice = (res) => bestBuy(lists[res], prices.cityOwn[res], cities, fee);
  // что покупаем по своей цене: единая своя цена (или лог лотов) важнее цен городов
  const override = (res) => { const o = ownPrice(res); if (o !== undefined) return { price: o }; const b = buyPrice(res); return b ? { price: b.price, city: b.city } : undefined; };
  const hasOwn = Object.keys(prices.own).length > 0 || Object.keys(prices.cityOwn).length > 0 || (purchaseLog && Object.values(prices.lots).some((l) => lotsAverage(l)));
  return { ownPrice, buyPrice, override, hasOwn };
}

// Ответ калькулятора с применёнными своими ценами материалов (продажа не трогается). Без своих цен возвращается тот же объект.
export function adjustData(d, prices, opts = {}) {
  if (!d || d.error) return d;
  const lists = priceLists(d);
  const m = makeOverride(lists, prices, { ...opts, fee: d.setupFeeRate ?? SETUP_FEE });
  if (!m.hasOwn) return d;
  return applyManualPrices(d, { ownPrice: m.ownPrice, buyPrice: m.buyPrice, hasOwn: true, sellPrice: null, cityPrices: {} });
}
