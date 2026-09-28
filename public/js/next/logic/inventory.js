// Мои материалы: что у игрока уже есть, сколько докупить и сколько штук каждого гира можно скрафтить прямо сейчас.
// Чистая логика без DOM. Общий пул материалов раздаётся позициям по порядку (жадно): первая позиция берёт своё, остаток — следующей.
import { acquisition } from './acquire.js';

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
    left: () => ({ ...left }),
  };
}

export const hasHave = (have) => Object.values(have || {}).some((v) => Math.floor(Number(v)) > 0);

// Доля рецепта, закрытая материалами: 0..1 (по самому нехватающему материалу)
export const coverage = (lines) => (lines.length ? Math.min(...lines.map((l) => (l.needed > 0 ? Math.min(l.covered / l.needed, 1) : 1))) : 1);

// Сколько штук из quantity можно скрафтить уже сейчас. Потребность — с учётом возврата ресурсов, как во всём калькуляторе.
export function craftableNow(lines, quantity) {
  return Math.min(quantity, Math.max(Math.floor(quantity * coverage(lines) + EPS), 0));
}

// Расчёт одной позиции с пулом: строки закупки, строки рецепта и сколько можно скрафтить
export function allocateItem(data, nameOf, pool) {
  const { rows, lines } = acquisition(data, nameOf, pool);
  const quantity = data.quantity || 1;
  const craftable = craftableNow(lines, quantity);
  return { rows, lines, quantity, craftable, ready: craftable >= quantity, toBuyRows: rows.filter((r) => r.toBuy > 0) };
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
