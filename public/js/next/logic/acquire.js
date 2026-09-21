// План закупки по ответу /api/craft-calc: что и где покупать, сколько и почём. Чистые функции — без DOM, их же использует крафт-лист.

// Возвращает строки { id, name, why, needed, cities: [{ city, qty, price }], unit, sum, missing }.
// nameOf(id) — название материала (ответ сервера знает руны, души, реликты, плащ с зачарованием).
export function acquisitionRows(data, nameOf = (id) => id) {
  const byRes = data.acquire ? data.acquire.byResource : [];
  const planFor = (pick) => byRes.find(pick) || null;
  const names = data.names || {};
  const label = (id) => names[id] || nameOf(id);
  const rows = [];
  const push = ({ id, key, why, needed, srv, price, city }) => {
    const plan = srv && srv.plan && srv.plan.cities.length && srv.plan.cities.reduce((s, c) => s + c.qty, 0) === needed ? srv.plan : null;
    let cities;
    let unit;
    if (plan) {
      cities = plan.cities.map((c) => ({ city: c.city, qty: c.qty, price: c.avgPrice }));
      unit = plan.avgPrice;
    } else {
      unit = srv && srv.unitPrice ? srv.unitPrice : price;
      cities = unit === null || unit === undefined || !city ? [] : [{ city, qty: needed, price: unit }];
    }
    const missing = unit === null || unit === undefined;
    rows.push({ id, key: key || id, name: label(id), why, needed, cities, unit: missing ? null : unit, sum: missing ? null : cities.reduce((s, c) => s + c.qty * c.price, 0) || unit * needed, missing, days: srv && srv.daysToAcquire !== undefined ? srv.daysToAcquire : null });
  };
  const eac = data.enchantAfterCraft;
  if (eac && eac.baseSource === 'buy' && eac.baseBuy) {
    push({ id: data.itemId, key: data.itemId, why: 'плащ .0 — выгоднее купить готовый', needed: data.quantity, srv: planFor((a) => a.resource === data.itemId), price: eac.baseBuy.price, city: eac.baseBuy.city });
  } else {
    for (const r of data.recipe || []) {
      if (r.materialSource === 'points') continue;                       // за очки — в серебре не покупается
      const rid = r.queryId || r.resource;
      if (r.materialSource === 'craft' && r.craftOption) {
        for (const cp of r.craftOption.components) {
          push({ id: cp.id, key: cp.id, why: `для крафта: ${label(rid)}`, needed: Math.ceil(r.neededToBuy * cp.count * cp.factor), srv: planFor((a) => a.parent === r.resource && a.source === 'craft' && a.queryId === cp.id), price: cp.price, city: cp.city });
        }
      } else if (r.materialSource === 'refine' && r.refineOption) {
        r.refineOption.components.forEach((cp, i) => {
          const role = i === 0 ? 'raw' : 'prev';
          push({ id: cp.id, key: cp.id, why: `${role === 'raw' ? 'сырьё' : 'предыдущий тир'} → ${label(rid)}`, needed: Math.ceil(r.neededToBuy * cp.count * (1 - r.refineOption.rate)), srv: planFor((a) => a.parent === r.resource && a.source === 'refine' && a.role === role), price: cp.price, city: cp.city });
        });
      } else {
        push({ id: rid, key: rid, why: r.enchanted ? `зачарование .${data.enchant}` : '', needed: r.neededToBuy, srv: planFor((a) => (a.parent || a.resource) === r.resource && (a.source || 'buy') === 'buy'), price: r.buyPrice || r.cheapestPrice, city: r.cheapestCity });
      }
    }
  }
  for (const st of (eac && eac.steps) || []) {
    push({ id: st.materialId, key: st.materialId, why: `чары .${st.level - 1} → .${st.level}`, needed: st.count * data.quantity, srv: planFor((a) => a.resource === st.materialId), price: st.cheapestPrice, city: st.cheapestCity });
  }
  return rows;
}

// Строка закупки по своей цене (ov: { price, city? }): цена и сумма пересчитываются, если задан город — вся партия идёт в него
export function withOverride(row, ov) {
  if (!ov) return row;
  return { ...row, unit: ov.price, cities: ov.city ? [{ city: ov.city, qty: row.needed, price: ov.price }] : row.cities, sum: ov.price * row.needed, missing: false, manual: true };
}

// Строки, где не хватает цены материала (можно вписать свою)
export const missingRows = (rows) => rows.filter((r) => r.missing);

// Сводка нескольких позиций: одинаковые материалы складываются, города объединяются
// owners[i] — описание позиции, которой принадлежат rows list[i]: в строке сводки остаётся, для каких позиций и сколько нужно
export function mergeRows(list, owners = []) {
  const map = new Map();
  list.forEach((rows, i) => {
    for (const r of rows) {
      const e = map.get(r.id) || { id: r.id, key: r.key || r.id, name: r.name, needed: 0, cities: new Map(), missing: false, uses: [] };
      if (owners[i]) e.uses.push({ owner: owners[i], needed: r.needed, why: r.why || '' });
      e.needed += r.needed;
      if (r.missing) e.missing = true;
      for (const c of r.cities) {
        if (!(c.qty > 0) || !Number.isFinite(c.price)) continue;                       // город без штук или без цены в сводку не идёт
        const cur = e.cities.get(c.city) || { qty: 0, cost: 0 };
        cur.qty += c.qty; cur.cost += c.qty * c.price;
        e.cities.set(c.city, cur);
      }
      map.set(r.id, e);
    }
  });
  return [...map.values()].map((e) => {
    const cities = [...e.cities.entries()].map(([city, c]) => ({ city, qty: c.qty, price: c.cost / c.qty }));
    return { id: e.id, key: e.key, name: e.name, needed: e.needed, uses: e.uses, cities, sum: cities.reduce((s, c) => s + c.qty * c.price, 0), missing: e.missing };
  }).sort((a, b) => b.sum - a.sum);
}
