// Свежесть данных для позиции: собирает id всех материалов (сырьё, полуфабрикаты, руны/души/реликты, герб и сердце — если не за
// очки) и самого предмета (для его цены продажи) из уже посчитанного ответа /api/craft-calc — той же логики резолва рецепта,
// которой уже считает крафт-лист и стек. Дальше список уходит в /api/freshness (сервер сам смотрит в кувшин, ничего не пересчитывая).
export function collectIds(d, out = new Map()) {
  if (!d || d.error) return out;
  const add = (id, label) => { if (id && !out.has(id)) out.set(id, label || id); };
  add(d.finishedQueryId || d.itemId, (d.names && d.names[d.finishedQueryId]) || undefined);
  for (const r of d.recipe || []) {
    if (r.materialSource === 'points') continue;                                    // за очки — цены не бывает, обновлять нечего
    const id = r.queryId || r.resource;
    add(id, (d.names && d.names[id]) || r.resourceName);
    for (const cp of (r.refineOption && r.refineOption.components) || []) add(cp.id, (d.names && d.names[cp.id]));
    for (const cp of (r.craftOption && r.craftOption.components) || []) add(cp.id, (d.names && d.names[cp.id]));
  }
  const eac = d.enchantAfterCraft;
  if (eac) {
    if (eac.baseBuy) add(d.itemId, (d.names && d.names[d.itemId]));                  // готовая база .0, если её покупают, а не крафтят
    for (const st of eac.steps || []) add(st.materialId, st.materialName);
  }
  return out;
}

// Собирает id по всем позициям стека/листа сразу (Map: id → название) — то, что реально показывается в окне «Свежесть данных»
export function collectAllIds(results) {
  const out = new Map();
  for (const d of results.values()) collectIds(d, out);
  return out;
}
