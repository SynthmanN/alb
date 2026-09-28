// Каталог материалов для пикера «Мои материалы»: сырьё, полуфабрикаты (в том числе зачарованные), руны/души/реликвии и плащи-ингредиенты.
// Чистая логика без DOM: принимает список предметов справочника (/api/items), возвращает кандидатов { id, name, tier, enchant, kind }.

export const KINDS = [['raw', 'Сырьё'], ['refined', 'Полуфабрикаты'], ['enchant', 'Руны, души, реликвии'], ['cape', 'Плащи']];
const ENCHANT_ITEMS = [['RUNE', 'Руна'], ['SOUL', 'Душа'], ['RELIC', 'Реликвия']];
const TIER_WORD = { 4: 'знаток', 5: 'эксперт', 6: 'мастер', 7: 'магистр', 8: 'старейшина' };
const TIERS = [4, 5, 6, 7, 8];

const tierOf = (id) => Number((String(id).match(/^T(\d)/) || [])[1]) || 0;

// Сырьё и полуфабрикаты тира 4+ бывают зачарованными до .4 (камень — нет): T4_CLOTH → T4_CLOTH_LEVEL2@2. Плащи — T4_CAPE@2 (до .3).
export function enchantedId(id, enchant) {
  if (!enchant) return id;
  return /^T\d_CAPE$/.test(id) ? `${id}@${enchant}` : `${id}_LEVEL${enchant}@${enchant}`;
}
const maxEnchantOf = (id) => {
  if (tierOf(id) < 4 || /_(ROCK|STONEBLOCK)$/.test(id)) return 0;
  if (/^T\d_CAPE$/.test(id)) return 3;
  return 4;
};

// Все кандидаты для добавления. items — список из /api/items (allItems()).
export function buildCatalog(items) {
  const out = [];
  const add = (base, name, kind, enchants) => {
    for (let e = 0; e <= enchants; e++) out.push({ id: enchantedId(base, e), name, tier: tierOf(base), enchant: e, kind });
  };
  for (const it of items) {
    if (it.category === 'raw' || it.category === 'refined') add(it.id, it.name, it.category, maxEnchantOf(it.id));
    else if (it.category === 'cape' && /^T\d_CAPE$/.test(it.id)) add(it.id, it.name, 'cape', maxEnchantOf(it.id));
  }
  for (const [token, title] of ENCHANT_ITEMS) for (const t of TIERS) out.push({ id: `T${t}_${token}`, name: `${title} (${TIER_WORD[t]})`, tier: t, enchant: 0, kind: 'enchant' });
  return out;
}

// Отбор в пикере: поиск по названию/id, вид, тир, зачарование (пустое значение — любое). Порядок: вид, название, тир, зачарование.
export function filterCatalog(catalog, { q = '', kind = '', tier = '', enchant = '' } = {}) {
  const s = String(q).trim().toLowerCase();
  const kindOrder = new Map(KINDS.map(([k], i) => [k, i]));
  return catalog
    .filter((c) => (!kind || c.kind === kind) && (!tier || String(c.tier) === String(tier)) && (enchant === '' || String(c.enchant) === String(enchant))
      && (!s || c.name.toLowerCase().includes(s) || c.id.toLowerCase().includes(s)))
    .sort((a, b) => kindOrder.get(a.kind) - kindOrder.get(b.kind) || a.name.replace(/^T\d+\s+/, '').localeCompare(b.name.replace(/^T\d+\s+/, ''), 'ru') || a.tier - b.tier || a.enchant - b.enchant);
}

// Название материала по id для строки, которой нет в расчёте: есть в справочнике — оно; зачарованный — название основы; руны/души/реликвии — свои.
export function materialName(id, items, fallback = (x) => x) {
  const byId = new Map();
  for (const it of items) byId.set(it.id, it);
  const hit = byId.get(id);
  if (hit) return hit.name;
  const m = String(id).match(/^(.*?)(?:_LEVEL\d)?@(\d)$/);
  const base = m ? m[1] : String(id);
  const baseHit = byId.get(base);
  if (baseHit) return baseHit.name;
  const enchantItem = ENCHANT_ITEMS.find(([token]) => base === `T${tierOf(base)}_${token}`);
  if (enchantItem) return `${enchantItem[1]} (${TIER_WORD[tierOf(base)] || `T${tierOf(base)}`})`;
  return fallback(id);
}
