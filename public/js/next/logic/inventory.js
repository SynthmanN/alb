// Мои материалы: что у игрока уже есть, сколько докупить и сколько штук каждого гира можно скрафтить прямо сейчас.
// Чистая логика без DOM. Общий пул материалов раздаётся позициям по порядку (жадно): первая позиция берёт своё, остаток — следующей.
import { acquisition } from './acquire.js';
import { pickAfter } from './stack.js';

const EPS = 1e-9;

// have — { id: количество }; пустые и нулевые значения игнорируются
export function makePool(have = {}) {
  const left = {};
  for (const [id, v] of Object.entries(have || {})) {
    const n = Math.floor(Number(v));
    if (n > 0) left[id] = n;
  }
  return {
    take(id, n) {
      const g = Math.min(left[id] || 0, Math.max(n, 0));
      if (g > 0) left[id] -= g;
      return g;
    },
    peek: (id) => left[id] || 0,
    left: () => ({ ...left }),
    clone: () => makePool(left),
  };
}

export const hasHave = (have) => Object.values(have || {}).some((v) => Math.floor(Number(v)) > 0);

// Доля рецепта, закрытая материалами: 0..1 (по самому нехватающему материалу)
export const coverage = (lines) => (lines.length ? Math.min(...lines.map((l) => (l.needed > 0 ? Math.min(l.covered / l.needed, 1) : 1))) : 1);

// Сколько штук из quantity можно скрафтить уже сейчас. Потребность — с учётом возврата ресурсов, как во всём калькуляторе.
export function craftableNow(lines, quantity) {
  return Math.min(quantity, Math.max(Math.floor(quantity * coverage(lines) + EPS), 0));
}

const cashOf = (rows) => rows.reduce((s, r) => s + (r.sum || 0), 0);

// Сколько серебра экономят твои материалы для этого варианта рецепта: рыночная закупка минус закупка того, что не хватает.
// Пул не меняется (считаем на копии) — так варианты одной вещи можно сравнивать между собой.
export function ownedGain(data, nameOf, pool) {
  if (!pool || !data || data.error || !Object.keys(pool.left()).length) return 0;
  const market = cashOf(acquisition(data, nameOf, null).rows);
  const mine = cashOf(acquisition(data, nameOf, pool.clone()).rows);
  return Math.max(market - mine, 0);
}

// Расчёт одной позиции с пулом: строки закупки, строки рецепта и сколько можно скрафтить
export function allocateItem(data, nameOf, pool) {
  const { rows, lines } = acquisition(data, nameOf, pool);
  const quantity = data.quantity || 1;
  const craftable = craftableNow(lines, quantity);
  const saved = pool && Object.keys(pool.left()).length + rows.reduce((n, r) => n + r.have, 0) > 0 ? Math.max(cashOf(acquisition(data, nameOf, null).rows) - cashOf(rows), 0) : 0;
  return { rows, lines, quantity, craftable, ready: craftable >= quantity, toBuyRows: rows.filter((r) => r.toBuy > 0), recipe: recipeLabel(data), saved, switched: lines.filter((l) => l.switched) };
}

// Распределение по позициям стека: items — включённые позиции по порядку, results — Map uid → ответ калькулятора
export function allocateStack(items, results, have, nameOf) {
  const pool = makePool(have);
  const byUid = new Map();
  for (const it of items) {
    const d = results.get(it.uid);
    if (it.on === false || !d || d.error) continue;
    byUid.set(it.uid, allocateItem(d, nameOf, pool));
  }
  return { byUid, leftover: pool.left() };
}

// Автовыбор рецепта позиций стека с учётом твоих материалов: варианты (прямой, «после крафта», смешанные) сравниваются по профиту плюс
// серебро, которое экономят твои материалы; пул раздаётся позициям по порядку. Возвращает Map uid → { use, level, data } для позиций с вариантами.
export function stackPicks(items, pairs, results, have, nameOf, extra = null) {
  const pool = makePool(have);
  const picks = new Map();
  const owned = hasHave(have);
  for (const it of items) {
    if (it.on === false) continue;
    const pair = pairs.get(it.uid);
    let d = results.get(it.uid);
    if (pair) {
      const own = owned ? (dd) => ownedGain(dd, nameOf, pool) / (dd.quantity || 1) : null;
      const cost = extra ? extra(it) : null;                                       // рерол качества позиции: вычитается из выгоды варианта
      const pick = pickAfter(it, pair, own || cost ? (dd) => (own ? own(dd) : 0) - (cost ? cost(dd) : 0) : null);
      picks.set(it.uid, pick);
      d = pick.data;
    }
    if (d && !d.error) acquisition(d, nameOf, pool);
  }
  return picks;
}

// Название рецепта из ответа калькулятора: прямой крафт, .0 + зачарование или смешанный рецепт с базой .L
export function recipeLabel(d) {
  const e = d && d.enchantAfterCraft;
  if (!e) return d && d.enchant > 0 ? 'Прямой крафт зачарованного' : 'Крафт';
  if (e.baseLevel > 0) return `Зачарованная база .${e.baseLevel} + докрутка до .${e.targetLevel}`;
  return `Крафт .0 + зачарование до .${e.targetLevel}`;
}

// Варианты рецепта одной вещи из уже посчитанных ответов: прямой крафт (сразу зачарованное), «после крафта» с базой .0 и смешанные с базой .L.
// Загружен либо прямой, либо «после крафта» (after), второй — alt: { data, hybrids }.
export function recipeVariants({ after, data, hybrids, alt }) {
  const direct = after ? alt && alt.data : data;
  const zero = after ? data : alt && alt.data;
  const hy = (after ? hybrids : alt && alt.hybrids) || {};
  const ok = (d) => d && !d.error;
  const out = [];
  if (ok(direct)) out.push({ key: 'direct', after: false, level: 0, data: direct });
  if (ok(zero) && zero.enchantAfterCraft) out.push({ key: 'after0', after: true, level: 0, data: zero });
  for (const [l, d] of Object.entries(hy)) if (ok(d) && d.enchantAfterCraft) out.push({ key: `after${l}`, after: true, level: Number(l), data: d });
  return out;
}

// Сравнение вариантов рецепта на твоих материалах: сколько докупать, что можно скрафтить и во сколько штука обходится со своими материалами.
// ownCost — вложения на штуку минус серебро, которое экономят свои материалы (null — нет цен). best — самый дешёвый вариант.
// extra(d) — добавка на штуку сверх цены рецепта (рерол качества, logic/reroll.js): у прямого и «после крафта» она разная
export function compareVariants(variants, have, nameOf, extra = null) {
  const rows = variants.map((v) => {
    const alloc = allocateItem(v.data, nameOf, makePool(have));
    const priced = v.data.hasAllMaterialPrices !== false && v.data.effectiveCostPerUnit !== null && v.data.effectiveCostPerUnit !== undefined;
    const add = extra ? extra(v.data) : 0;
    const ownCost = priced ? Math.max(v.data.effectiveCostPerUnit - alloc.saved / (v.data.quantity || 1), 0) + add : null;
    return { ...v, alloc, cash: cashOf(alloc.rows), ownCost, reroll: add };
  });
  let best = null;
  for (const r of rows) if (r.ownCost !== null && (!best || r.ownCost < best.ownCost)) best = r;
  return { rows, best: best ? best.key : null };
}

// Материалы для таблицы «Мои материалы»: id, название, сколько нужно всего, сколько закрыто, сколько докупить (null — докупается компонентами)
export function materialTable(allocs, have, nameOf) {
  const map = new Map();
  const get = (id, name) => { if (!map.has(id)) map.set(id, { id, name: name || nameOf(id), needed: 0, used: 0, toBuy: 0, direct: false, semi: false }); return map.get(id); };
  for (const a of allocs) {
    for (const r of a.rows) { const e = get(r.id, r.name); e.direct = true; e.needed += r.needed; e.used += r.have; e.toBuy += r.toBuy; }
    for (const l of a.lines) if (l.via) { const e = get(l.id, l.name); e.semi = true; if (!a.rows.some((r) => r.id === l.id)) e.needed += l.needed; }
  }
  for (const id of Object.keys(have || {})) get(id);
  return [...map.values()].map((e) => ({ ...e, have: Math.max(Math.floor(Number(have[e.id])) || 0, 0), extra: Math.max((Math.floor(Number(have[e.id])) || 0) - e.used, 0) }));
}
