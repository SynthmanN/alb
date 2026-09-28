// План закупки по ответу /api/craft-calc: что и где покупать, сколько и почём. Чистые функции — без DOM, их же использует крафт-лист.

// Возвращает { rows, lines }.
// rows — строки { id, name, why, needed, have, toBuy, cities: [{ city, qty, price }], unit, sum, missing }: needed — сколько всего надо, have — сколько
// закрыто твоими материалами (pool из logic/inventory.js), toBuy — сколько докупить; города, цена и сумма считаются только на toBuy.
// lines — строки рецепта для «что уже можно скрафтить»: { id, name, needed, covered, via, comps } — covered в штуках этого материала
// (для крафта самому/переработки — с учётом компонентов), comps — строки закупки компонентов.
// nameOf(id) — название материала (ответ сервера знает руны, души, реликты, плащ с зачарованием).
const EPS = 1e-9;
// Оставляем самые дешёвые города, пока не наберётся qty штук (server-план считан на полную потребность)
export function trimCities(cities, qty) {
  if (cities.reduce((s, c) => s + c.qty, 0) <= qty) return cities;                // ничего не режем — порядок сервера сохраняется
  let left = qty;
  const out = [];
  for (const c of [...cities].sort((a, b) => a.price - b.price)) {
    if (left <= 0) break;
    const q = Math.min(c.qty, left);
    if (q > 0) out.push({ ...c, qty: q });
    left -= q;
  }
  return out;
}

// Порог как на сервере (server.js, MIN_ALT_GAIN): переработка/крафт самому вместо покупки — только если дешевле не меньше чем на 5%
export const MIN_ALT_GAIN = 0.05;

// Цена и город покупки готового материала. Если сервер выбрал переработку/крафт, покупная цена лежит в buyPrice, а город — среди cityPrices
export function buyQuote(r) {
  if ((r.materialSource || 'buy') === 'buy') return { price: r.buyPrice || r.cheapestPrice, city: r.cheapestCity };
  if (!(r.buyPrice > 0)) return { price: null, city: null };
  const cheapest = [...(r.cityPrices || [])].sort((a, b) => a.price - b.price)[0];
  return { price: r.buyPrice, city: cheapest ? cheapest.city : null };
}
const compNeeds = (r, kind, rest) => (kind === 'craft'
  ? r.craftOption.components.map((cp) => ({ cp, need: Math.ceil(rest * cp.count * cp.factor) }))
  : r.refineOption.components.map((cp, i) => ({ cp, need: Math.ceil(rest * cp.count * (1 - r.refineOption.rate)), role: i === 0 ? 'raw' : 'prev' })));

// Путь материала рецепта с учётом твоих материалов: купить готовый / переработать / скрафтить самому — по цене того, что придётся докупить.
// Свой готовый полуфабрикат и свои компоненты стоят 0. Без пула (или если свои материалы этого пути не касаются) остаётся выбор сервера;
// другой путь берётся, только если он дешевле выбора сервера не меньше чем на MIN_ALT_GAIN.
export function chooseSource(r, pool) {
  const server = r.materialSource || 'buy';
  if (!pool || server === 'points') return server;
  const kinds = ['buy', ...(r.refineOption ? ['refine'] : []), ...(r.craftOption ? ['craft'] : [])];
  if (kinds.length < 2) return server;
  const rid = r.queryId || r.resource;
  const total = r.neededToBuy;
  const rest = total - Math.min(pool.peek(rid), total);
  const cost = (kind) => {
    if (kind === 'buy') { const q = buyQuote(r); return q.price > 0 ? rest * q.price : Infinity; }
    return compNeeds(r, kind, rest).reduce((sum, { cp, need }) => {
      const left = Math.max(need - pool.peek(cp.id), 0);
      return sum + (left <= 0 ? 0 : cp.price > 0 ? left * cp.price : Infinity);
    }, 0);
  };
  const cur = cost(server);
  let best = server;
  let bestCost = cur;
  for (const kind of kinds) { const v = cost(kind); if (v < bestCost) { best = kind; bestCost = v; } }
  return best !== server && bestCost < cur * (1 - MIN_ALT_GAIN) ? best : server;
}

export function acquisition(data, nameOf = (id) => id, pool = null) {
  const byRes = data.acquire ? data.acquire.byResource : [];
  const planFor = (pick) => byRes.find(pick) || null;
  const names = data.names || {};
  const label = (id) => names[id] || nameOf(id);
  const rows = [];
  const lines = [];
  const push = ({ id, key, why, needed, srv, price, city }) => {
    const have = pool ? pool.take(id, needed) : 0;
    const toBuy = needed - have;
    const plan = srv && srv.plan && srv.plan.cities.length && srv.plan.cities.reduce((s, c) => s + c.qty, 0) === needed ? srv.plan : null;
    let cities;
    let unit;
    if (plan) {
      cities = trimCities(plan.cities.map((c) => ({ city: c.city, qty: c.qty, price: c.avgPrice })), toBuy);
      unit = have > 0 && cities.length ? cities.reduce((s, c) => s + c.qty * c.price, 0) / toBuy : plan.avgPrice;
    } else {
      unit = srv && srv.unitPrice ? srv.unitPrice : price;
      cities = unit === null || unit === undefined || !city || toBuy <= 0 ? [] : [{ city, qty: toBuy, price: unit }];
    }
    const missing = (unit === null || unit === undefined) && (toBuy > 0 || have === 0);
    const noUnit = unit === null || unit === undefined;
    const row = { id, key: key || id, name: label(id), why, needed, have, toBuy, cities, unit: noUnit ? null : unit, sum: missing ? null : cities.reduce((s, c) => s + c.qty * c.price, 0) || (noUnit ? 0 : unit * toBuy), missing, days: srv && srv.daysToAcquire !== undefined ? srv.daysToAcquire : null };
    rows.push(row);
    return row;
  };
  const line = (id, needed, row) => { lines.push({ id, name: label(id), needed, covered: row.have, via: null, comps: [] }); };
  // Полуфабрикат (слиток, кожа, ткань, плащ-ингредиент), который делаем сами: сначала твой готовый, остальное — из компонентов
  const viaComponents = (r, rid, via, build) => {
    const total = r.neededToBuy;
    const got = pool ? pool.take(rid, total) : 0;
    const rest = total - got;
    if (got > 0) rows.push({ id: rid, key: rid, name: label(rid), why: 'твой готовый полуфабрикат', needed: total, have: got, toBuy: 0, cities: [], unit: null, sum: 0, missing: false, days: null, covered: true });
    const comps = build(rest);
    const cov = comps.length ? Math.min(...comps.map((c) => (c.needed > 0 ? c.have / c.needed : 1))) : 0;
    lines.push({ id: rid, name: label(rid), needed: total, covered: got + rest * cov, via, comps });
  };
  const eac = data.enchantAfterCraft;
  // Вход в цепочку зачарования не с нуля (купили уже готовый .1/.2 на рынке, см. server.js enchantChainCandidates) — базовый
  // рецепт .0 тогда вообще ни при чём, в закупку идёт только сама покупка этого уровня и оставшиеся шаги (neededSteps ниже).
  if (eac && eac.chainEntryLevel > 0 && eac.chainEntryId) {
    const entry = (eac.candidates || []).find((c) => c.entryLevel === eac.chainEntryLevel);
    line(eac.chainEntryId, data.quantity, push({ id: eac.chainEntryId, key: eac.chainEntryId, why: `куплено готовым: ${eac.chainEntryLabel}`, needed: data.quantity, srv: planFor((a) => a.resource === eac.chainEntryId), price: entry ? entry.entryPrice : null, city: eac.chainEntryCity }));
  } else if (eac && eac.baseSource === 'buy' && eac.baseBuy) {
    line(data.itemId, data.quantity, push({ id: data.itemId, key: data.itemId, why: 'плащ .0 — выгоднее купить готовый', needed: data.quantity, srv: planFor((a) => a.resource === data.itemId), price: eac.baseBuy.price, city: eac.baseBuy.city }));
  } else if (!eac || eac.chainEntryLevel === 0) {
    for (const r of data.recipe || []) {
      if (r.materialSource === 'points') continue;                       // за очки — в серебре не покупается
      const rid = r.queryId || r.resource;
      const src = chooseSource(r, pool);
      const before = lines.length;
      if (src === 'craft' && r.craftOption) {
        viaComponents(r, rid, 'craft', (rest) => r.craftOption.components.map((cp) => push({ id: cp.id, key: cp.id, why: `для крафта самому: ${label(rid)}`, needed: Math.ceil(rest * cp.count * cp.factor), srv: planFor((a) => a.parent === r.resource && a.source === 'craft' && a.queryId === cp.id), price: cp.price, city: cp.city })));
      } else if (src === 'refine' && r.refineOption) {
        viaComponents(r, rid, 'refine', (rest) => r.refineOption.components.map((cp, i) => {
          const role = i === 0 ? 'raw' : 'prev';
          return push({ id: cp.id, key: cp.id, why: `${role === 'raw' ? 'сырьё' : 'предыдущий тир'} для переработки в ${label(rid)}`, needed: Math.ceil(rest * cp.count * (1 - r.refineOption.rate)), srv: planFor((a) => a.parent === r.resource && a.source === 'refine' && a.role === role), price: cp.price, city: cp.city });
        }));
      } else {
        const q = buyQuote(r);
        line(rid, r.neededToBuy, push({ id: rid, key: rid, why: r.enchanted ? `зачарование .${eac && eac.baseLevel ? eac.baseLevel : data.enchant}` : '', needed: r.neededToBuy, srv: planFor((a) => (a.parent || a.resource) === r.resource && (a.source || 'buy') === 'buy'), price: q.price, city: q.city }));
      }
      if (lines.length > before) Object.assign(lines[lines.length - 1], { source: src, switched: src !== (r.materialSource || 'buy') });
    }
  }
  for (const st of (eac && eac.neededSteps) || (eac && eac.steps) || []) {
    line(st.materialId, st.count * data.quantity, push({ id: st.materialId, key: st.materialId, why: `чары .${st.level - 1} → .${st.level}`, needed: st.count * data.quantity, srv: planFor((a) => a.resource === st.materialId), price: st.cheapestPrice, city: st.cheapestCity }));
  }
  return { rows, lines };
}

export const acquisitionRows = (data, nameOf, pool) => acquisition(data, nameOf, pool).rows;

// Строка закупки по своей цене (ov: { price, city? }): цена и сумма пересчитываются, если задан город — вся партия идёт в него
export function withOverride(row, ov) {
  if (!ov) return row;
  const qty = row.toBuy ?? row.needed;
  return { ...row, unit: ov.price, cities: ov.city && qty > 0 ? [{ city: ov.city, qty, price: ov.price }] : row.cities, sum: ov.price * qty, missing: false, manual: !ov.picked, picked: !!ov.picked };
}

// Строки, где не хватает цены материала (можно вписать свою)
export const missingRows = (rows) => rows.filter((r) => r.missing);

// Сводка нескольких позиций: одинаковые материалы складываются, города объединяются
export function mergeRows(list) {
  const map = new Map();
  for (const rows of list) {
    for (const r of rows) {
      const e = map.get(r.id) || { id: r.id, key: r.key || r.id, name: r.name, needed: 0, have: 0, toBuy: 0, cities: new Map(), missing: false };
      e.needed += r.needed;
      e.have += r.have || 0;
      e.toBuy += r.toBuy ?? r.needed;
      if (r.missing) e.missing = true;
      for (const c of r.cities) {
        if (!(c.qty > 0) || !Number.isFinite(c.price)) continue;                       // город без штук или без цены в сводку не идёт
        const cur = e.cities.get(c.city) || { qty: 0, cost: 0 };
        cur.qty += c.qty; cur.cost += c.qty * c.price;
        e.cities.set(c.city, cur);
      }
      map.set(r.id, e);
    }
  }
  return [...map.values()].map((e) => {
    const cities = [...e.cities.entries()].map(([city, c]) => ({ city, qty: c.qty, price: c.cost / c.qty }));
    return { id: e.id, key: e.key, name: e.name, needed: e.needed, have: e.have, toBuy: e.toBuy, cities, sum: cities.reduce((s, c) => s + c.qty * c.price, 0), missing: e.missing };
  }).sort((a, b) => b.sum - a.sum);
}

// Порядок закупки «по городам»: покупки одного города идут подряд, чтобы в городе видеть по порядку всё, что здесь купить.
// Строка относится к городу, где её основная часть (больше всего штук; при равенстве — по сумме); строка из нескольких городов стоит один раз, в основном.
// Города — по алфавиту (предсказуемо), внутри города — дороже выше; строки без города (нет цены) — в конце. Входные строки не меняются.
export const primaryCity = (row) => {
  let best = null;
  for (const c of row.cities || []) if (!best || c.qty > best.qty || (c.qty === best.qty && c.qty * c.price > best.qty * best.price)) best = c;
  return best ? best.city : null;
};
export function sortByCity(rows, rowOf = (x) => x) {
  return [...rows].sort((a, b) => {
    const ra = rowOf(a); const rb = rowOf(b);
    const ca = primaryCity(ra); const cb = primaryCity(rb);
    if (ca !== cb) return ca === null ? 1 : cb === null ? -1 : ca.localeCompare(cb, 'ru');
    return (rb.sum || 0) - (ra.sum || 0);
  });
}
