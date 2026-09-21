// Оборот плащей: сколько штук в день покупает рынок и за сколько дней уйдёт партия.
// Общая логика для плана, крафт-листа и стека калькулятора: везде одни и те же цифры и одно правило «продаётся медленно».
export const DEFAULT_WINDOW_DAYS = 7;
const has = (v) => v !== null && v !== undefined && Number.isFinite(v);

// Оборот позиции в штуках в день. У позиций из плана — цифра плана (та же, что задаёт потолок); у остальных — спрос из расчёта калькулятора.
export function turnoverPerDay(item, d) {
  if (item && item.dailyVolume > 0) return { perDay: item.dailyVolume, source: 'plan' };
  const p = d && !d.error ? d.patientSell : null;
  const v = p ? (p.avgDailyVolume > 0 ? p.avgDailyVolume : p.marketDailyVolume) : null;
  return has(v) && v > 0 ? { perDay: v, source: 'calc' } : { perDay: null, source: null };
}

// За сколько дней рынок выкупит qty штук (доля рынка не учитывается — это верхняя граница «сколько рынок вообще берёт»)
export const daysToSell = (qty, perDay) => (has(perDay) && perDay > 0 ? qty / perDay : null);

// Потолок плана: сколько штук рынок берёт за окно истории (не меньше одной)
export const marketCap = (perDay, windowDays) => (has(perDay) && perDay > 0 ? Math.max(Math.floor(perDay * windowDays), 1) : null);

// Итог для показа: оборот, дни продажи партии и «медленно» — дольше окна истории
export function turnoverInfo(qty, perDay, windowDays = DEFAULT_WINDOW_DAYS) {
  const days = daysToSell(qty, perDay);
  return { perDay: has(perDay) ? perDay : null, days, slow: days !== null && days > windowDays };
}
