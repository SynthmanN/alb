// Кандидаты входа в цепочку зачарования: раньше был только один путь — сделать/купить .0 и пройти всю цепочку рунами→душами→
// реликтами. На деле каждый промежуточный уровень (.1, .2) тоже продаётся на рынке отдельно — можно купить уже зачарованный
// предмет и докрутить только оставшимися шагами. Общая версия для сервера (server.js) и клиента (план фракции, logic/factionPlan.js) —
// пропускать уровни нельзя, возврата на руны/души/реликты нет (подтверждено пользователем), поэтому шаг — просто количество × цена.
// entryCosts: { 0: number|null, 1: ..., ... } — себестоимость входа на уровне (для >0 — цена покупки предмета этого уровня на рынке);
// stepCosts: { 1: number|null, 2: ..., 3: ... } — цена ОДНОГО шага level-1→level. Кандидаты — по возрастанию себестоимости;
// пустой массив — нет ни одной цены входа с полным набором шагов до target.
export function enchantChainCandidates(entryCosts, stepCosts, target) {
  const out = [];
  for (let entry = 0; entry < target; entry++) {
    const entryCost = entryCosts[entry];
    if (entryCost === null || entryCost === undefined) continue;
    let total = entryCost;
    let ok = true;
    for (let lvl = entry + 1; lvl <= target; lvl++) {
      const stepCost = stepCosts[lvl];
      if (stepCost === null || stepCost === undefined) { ok = false; break; }
      total += stepCost;
    }
    if (ok) out.push({ entryLevel: entry, cost: total });
  }
  return out.sort((a, b) => a.cost - b.cost);
}

// Ручной выбор пути «после крафта» (выпадающий список рецептов + тумблер «только основной рецепт» в calc-buy.js): пересчитывает
// уже посчитанный ответ /api/craft-calc НА МЕСТЕ, теми же кандидатами, что сервер уже прислал (eac.candidates) — без нового
// запроса, тем же приёмом, что и «своя цена» (logic/manual.js). choice: { entryLevel: число|null, forceMain: bool }.
// forceMain — вход строго с нуля (entryLevel 0), даже если сервер выбрал другой; entryLevel — конкретный вход из candidates;
// оба не заданы (или совпадают с уже выбранным сервером) — данные не трогаются, идёт автовыбор сервера как раньше.
export function applyChainChoice(data, choice) {
  const eac = data && data.enchantAfterCraft;
  if (!eac || !choice) return data;
  const entryLevel = choice.forceMain ? 0 : choice.entryLevel;
  if (entryLevel === undefined || entryLevel === null || entryLevel === eac.chainEntryLevel) return data;
  const picked = (eac.candidates || []).find((c) => c.entryLevel === entryLevel);
  if (!picked || picked.cost === null || picked.cost === undefined) return data;    // нет такого кандидата (или без цены) — не трогаем
  const neededSteps = eac.steps.filter((st) => st.level > entryLevel);
  const newEac = {
    ...eac, chainEntryLevel: entryLevel,
    chainEntryId: entryLevel > 0 ? `${data.itemId}@${entryLevel}` : null,
    chainEntryLabel: entryLevel > 0 ? picked.entryLabel : null,
    chainEntryCity: entryLevel > 0 ? picked.entryCity : null,
    neededSteps, stepsCostPerUnit: picked.cost - picked.entryPrice,
    manualChoice: true,
  };
  return { ...data, enchantAfterCraft: newEac, effectiveCostPerUnit: picked.cost, totalCost: picked.cost * data.quantity };
}

// Смешанные рецепты в калькуляторе одной вещи: у «после крафта» бывает несколько вариантов базы — .0 (data0, вся цепочка) и по одному
// на каждый уровень .L (hybrids[L]: база из зачарованного сырья .L, докрутка только L+1..цель). Автовыбор — самая дешёвая полная себестоимость
// (продажа у всех вариантов одна); choice.baseLevel — ручной выбор из дропдауна, choice.forceMain — только основной (база .0).
export function pickVariant(data0, hybrids, choice) {
  const all = { 0: data0, ...(hybrids || {}) };
  const usable = (d) => d && !d.error && d.enchantAfterCraft && d.hasAllMaterialPrices !== false && d.effectiveCostPerUnit !== null && d.effectiveCostPerUnit !== undefined;
  const wanted = choice && choice.forceMain ? 0 : choice && choice.baseLevel !== null && choice.baseLevel !== undefined ? choice.baseLevel : null;
  if (wanted !== null && all[wanted] && !all[wanted].error) return { level: wanted, data: all[wanted] };
  let best = null;
  for (const [lvl, d] of Object.entries(all)) if (usable(d) && (!best || d.effectiveCostPerUnit < best.data.effectiveCostPerUnit)) best = { level: Number(lvl), data: d };
  return best || { level: 0, data: data0 };
}
