// План трат фракционных очков: расчёт себестоимости позиций, варианты «деталь за очки / за серебро» и жадный план по профиту на очко.
// Сервер (/api/faction-plan) отдаёт позиции и рыночные цены, весь расчёт — здесь, поэтому любая вписанная цена мгновенно пересчитывает план.
export const HEART_POINTS = 3000;
export const CREST_POINTS = { 4: 400, 5: 2250, 6: 3000, 7: 7500, 8: 15000 };
export const AFTER_MIN_GAIN = 0.05;                      // «после крафта» выбирается, если дешевле прямого на 5% и больше
export const rowKey = (r) => `${r.tier}|${r.enchant}|${r.quality}`;
const has = (v) => v !== null && v !== undefined;

// ctx: { taxRate, setupFeeRate, days, own: {ключ: цена}, limits: {ключ строки: штук}, mode: 'mixed' | 'points' }
// Ключи вписанных цен: mat:<id> (плащ, руны — рыночная цена, к ней добавляется комиссия 2.5%), part:<id> (герб, сердце), sale:<ключ строки> (продажа плаща)
export function computeRow(r, ctx) {
  const own = ctx.own || {};
  const fee = ctx.setupFeeRate;
  const mat = (id, serverPrice) => (has(own[`mat:${id}`]) ? own[`mat:${id}`] * (1 + fee) : serverPrice);
  const capeDirect = mat(r.capeDirect.id, r.capeDirect.price);
  const cape0 = mat(r.cape0.id, r.cape0.price);
  const runes = r.runes.map((x) => ({ ...x, price: mat(x.id, x.price) }));
  const runesOk = runes.length > 0 && runes.every((x) => has(x.price));
  const after = r.enchant > 0 && r.maxAfter && runesOk && has(cape0) ? cape0 + runes.reduce((s, x) => s + x.count * x.price, 0) : null;
  let cost = null;
  let path = null;
  if (r.enchant === 0) { cost = has(capeDirect) ? capeDirect : null; path = 'direct'; }
  else if (!has(capeDirect)) { cost = after; path = after === null ? null : 'after'; }
  else if (after !== null && after <= capeDirect * (1 - AFTER_MIN_GAIN)) { cost = after; path = 'after'; }
  else { cost = capeDirect; path = 'direct'; }
  const saleKey = `sale:${rowKey(r)}`;
  const grossSale = has(own[saleKey]) ? own[saleKey] : (r.sale ? r.sale.avgPrice : null);
  const net = has(grossSale) ? grossSale * (1 - ctx.taxRate - fee) : null;
  const crestKey = `part:${r.crestId}`;
  const heartKey = `part:${r.heartId}`;
  const crestPrice = has(own[crestKey]) ? own[crestKey] : (r.crest ? r.crest.price : null);
  const heartPrice = has(own[heartKey]) ? own[heartKey] : (r.heart ? r.heart.price : null);
  const buy = (p) => (has(p) ? p * (1 + fee) : null);                     // деталь за серебро — свой Buy Order, комиссия 2.5%
  const vol = r.sale && has(r.sale.dailyVolume) ? r.sale.dailyVolume : null;
  const limit = ctx.limits && has(ctx.limits[rowKey(r)]) ? ctx.limits[rowKey(r)] : undefined;
  const cap = limit !== undefined ? limit : vol !== null ? Math.max(Math.floor(vol * ctx.days), 1) : null;   // null — потолок неизвестен
  const pointsAll = HEART_POINTS + CREST_POINTS[r.tier];
  const profitAll = net !== null && cost !== null ? net - cost : null;
  const partsNet = has(crestPrice) && has(heartPrice) ? (crestPrice + heartPrice) * (1 - ctx.taxRate - fee) : null;   // что дала бы продажа деталей вместо крафта
  const variants = [];
  if (profitAll !== null) {
    variants.push({ id: 'all', points: pointsAll, profit: profitAll });
    if (ctx.mode !== 'points') {
      if (buy(heartPrice) !== null) variants.push({ id: 'crest', points: CREST_POINTS[r.tier], profit: profitAll - buy(heartPrice) });    // герб за очки, сердце за серебро
      if (buy(crestPrice) !== null) variants.push({ id: 'heart', points: HEART_POINTS, profit: profitAll - buy(crestPrice) });           // сердце за очки, герб за серебро
    }
  }
  const missing = [];
  if (cost === null) {
    if (r.enchant === 0 || !has(capeDirect)) missing.push({ key: `mat:${r.capeDirect.id}`, id: r.capeDirect.id, label: r.capeDirect.label, hint: 'цена обычного плаща' });
    if (r.enchant > 0 && r.maxAfter) {
      if (!has(cape0)) missing.push({ key: `mat:${r.cape0.id}`, id: r.cape0.id, label: r.cape0.label, hint: 'плащ .0 (путь «после крафта»)' });
      for (const x of runes) if (!has(x.price)) missing.push({ key: `mat:${x.id}`, id: x.id, label: x.label, hint: 'руна, душа или реликт' });
    }
  }
  if (!has(grossSale)) missing.push({ key: saleKey, label: 'Цена продажи плаща', hint: 'своя цена продажи', sale: true });
  if (!has(crestPrice)) missing.push({ key: crestKey, id: r.crestId, label: `Герб T${r.tier}`, hint: 'рыночная цена — для варианта «за серебро» и сравнения с продажей', part: true });
  if (!has(heartPrice)) missing.push({ key: heartKey, id: r.heartId, label: 'Сердце', hint: 'рыночная цена', part: true });
  return { r, key: rowKey(r), cost, path, grossSale, net, profitAll, partsNet, cap, vol, variants, missing, pointsAll, crestPrice, heartPrice };
}

// Жадный план: на каждом шаге берётся лучший «профит на очко» среди вариантов; одна деталь за серебро может позже «дорасти» до варианта «всё за очки».
// На позицию — не больше потолка (оборот × окно истории или свой лимит); в режиме «всё за очки» — только вариант all.
export function buildPlan(computed, { points, mode }) {
  let left = points;
  const state = new Map(computed.map((c) => [c.key, { c, units: [] }]));
  let lastEff = null;
  for (;;) {
    let best = null;
    for (const s of state.values()) {
      const c = s.c;
      if (!c.variants.length) continue;
      const roomLeft = c.cap === null || s.units.length < c.cap;
      const allV = c.variants.find((x) => x.id === 'all');
      const allOk = allV && !(c.partsNet !== null && allV.profit < c.partsNet);          // крафт выгоднее продажи деталей
      if (roomLeft) {
        for (const v of c.variants) {
          if (mode === 'points' && v.id !== 'all') continue;
          if (v.profit <= 0 || v.points > left) continue;
          if (v.id === 'all' && !allOk) continue;
          const eff = v.profit / v.points;
          if (!best || eff > best.eff) best = { s, kind: 'new', v, eff, dPoints: v.points };
        }
      }
      s.units.forEach((u, idx) => {
        if (u.id === 'all' || !allOk) return;
        const dPoints = allV.points - u.points;
        const dProfit = allV.profit - u.profit;
        if (dPoints > left || dPoints <= 0 || dProfit <= 0) return;
        const eff = dProfit / dPoints;
        if (!best || eff > best.eff) best = { s, kind: 'up', idx, v: allV, eff, dPoints };
      });
    }
    if (!best) break;
    if (best.kind === 'new') best.s.units.push(best.v); else best.s.units[best.idx] = best.v;
    left -= best.dPoints;
    lastEff = best.eff;
  }
  const rows = computed.map((c) => {
    const units = state.get(c.key).units;
    const byVariant = {};
    for (const u of units) byVariant[u.id] = (byVariant[u.id] || 0) + 1;
    return { c, byVariant, qty: units.length, points: units.reduce((s, u) => s + u.points, 0), profit: units.reduce((s, u) => s + u.profit, 0) };
  });
  return { rows, left, lastEff };
}

// Сортировка: позиции в плане (зелёные) всегда сверху, внутри групп — по колонке; при равенстве — по профиту за штуку
export function sortPlanRows(rows, { key, dir }) {
  const value = {
    name: (x) => x.c.r.tier * 100 + x.c.r.enchant * 10 + x.c.r.quality, sale: (x) => x.c.grossSale, cost: (x) => x.c.cost, vol: (x) => x.c.vol, profit: (x) => x.c.profitAll,
    points: (x) => x.c.pointsAll, perPoint: (x) => (x.c.profitAll === null ? null : x.c.profitAll / x.c.pointsAll), qty: (x) => x.qty, planPoints: (x) => x.points, planProfit: (x) => x.profit,
  }[key] || ((x) => x.profit);
  const sign = dir === 'asc' ? 1 : -1;
  const cmp = (a, b, sg) => (!has(a) ? (has(b) ? 1 : 0) : !has(b) ? -1 : sg * (a - b));
  return [...rows].sort((a, b) => (b.qty > 0) - (a.qty > 0) || cmp(value(a), value(b), sign) || cmp(a.c.profitAll, b.c.profitAll, -1));
}

// Позиции крафт-листа из плана: позиция с разными способами добычи деталей разбивается на строки (герб и сердце за очки / одна деталь за серебро)
export function planToListItems(rows) {
  const items = [];
  for (const x of rows.filter((r) => r.qty > 0)) {
    for (const [variant, n] of Object.entries(x.byVariant)) {
      items.push({
        itemId: x.c.r.itemId, enchant: x.c.r.enchant, quality: x.c.r.quality, quantity: n, salePrice: x.c.grossSale,
        after: x.c.r.enchant > 0 && x.c.path === 'after', crestSilver: variant === 'heart', heartSilver: variant === 'crest', faction: true,
      });
    }
  }
  return items;
}
