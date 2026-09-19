// Ставки возврата ресурсов ПРИ КРАФТЕ ГОТОВОГО ГИРА (оружие, броня, плащи) — не путать с переработкой сырья (RRR_PRESETS в refining.js).
// У крафта гира своя, меньшая шкала специализации: город с бонусом для ЭТОГО предмета даёт +15 очков (а не +40, как переработке
// «своего» ресурса) поверх базовых +18 за крафт в любом royal-городе; Фокус — те же +59 очков. Формула RRR = 1 − 1/(1 + очки/100).
// Какой город даёт бонус какому предмету, зависит от типа самого предмета (меч — Lymhurst, топор — Martlock…), а не от сырья, и где
// физически стоит игрок в момент крафта, угадать нельзя (топор в Martlock — 24.8%, лук там же — 15.3%). Поэтому город не угадываем:
// ставку выбирает игрок — готовым пресетом или своим процентом (мастерки, гильдейские бонусы и т.п. двигают её дополнительно).
const { rrrFromBonus } = require('./refining');

const GEAR_RRR_PRESETS = [
  { id: 'none', label: 'Без бонусов (остров)', bonus: 0 },
  { id: 'city', label: 'Royal-город, без бонуса предмета', bonus: 18 },
  { id: 'city_bonus', label: 'Город с бонусом предмета', bonus: 33 },
  { id: 'city_focus', label: 'Royal-город + Фокус', bonus: 77 },
  { id: 'city_bonus_focus', label: 'Город с бонусом предмета + Фокус', bonus: 92 },
];
const GEAR_RRR_DEFAULT = 'city_bonus';                  // 24.8%
const GEAR_RRR_MAX_PERCENT = 95;

// presetId + необязательная своя ставка в процентах (0–95): своя ставка главнее пресета. Возвращает долю 0..0.95.
function resolveGearRrrRate(presetId, customPercent) {
  if (customPercent !== null && customPercent !== undefined && Number.isFinite(customPercent)) {
    return Math.min(Math.max(customPercent, 0), GEAR_RRR_MAX_PERCENT) / 100;
  }
  const preset = GEAR_RRR_PRESETS.find((p) => p.id === presetId) || GEAR_RRR_PRESETS.find((p) => p.id === GEAR_RRR_DEFAULT);
  return rrrFromBonus(preset.bonus);
}

module.exports = { GEAR_RRR_PRESETS, GEAR_RRR_DEFAULT, resolveGearRrrRate };
