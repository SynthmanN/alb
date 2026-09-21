// Цены материала по городам: список рынков, свои цены городов и лучшая закупка с их учётом. Чистые функции — без DOM.
export const SETUP_FEE = 0.025;                 // комиссия 2.5% за свой Buy Order: рыночные цены сравниваются с ней, своя цена — как есть (реально заплаченная)
const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

// Рыночные цены по городам для каждого материала ответа калькулятора: { ключ материала: [{ city, price }] } (цены без комиссии)
export function priceLists(data) {
  const lists = {};
  for (const r of data.recipe || []) {
    if (r.materialSource !== 'points' && r.cityPrices && r.cityPrices.length) lists[r.resource] = r.cityPrices.map(({ city, price }) => ({ city, price }));
  }
  for (const st of (data.enchantAfterCraft && data.enchantAfterCraft.steps) || []) {
    if (st.cityPrices && st.cityPrices.length) lists[st.materialId] = st.cityPrices.map(({ city, price }) => ({ city, price }));
  }
  return lists;
}

// Строки панели «Все города»: каждый активный город (даже без рыночной цены — можно вписать свою) плюс города со своей ценой.
// used — город, по которому идёт закупка сейчас; best — самый дешёвый по рынку с комиссией.
export function cityRows(list, own, cities, fee = SETUP_FEE) {
  const market = new Map((list || []).map((x) => [x.city, x.price]));
  const names = [...new Set([...cities, ...market.keys(), ...Object.keys(own || {})])];
  const rows = names.map((city) => ({ city, market: market.has(city) ? market.get(city) : null, own: has(own, city) ? own[city] : undefined }));
  const eff = (r) => (r.own !== undefined ? r.own : r.market !== null ? r.market * (1 + fee) : Infinity);
  rows.sort((a, b) => eff(a) - eff(b) || a.city.localeCompare(b.city));
  const bestPrice = eff(rows[0] || { own: undefined, market: null });
  return rows.map((r) => ({ ...r, effective: eff(r), isBest: Number.isFinite(bestPrice) && eff(r) === bestPrice }));
}

// Закупка с учётом своих цен городов: свои цены — как есть, рыночные — с комиссией. undefined — своих цен нет (расчёт идёт по рынку)
export function bestBuy(list, own, cities, fee = SETUP_FEE) {
  if (!own || !Object.keys(own).length) return undefined;
  const rows = cityRows(list, own, cities, fee);
  const top = rows.find((r) => Number.isFinite(r.effective));
  return top ? { price: top.effective, city: top.city, fromOwn: top.own !== undefined } : undefined;
}
