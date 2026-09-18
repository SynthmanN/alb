// Пропорции рефайна: сколько сырья текущего тира + переработанного материала
// ПРЕДЫДУЩЕГО тира нужно на 1 единицу выхода.
//
// Значения подтверждены напрямую по дампу игровых файлов (items.xml,
// <craftingrequirements> каждого T{n}_PLANKS/METALBAR/CLOTH/LEATHER/STONEBLOCK) —
// одинаковы для всех 5 типов ресурсов.
const REFINING_RATIOS = {
  2: { raw: 1, prevRefined: 0 },
  3: { raw: 2, prevRefined: 1 },
  4: { raw: 2, prevRefined: 1 },
  5: { raw: 3, prevRefined: 1 },
  6: { raw: 4, prevRefined: 1 },
  7: { raw: 5, prevRefined: 1 },
  8: { raw: 5, prevRefined: 1 },
};

// RRR (Resource Return Rate) пресеты.
// Формула (подтверждена вики Albion Online): RRR = 1 - 1/(1 + бонус/100)
// База: 18% в любом royal-городе. +40% если город даёт спец-бонус ИМЕННО этому
// ресурсу (по одному ресурсу на город). +59% если тратится фокус (Focus).
const RRR_PRESETS = [
  { id: 'none', label: 'Без бонусов (остров/чужой город, без фокуса)', bonus: 0 },
  { id: 'city', label: 'Обычный royal-город, без фокуса', bonus: 18 },
  { id: 'city_bonus', label: 'Город со спец-бонусом ресурса, без фокуса', bonus: 58 },
  { id: 'city_focus', label: 'Обычный город + фокус', bonus: 77 },
  { id: 'city_bonus_focus', label: 'Город со спец-бонусом + фокус', bonus: 117 },
];

function rrrFromBonus(bonus) {
  return 1 - 1 / (1 + bonus / 100);
}

const BONUS_CITY = {
  WOOD: 'Fort Sterling',
  ORE: 'Thetford',
  FIBER: 'Lymhurst',
  HIDE: 'Martlock',
  ROCK: 'Bridgewatch',
};

module.exports = { REFINING_RATIOS, RRR_PRESETS, rrrFromBonus, BONUS_CITY };
