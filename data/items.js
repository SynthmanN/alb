// Куратированный список предметов для MVP.
// Покрывает сырьё и переработанные ресурсы T2-T8 — основа для крафта.

const RESOURCE_TYPES = [
  { raw: 'WOOD', refined: 'PLANKS', nameRu: 'Дерево / Доски' },
  { raw: 'ORE', refined: 'METALBAR', nameRu: 'Руда / Слитки' },
  { raw: 'FIBER', refined: 'CLOTH', nameRu: 'Волокно / Ткань' },
  { raw: 'HIDE', refined: 'LEATHER', nameRu: 'Шкура / Кожа' },
  { raw: 'ROCK', refined: 'STONEBLOCK', nameRu: 'Камень / Блоки' },
];

const TIERS = [2, 3, 4, 5, 6, 7, 8];
const TIER_ROMAN = { 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII' };

function buildItems() {
  const items = [];
  for (const t of TIERS) {
    for (const r of RESOURCE_TYPES) {
      items.push({
        id: `T${t}_${r.raw}`,
        name: `T${t} ${r.nameRu.split(' / ')[0]} (${TIER_ROMAN[t]})`,
        category: 'raw',
        tier: t,
      });
      items.push({
        id: `T${t}_${r.refined}`,
        name: `T${t} ${r.nameRu.split(' / ')[1]} (${TIER_ROMAN[t]})`,
        category: 'refined',
        tier: t,
      });
    }
  }
  return items;
}

const gear = require('./gear.json');

module.exports = { ITEMS: [...buildItems(), ...gear] };
