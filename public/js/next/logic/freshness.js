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

// Фракционный план: id для позиций, которые реально вошли в план (qty > 0, x.c — результат computeRow из logic/factionPlan.js) —
// путь, который сейчас выбран (прямой или «после крафта», не оба сразу — второй для плана всё равно не нужен), герб и сердце
// (нужны всегда — их цена участвует в сравнении «всё за очки» с «деталь за серебро», даже если сейчас выбрано «всё за очки»)
// и сам плащ (id для цены продажи; название плаща знает только клиент — вызывающая сторона может переопределить label).
export function collectFactionIds(planned, out = new Map()) {
  const add = (id, label) => { if (id && !out.has(id)) out.set(id, label || id); };
  for (const x of planned) {
    const r = x.c.r;
    add(r.finishedId);
    if (x.c.path === 'after') {
      add(r.cape0.id, r.cape0.label);
      for (const rune of r.runes) add(rune.id, rune.label);
    } else {
      add(r.capeDirect.id, r.capeDirect.label);
    }
    add(r.crestId, r.crest && r.crest.label);
    add(r.heartId, r.heart && r.heart.label);
  }
  return out;
}
