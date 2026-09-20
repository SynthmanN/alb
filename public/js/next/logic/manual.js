// Свои цены и план продажи: пересчёт ответа /api/craft-calc на месте, без запроса (перенос логики старого калькулятора без изменений).
// Свои цены на материалы (в т.ч. из лога закупок), своя цена мгновенной продажи и своя цена города пересчитывают себестоимость, профит,
// «купить или переработать» и план продажи по городам.
const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
export const PROFIT_STRATEGY_HORIZON = 1.5;     // «в пределах разумного»: при стратегии «профит» город держит партию до 1.5× срока равномерного плана

// Лог закупок: реально купленные стаки → средняя цена и сколько уже куплено
export function lotsAverage(lots) {
  let qty = 0;
  let sum = 0;
  for (const l of lots || []) if (l.qty > 0 && l.price >= 0) { qty += l.qty; sum += l.qty * l.price; }
  return qty > 0 ? { qty, avg: sum / qty } : null;
}

// ctx: { ownPrice(resource) → цена | undefined, hasOwn: bool, sellPrice: число | null, cityPrices: { город: цена } }
export function applyManualPrices(data, ctx) {
  const own = ctx.ownPrice || (() => undefined);
  const cityPrices = ctx.cityPrices || {};
  const sellPrice = ctx.sellPrice === undefined ? null : ctx.sellPrice;
  const hasCity = Object.keys(cityPrices).length > 0;
  if (!ctx.hasOwn && sellPrice === null && !hasCity) return data;
  const d = { ...data, recipe: data.recipe.map((r) => ({ ...r })) };
  let materialDelta = 0;                 // изменение себестоимости за штуку от своих цен на материалы рецепта (с учётом возврата)
  let nominalDelta = 0;
  for (const r of d.recipe) {
    if (r.cheapestPrice === null || r.materialSource === 'points') continue;
    const oldPrice = r.cheapestPrice;
    // Своя цена сырья или полуфабриката предыдущего тира (из плана закупки) тоже пересчитывает «купить или переработать»
    const ownComp = r.refineOption ? r.refineOption.components.some((cp) => own(cp.id) !== undefined) : false;
    if (ownComp && r.refineOption) {
      const rate = r.refineOption.rate;
      const rawCost = r.refineOption.components.reduce((sum, cp) => { const o = own(cp.id); return sum + cp.count * (o !== undefined ? o : cp.price); }, 0);
      const alt = rawCost * (1 - rate);
      const buy = r.materialSource === 'refine' ? r.buyPrice : r.cheapestPrice;
      r.refineOption = { ...r.refineOption, rate, rawCost, price: alt };
      if (buy === null || alt <= buy * 0.95) { r.materialSource = 'refine'; r.cheapestPrice = alt; r.cheapestCity = r.refineOption.city; r.priceSource = 'refine'; r.buyPrice = buy; }   // выгода меньше 5% — не переработка
      else { r.materialSource = 'buy'; r.cheapestPrice = buy; r.cheapestCity = r.buyCity; r.priceSource = null; }
    }
    const o = own(r.resource);
    const p = o !== undefined ? o : r.cheapestPrice;
    const factor = r.returnable === false ? 1 : 1 - (r.rrr || 0);
    materialDelta += (p * factor - oldPrice * factor) * r.count;
    nominalDelta += (p - oldPrice) * r.count;
    if (o !== undefined && p !== r.cheapestPrice) { r.marketPrice = r.cheapestPrice; r.cheapestPrice = p; r.manualPrice = true; }   // рыночная цена остаётся серой подсказкой в поле
  }
  const baseFlow = data.enchantAfterCraft || data.baseChoice;
  let stepsDelta = 0;
  if (data.enchantAfterCraft) {
    d.enchantAfterCraft = { ...data.enchantAfterCraft, steps: data.enchantAfterCraft.steps.map((st) => ({ ...st })) };
    for (const st of d.enchantAfterCraft.steps) {
      const p = own(st.materialId);
      if (p === undefined || st.cheapestPrice === null) continue;
      stepsDelta += (p - st.cheapestPrice) * st.count;
      st.cheapestPrice = p;
      st.cost = p * st.count;
      st.manualPrice = true;
    }
    d.enchantAfterCraft.stepsCostPerUnit = data.enchantAfterCraft.stepsCostPerUnit + stepsDelta;
  }
  let effective;
  if (baseFlow) {
    // База .0: снова выбираем «купить или скрафтить» — с учётом своих цен на материалы
    const craft = baseFlow.baseCraftCostPerUnit === null ? null : baseFlow.baseCraftCostPerUnit + materialDelta;
    const buy = baseFlow.baseBuy ? baseFlow.baseBuy.price : null;
    const source = buy !== null && (craft === null || buy < craft) ? 'buy' : 'craft';
    const baseCost = source === 'buy' ? buy : craft;
    const copy = { ...baseFlow, baseCraftCostPerUnit: craft, baseSource: source, baseCostPerUnit: baseCost };
    if (data.enchantAfterCraft) d.enchantAfterCraft = { ...d.enchantAfterCraft, ...copy };
    else d.baseChoice = copy;
    effective = baseCost + (data.enchantAfterCraft ? d.enchantAfterCraft.stepsCostPerUnit : 0);
  } else {
    effective = data.effectiveCostPerUnit + materialDelta;
  }
  const costDelta = effective - data.effectiveCostPerUnit;
  d.effectiveCostPerUnit = effective;
  d.materialCostPerUnit = data.materialCostPerUnit + nominalDelta;
  d.totalCost = effective * data.quantity;
  // Мгновенная продажа: своя цена вместо лучшей из ордеров
  if (sellPrice !== null) {
    const rate = data.bestSell && data.bestSell.taxRate !== undefined ? data.bestSell.taxRate : data.taxRate;
    d.bestSell = { ...(data.bestSell || { city: 'своя цена', blackMarket: false }), price: sellPrice, taxRate: rate, manual: true };
    d.netSellPrice = sellPrice * (1 - rate);
  }
  d.profitPerUnit = d.netSellPrice === null || d.netSellPrice === undefined ? null : d.netSellPrice - effective;
  d.totalProfit = d.profitPerUnit === null ? null : d.profitPerUnit * data.quantity;
  // Терпеливая продажа: цены продажи те же, но себестоимость другая — профит городов, плана и итога сдвигается на разницу;
  // своя цена города заменяет среднюю цену истории и пересчитывает чистую цену и профит города.
  if (data.patientSell && (costDelta !== 0 || hasCity)) {
    const ps = { ...data.patientSell };
    const index = (profit, vol) => (profit > 0 && effective > 0 ? ((profit / effective) * 100) * Math.log2(2 + vol) : 0);
    ps.byCity = ps.byCity.map((c) => {
      if (has(cityPrices, c.city)) {
        const net = cityPrices[c.city] * (1 - c.taxRate);
        const profit = net - effective;
        return { ...c, avgSellPrice: cityPrices[c.city], netPrice: net, profitPerUnit: profit, profitIndex: index(profit, c.avgDailyVolume), ownPrice: true };
      }
      if (c.noData) return c;
      const profit = c.profitPerUnit - costDelta;
      return { ...c, profitPerUnit: profit, profitIndex: index(profit, c.avgDailyVolume) };
    });
    ps.profitPerUnit = data.patientSell.profitPerUnit - costDelta;
    if (ps.plan) ps.plan = { ...ps.plan, profitPerUnit: ps.plan.profitPerUnit === undefined ? undefined : ps.plan.profitPerUnit - costDelta };
    d.patientSell = ps;
  }
  d.manualPrices = !!ctx.hasOwn || sellPrice !== null || hasCity;
  return d;
}

// Автоплан по обороту, когда сервер плана не прислал (порог продажи и т. п.)
export function salePlanByCity(byCity, quantity, marketShare, minPrice) {
  const eligible = byCity.filter((c) => c.avgDailyVolume > 0 && (minPrice === null || c.avgSellPrice >= minPrice));
  const totalVolume = eligible.reduce((sum, c) => sum + c.avgDailyVolume, 0);
  if (eligible.length === 0 || totalVolume <= 0) return { rows: new Map(), totalVolume: 0, days: null };
  const rows = new Map();
  let assigned = 0;
  eligible.forEach((c) => {
    const qty = Math.floor((quantity * c.avgDailyVolume) / totalVolume);
    rows.set(c.city, { qty, days: null });
    assigned += qty;
  });
  const top = eligible.reduce((a, b) => (b.avgDailyVolume > a.avgDailyVolume ? b : a));    // остаток округления — самому ликвидному
  rows.get(top.city).qty += quantity - assigned;
  eligible.forEach((c) => { const r = rows.get(c.city); r.days = r.qty / (c.avgDailyVolume * marketShare); });
  return { rows, totalVolume, days: quantity / (totalVolume * marketShare) };
}

// Раздача остатка партии свободным городам. 'even' — пропорционально обороту (срок продажи у всех одинаковый);
// 'profit' — жадно: города с лучшим ИНДЕКСОМ ПРОФИТА (профит% × log2(2 + оборот)) берут партию первыми, но не больше своей «разумной вместимости».
export function distributeQty(free, remaining, marketShare, strategy) {
  const out = new Map();
  if (free.length === 0) return out;
  const spread = (list, amount) => {
    const volume = list.reduce((sum, c) => sum + c.avgDailyVolume, 0);
    let assigned = 0;
    list.forEach((c) => { const q = Math.floor((amount * c.avgDailyVolume) / volume); out.set(c.city, (out.get(c.city) || 0) + q); assigned += q; });
    const top = list.reduce((a, b) => (b.avgDailyVolume > a.avgDailyVolume ? b : a));
    out.set(top.city, (out.get(top.city) || 0) + amount - assigned);
  };
  if (strategy !== 'profit') { spread(free, remaining); return out; }
  const evenDays = remaining / (free.reduce((sum, c) => sum + c.avgDailyVolume, 0) * marketShare);
  let left = remaining;
  [...free].sort((a, b) => (b.profitIndex ?? 0) - (a.profitIndex ?? 0) || b.profitPerUnit - a.profitPerUnit).forEach((c) => {
    const capacity = Math.floor(c.avgDailyVolume * marketShare * evenDays * PROFIT_STRATEGY_HORIZON);
    const q = Math.min(capacity, left);
    out.set(c.city, q);
    left -= q;
  });
  if (left > 0) spread(free, left);
  return out;
}

// Итоговый план продажи: города включаются чекбоксом, партия делится между включёнными по стратегии; поверх можно вписать своё количество
// в любой город (он фиксируется, остальные делят остаток). st: { toggles: {город: bool} | null, manualQty: {город: штук}, strategy }
export function salePlanState(p, data, st) {
  if (!p.byCity || p.byCity.length === 0) return null;
  const toggles = st.toggles || {};
  const manualQty = st.manualQty || {};
  const minPrice = p.threshold ? p.threshold.value : null;
  const marketShare = p.marketShare ?? 1;
  const serverPlan = p.plan && p.plan.cities.length ? p.plan : null;
  const auto = serverPlan
    ? { rows: new Map(serverPlan.cities.map((c) => [c.city, { qty: c.qty, days: c.days, tolerance: c.tolerance }])), days: serverPlan.totalDays }
    : salePlanByCity(p.byCity, data.quantity, marketShare, minPrice);
  const anyToggle = Object.keys(toggles).length > 0;
  const enabledOf = (c) => (has(toggles, c.city) ? toggles[c.city] : auto.rows.has(c.city));
  const sellable = (c) => (c.avgDailyVolume > 0 || has(manualQty, c.city)) && c.avgSellPrice !== null;    // город без оборота — только с вписанным количеством и ценой
  const enabled = p.byCity.filter((c) => sellable(c) && enabledOf(c));
  let baseQty;
  if (anyToggle || st.strategy === 'profit') {
    const fixed = enabled.filter((c) => has(manualQty, c.city));
    const free = enabled.filter((c) => !has(manualQty, c.city));
    const remaining = Math.max(data.quantity - fixed.reduce((sum, c) => sum + manualQty[c.city], 0), 0);
    baseQty = distributeQty(free, remaining, marketShare, st.strategy);
  } else {
    baseQty = new Map([...auto.rows].map(([city, r]) => [city, r.qty]));
  }
  const rowsData = p.byCity.map((c) => {
    const a = auto.rows.get(c.city);
    const isEnabled = enabledOf(c) && sellable(c);
    const manual = has(manualQty, c.city) && isEnabled;
    const qty = !isEnabled ? 0 : manual ? manualQty[c.city] : (baseQty.get(c.city) || 0);
    const days = qty > 0 && c.avgDailyVolume > 0 ? qty / (c.avgDailyVolume * marketShare) : 0;
    return { c, qty, days, manual, tolerance: a ? a.tolerance : null, inPlan: !!a, enabled: isEnabled };
  });
  const totalQty = rowsData.reduce((sum, r) => sum + r.qty, 0);
  const planDays = rowsData.reduce((m, r) => Math.max(m, r.days), 0);      // города продают параллельно — срок по самому медленному
  const avgPrice = totalQty > 0 ? rowsData.reduce((sum, r) => sum + (r.c.avgSellPrice || 0) * r.qty, 0) / totalQty : null;
  const cityNet = (c) => (c.netPrice !== undefined ? c.netPrice : c.avgSellPrice * (1 - data.taxRate - (data.setupFeeRate || 0)));   // налог у каждого города свой
  const netPrice = avgPrice === null ? null : rowsData.reduce((sum, r) => sum + cityNet(r.c) * r.qty, 0) / totalQty;
  const profitUnit = netPrice === null ? null : netPrice - data.effectiveCostPerUnit;
  const anyManual = rowsData.some((r) => r.manual) || anyToggle;
  const noVolume = rowsData.some((r) => r.qty > 0 && !(r.c.avgDailyVolume > 0));
  return { minPrice, marketShare, serverPlan, auto, anyManual, rowsData, totalQty, planDays, avgPrice, netPrice, profitUnit, noVolume };
}
