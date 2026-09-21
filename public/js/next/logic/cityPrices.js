// Цены материала по городам: список рынков, свои цены городов и лучшая закупка с их учётом. Чистые функции — без DOM.
export const SETUP_FEE = 0.025;                 // комиссия 2.5% за свой Buy Order: рыночные цены сравниваются с ней, своя цена — как есть (реально заплаченная)
const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

// Рыночные цены по городам для каждого материала ответа калькулятора: { ключ материала: [{ city, price }] } (цены без комиссии)
// строка списка городов; inactive — город вне расчёта (только для справки)
const cityEntry = ({ city, price, inactive }) => (inactive ? { city, price, inactive: true } : { city, price });
export function priceLists(data) {
  const lists = {};
  const fee = data.setupFeeRate ?? SETUP_FEE;
  const keyOf = (r) => r.queryId || r.resource;                                   // с зачарованием: плащ .1 и .3 — разные материалы
  // материал без цен на рынке тоже получает (пустой) список: в панели «Все города» можно вписать свою цену
  for (const r of data.recipe || []) {
    if (r.materialSource !== 'points') lists[keyOf(r)] = (r.cityPrices || []).map(cityEntry);
  }
  for (const st of (data.enchantAfterCraft && data.enchantAfterCraft.steps) || []) {
    lists[st.materialId] = (st.cityPrices || []).map(cityEntry);
  }
  // компоненты крафта и переработки (ткань, кожа, сырьё): сервер отдаёт только выбранный город — он и попадает в список (цена без комиссии)
  const seed = (cp) => { if (!lists[cp.id]) lists[cp.id] = cp.city && cp.price ? [{ city: cp.city, price: cp.price / (1 + fee) }] : []; };
  for (const r of data.recipe || []) {
    if (r.materialSource === 'craft' && r.craftOption) r.craftOption.components.forEach(seed);
    if (r.materialSource === 'refine' && r.refineOption) r.refineOption.components.forEach(seed);
  }
  return lists;
}

// Строки панели «Все города»: каждый активный город (даже без рыночной цены — можно вписать свою) плюс города со своей ценой.
// used — город, по которому идёт закупка сейчас; best — самый дешёвый по рынку с комиссией.
// all — все города, которые показываем (активные и вне расчёта); город вне расчёта в лучшую закупку не входит, пока не вписана своя цена.
export function cityRows(list, own, cities, fee = SETUP_FEE, all = []) {
  const entries = new Map((list || []).map((x) => [x.city, x]));
  const names = [...new Set([...cities, ...all, ...entries.keys(), ...Object.keys(own || {})])];
  const rows = names.map((city) => {
    const e = entries.get(city);
    const mine = has(own, city) ? own[city] : undefined;
    const inactive = mine === undefined && (e ? !!e.inactive : !cities.includes(city));            // своя цена включает город в расчёт: это явное решение пользователя
    return { city, market: e ? e.price : null, own: mine, inactive };
  });
  const eff = (r) => (r.own !== undefined ? r.own : r.market !== null ? r.market * (1 + fee) : Infinity);
  rows.sort((a, b) => a.inactive - b.inactive || eff(a) - eff(b) || a.city.localeCompare(b.city));
  const counted = rows.filter((r) => !r.inactive);
  const bestPrice = counted.length ? eff(counted[0]) : Infinity;
  return rows.map((r) => ({ ...r, effective: eff(r), isBest: !r.inactive && Number.isFinite(bestPrice) && eff(r) === bestPrice }));
}

// Закупка с учётом своих цен городов: свои цены — как есть, рыночные — с комиссией. undefined — своих цен нет (расчёт идёт по рынку)
export function bestBuy(list, own, cities, fee = SETUP_FEE) {
  if (!own || !Object.keys(own).length) return undefined;
  const rows = cityRows(list, own, cities, fee);
  const top = rows.find((r) => !r.inactive && Number.isFinite(r.effective));
  return top ? { price: top.effective, city: top.city, fromOwn: top.own !== undefined } : undefined;
}
