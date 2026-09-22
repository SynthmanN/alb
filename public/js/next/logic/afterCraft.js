// Порог «зачарки после крафта»: один и тот же вопрос — «дешевле скрафтить сразу зачарованным (прямой путь) или сделать .0 и поднять
// зачарование рунами/душами/реликтами (после крафта)» — решается в трёх местах (крафт-лист и стек калькулятора — logic/stack.js,
// фракционный план — logic/factionPlan.js, скан — server.js, resolveAfterChoice). Раньше пороги не совпадали (5% по себестоимости
// материалов у плана, 7% по профиту у остальных) — один и тот же предмет мог получить разный совет на разных экранах. Теперь везде
// одно правило: сравниваем ПРОФИТ (не сырую себестоимость — продажа у обоих путей одна и та же, но профит — это то, что реально важно),
// «после крафта» побеждает, только если он выгоднее прямого не меньше чем на этот порог. Меняешь число — меняй только здесь;
// на сервере (server.js, ENCHANT_AFTER_MIN_GAIN) то же значение продублировано вручную — ESM и CommonJS не шарят модуль напрямую.
export const AFTER_CRAFT_MIN_GAIN = 0.07;

// profitDirect/profitAfter — профит с одной штуки на каждом пути (может быть отрицательным, null/undefined — путь недоступен).
export function afterCraftWins(profitDirect, profitAfter) {
  if (profitAfter === null || profitAfter === undefined) return false;
  if (profitDirect === null || profitDirect === undefined) return true;
  return profitAfter > profitDirect + AFTER_CRAFT_MIN_GAIN * Math.abs(profitDirect);
}
