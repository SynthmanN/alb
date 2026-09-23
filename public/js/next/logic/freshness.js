// Свежесть данных для позиции: собирает id всех материалов (сырьё, полуфабрикаты, руны/души/реликты, герб и сердце — если не за
// очки) и самого предмета (для его цены продажи) из уже посчитанного ответа /api/craft-calc — той же логики резолва рецепта,
// которой уже считает крафт-лист и стек. Дальше список уходит в /api/freshness (сервер сам смотрит в кувшин, ничего не пересчитывая).
// Map: id → { name, quality, kind } — kind различает САМ ПРЕДМЕТ ('self', проверяется по patientSell.byCity — сделка за
// «Историю гира» этого качества) и МАТЕРИАЛЫ ('material', проверяется как materialPriceQuotes — котировка или сделка за
// «Историю сырья», качество всегда 1, как и everywhere в проекте).
// selfLabel(d) — имя самого предмета: d.names не всегда его знает (каталог названий гира — только у клиента), вызывающая
// сторона может передать резолвер (например, itemLabel(d.itemId)); без него имя остаётся голым id.
export function collectIds(d, out = new Map(), selfLabel) {
  if (!d || d.error) return out;
  const add = (id, name, quality = 1, kind = 'material') => { if (id && !out.has(id)) out.set(id, { name: name || id, quality, kind }); };
  add(d.finishedQueryId || d.itemId, (d.names && d.names[d.finishedQueryId]) || (selfLabel && selfLabel(d)), d.quality || 1, 'self');
  for (const r of d.recipe || []) {
    if (r.materialSource === 'points') continue;                                    // за очки — цены не бывает, обновлять нечего
    const id = r.queryId || r.resource;
    add(id, (d.names && d.names[id]) || r.resourceName);
    for (const cp of (r.refineOption && r.refineOption.components) || []) add(cp.id, (d.names && d.names[cp.id]));
    for (const cp of (r.craftOption && r.craftOption.components) || []) add(cp.id, (d.names && d.names[cp.id]));
  }
  const eac = d.enchantAfterCraft;
  if (eac) {
    // готовая база .0, если её покупают, а не крафтят: d.itemId — это тот же гир, что и главный «self»-предмет строки (просто
    // без зачарования), каталог названий гира — только у клиента, поэтому имя нужно тем же резолвером, что и выше (d.names
    // его не знает — сервер отдаёт названия только для материалов, не для гира); без этого падения на selfLabel строка
    // «Свежести данных» показывала голый id (T5_HEAD_LEATHER_SET3) вместо «Капюшон убийцы».
    if (eac.baseBuy) add(d.itemId, (d.names && d.names[d.itemId]) || (selfLabel && selfLabel(d)));
    for (const st of eac.steps || []) add(st.materialId, st.materialName);
  }
  return out;
}

// Собирает id по всем позициям стека/листа сразу (Map: id → {name, quality, kind}) — то, что показывается в окне «Свежесть данных»
export function collectAllIds(results, selfLabel) {
  const out = new Map();
  for (const d of results.values()) collectIds(d, out, selfLabel);
  return out;
}

// Фракционный план: id для позиций, которые реально вошли в план (qty > 0, x.c — результат computeRow из logic/factionPlan.js) —
// путь, который сейчас выбран (прямой или «после крафта», не оба сразу — второй для плана всё равно не нужен), герб и сердце
// (нужны всегда — их цена участвует в сравнении «всё за очки» с «деталь за серебро», даже если сейчас выбрано «всё за очки»)
// и сам плащ (id для цены продажи; каталог названий предметов — только у клиента, поэтому имя берёт finishedLabel(r), если дали;
// качество плаща — r.quality, у гербов/сердец/материалов качества нет — всегда 1, kind — 'material').
export function collectFactionIds(planned, out = new Map(), finishedLabel) {
  const add = (id, name, quality = 1, kind = 'material') => { if (id && !out.has(id)) out.set(id, { name: name || id, quality, kind }); };
  for (const x of planned) {
    const r = x.c.r;
    add(r.finishedId, finishedLabel && finishedLabel(r), r.quality || 1, 'self');
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
