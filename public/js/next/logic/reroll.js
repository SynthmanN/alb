// Реролл качества на ремонтном станке: сколько в среднем стоит поднять готовую вещь до нужного качества.
// Чистая логика без DOM. Модель — из замеров игры (лук T4.0–4.3, мантия T5.0–5.3): цена одной попытки не зависит от тира и типа вещи,
// а шансы у всех вещей одинаковы. Неудачная попытка качество не меняет — рерол повторяют, пока не выпадет нужное (или выше).
// Качества как в игре: 1 обычное, 2 хорошее, 3 выдающееся, 4 отличное, 5 шедевр.

export const BASE_ATTEMPT = 2604.17;                                   // цена первой попытки на .0 (с обычного на следующее качество)
export const QUALITY_MULT = { 1: 1, 2: 1.25, 3: 1.5, 4: 6.25 };        // множитель цены попытки по текущему качеству

// Шансы результата попытки по текущему качеству; недостающее до 100% — промах (качество то же). Сумма нормализуется:
// у обычного в замерах 100,1% — промаха там нет.
const RAW = {
  1: { 2: 80, 3: 15, 4: 5, 5: 0.1 },
  2: { 3: 60, 4: 9.9, 5: 0.1 },
  3: { 4: 49.9, 5: 0.1 },
  4: { 5: 0.5 },
};
export const TRANSITIONS = Object.fromEntries(Object.entries(RAW).map(([q, row]) => {
  const sum = Object.values(row).reduce((a, b) => a + b, 0);
  const scale = sum > 100 ? 100 / sum : 1;
  const out = Object.fromEntries(Object.entries(row).map(([r, p]) => [r, (p * scale) / 100]));
  out.stay = Math.max(1 - Object.values(out).reduce((a, b) => a + b, 0), 0);
  return [q, out];
}));

// Цена одной попытки: база × 2^зачарование × множитель текущего качества
export const attemptCost = (quality, enchant = 0, base = BASE_ATTEMPT) => (QUALITY_MULT[quality] === undefined ? null : base * 2 ** enchant * QUALITY_MULT[quality]);

// Ожидание по цепи Маркова. E[q] = (стоимость попытки + Σ p(q→r)·E[r] по r ниже цели) / (1 − шанс промаха); r ≥ цели — конец.
// weight(q) — что накапливаем за попытку: серебро (attemptCost) или единица (число попыток).
function expected(from, target, weight) {
  if (!(from >= 1) || !(target > from) || target > 5) return 0;
  const memo = {};
  const e = (q) => {
    if (q >= target) return 0;
    if (memo[q] !== undefined) return memo[q];
    const t = TRANSITIONS[q];
    let sum = weight(q);
    for (let r = q + 1; r < target; r++) sum += (t[r] || 0) * e(r);
    memo[q] = sum / (1 - t.stay);
    return memo[q];
  };
  return e(from);
}

// Средняя стоимость подъёма одной вещи с качества from до target (или выше) на уровне зачарования enchant
export function rerollCost(from, target, enchant = 0, base = BASE_ATTEMPT) {
  return expected(from, target, (q) => attemptCost(q, enchant, base));
}
export const rerollAttempts = (from, target) => expected(from, target, () => 1);

// Шансы качества вещи сразу после крафта (без мастерок), %: обычное 80, хорошее 15, выдающееся 5, отличное 0,1 (сумма нормализуется)
export const CRAFT_CHANCE = { 1: 80, 2: 15, 3: 5, 4: 0.1 };
export const craftDistribution = () => {
  const sum = Object.values(CRAFT_CHANCE).reduce((a, b) => a + b, 0);
  return Object.entries(CRAFT_CHANCE).map(([q, p]) => [Number(q), p / sum]);
};
// Стартовое качество: 0 — по шансам крафта, 1..4 — вещь всегда выходит в этом качестве
const startDistribution = (from) => (from >= 1 ? [[from, 1]] : craftDistribution());
export const fromLabel = (from) => (from >= 1 ? `с «${QUALITY_NAMES[from]}»` : 'после крафта по шансам');
const QUALITY_NAMES = { 1: 'Обычное', 2: 'Хорошее', 3: 'Выдающееся', 4: 'Отличное', 5: 'Шедевр' };

// Настройки реролла: on — учитывать ли, from — качество вещи сразу после крафта (0 — по шансам крафта), base — цена первой попытки на .0
export const DEFAULT_REROLL = { on: true, from: 0, base: BASE_ATTEMPT };
export const normalizeReroll = (s = {}) => {
  const from = Math.min(Math.max(Math.round(Number(s.rerollStart ?? s.from)) || 0, 0), 4);
  const raw = Number(s.rerollBase ?? s.base);
  return { on: (s.rerollOn ?? s.on) !== false, from, base: Number.isFinite(raw) && raw > 0 ? raw : BASE_ATTEMPT };
};

// На каком уровне зачарования делается рерол этого варианта рецепта. Зачарование качество сохраняет, поэтому у «после крафта»
// рерол идёт на вещи-базе (её уровень — baseLevel; купленный готовый .1/.2 — уровень покупки), а у прямого крафта — на конечной вещи.
export function rerollLevel(d) {
  const e = d && d.enchantAfterCraft;
  if (e) return Math.max(e.baseLevel || 0, e.chainEntryLevel || 0);
  return (d && d.enchant) || 0;
}

// Реролл варианта d до качества target: { perUnit, attempts, first, level, from, target } или null, если реролл не нужен
export function rerollFor(d, target, cfg = DEFAULT_REROLL) {
  if (!d || d.error || !cfg || !cfg.on) return null;
  const goal = target || d.quality;
  const start = startDistribution(cfg.from);
  if (!(goal > start[0][0])) return null;
  const level = rerollLevel(d);
  const mix = (f) => start.reduce((sum, [q, p]) => sum + p * f(q), 0);
  return {
    perUnit: mix((q) => rerollCost(q, goal, level, cfg.base)), attempts: mix((q) => rerollAttempts(q, goal)),
    first: attemptCost(start[0][0], level, cfg.base), level, from: cfg.from, target: goal, fromLabel: fromLabel(cfg.from),
  };
}
export const rerollDelta = (d, target, cfg) => { const r = rerollFor(d, target, cfg); return r ? r.perUnit : 0; };

// Ответ калькулятора с рероллом в себестоимости: вложения, профит и терпеливая продажа сдвигаются на стоимость рерола (как «своя цена»
// в logic/manual.js). Ответ не мутируется; повторно рерол не добавляется. Поле reroll описывает добавку для интерфейса.
export function withReroll(d, target, cfg = DEFAULT_REROLL) {
  if (!d || d.error || d.reroll) return d;
  const r = rerollFor(d, target, cfg);
  if (!r || !(r.perUnit > 0)) return d;
  const cost = d.effectiveCostPerUnit;
  if (cost === null || cost === undefined) return d;
  const delta = r.perUnit;
  const out = { ...d, reroll: r, effectiveCostPerUnit: cost + delta, totalCost: (cost + delta) * (d.quantity || 1) };
  const eff = out.effectiveCostPerUnit;
  if (d.profitPerUnit !== null && d.profitPerUnit !== undefined) {
    out.profitPerUnit = d.profitPerUnit - delta;
    out.totalProfit = out.profitPerUnit * (d.quantity || 1);
  }
  if (d.patientSell) {
    const ps = { ...d.patientSell };
    const index = (profit, vol) => (profit > 0 && eff > 0 ? ((profit / eff) * 100) * Math.log2(2 + vol) : 0);
    const shift = (row) => (row.noData || row.profitPerUnit === null || row.profitPerUnit === undefined ? row : { ...row, profitPerUnit: row.profitPerUnit - delta, profitIndex: index(row.profitPerUnit - delta, row.avgDailyVolume) });
    if (ps.byCity) ps.byCity = ps.byCity.map(shift);
    if (ps.profitPerUnit !== null && ps.profitPerUnit !== undefined) ps.profitPerUnit -= delta;
    if (ps.plan && ps.plan.profitPerUnit !== undefined && ps.plan.profitPerUnit !== null) ps.plan = { ...ps.plan, profitPerUnit: ps.plan.profitPerUnit - delta };
    out.patientSell = ps;
  }
  if (d.qualityComparison) out.qualityComparison = d.qualityComparison.map((row) => ({ ...row, baseProfit: row.profitPerUnit }));
  return out;
}

// Таблица «по качеству»: рерол до каждого качества и профит с ним. Сервер считает профит качеств по себестоимости без рерола (row.baseProfit
// сохраняется withReroll); если рерол в ответ не добавлен — берётся profitPerUnit как есть.
export function qualityRerollRows(d, cfg = DEFAULT_REROLL) {
  const rows = d && d.qualityComparison ? d.qualityComparison : [];
  return rows.map((row) => {
    const r = rerollFor(d, row.quality, cfg);
    const raw = row.baseProfit !== undefined ? row.baseProfit : row.profitPerUnit;
    const cost = r ? r.perUnit : 0;
    return { ...row, rerollCost: cost, rerollAttempts: r ? r.attempts : 0, profitWithReroll: raw === null || raw === undefined ? null : raw - cost };
  });
}
