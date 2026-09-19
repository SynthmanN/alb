const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { AodpBudget } = require('./lib/aodpBudget');
const { GEAR_RRR_PRESETS, resolveGearRrrRate } = require('./data/gear-rrr');
const { openJug, jugStats, pruneToCatalog } = require('./lib/jugStore');
const { readPrices, readHistory, jugFreshness } = require('./lib/jugQuery');
const { startJugCrawler } = require('./lib/jugCrawler');
const path = require('path');
const fs = require('fs');
const { ITEMS } = require('./data/items');
const { REFINING_RATIOS, RRR_PRESETS, rrrFromBonus, BONUS_CITY } = require('./data/refining');
const RECIPES = require('./data/recipes.json');
const EXTRA_ITEM_NAMES = require('./data/extra-item-names.json');
const MASTERIES = require('./data/masteries.json');

const GEAR_IDS = new Set(ITEMS.filter((i) => i.category === 'weapon' || i.category === 'armor' || i.category === 'cape').map((i) => i.id));
const ITEM_TIER_BY_ID = new Map(ITEMS.map((i) => [i.id, i.tier]));
const ITEM_SLOT_BY_ID = new Map(ITEMS.filter((i) => i.slot).map((i) => [i.id, i.slot]));
const ITEM_NAME_BY_ID = new Map(ITEMS.map((i) => [i.id, i.name]));
function resolveItemName(id) {
  return ITEM_NAME_BY_ID.get(id) || EXTRA_ITEM_NAMES[id] || id;
}

// Item Power — формула сверена напрямую с дампом игровых файлов (items.xml,
// атрибут itempower и вложенные <enchantments>), не по статьям (там цифры часто
// расходятся). База по тиру ОДИНАКОВА для оружия/брони/плащей: T2=500, +100 за тир.
// Зачарование: +100 за уровень (0-4). Качество: Обычное+0/Хорошее+10/Выдающееся+20/
// Отличное+50/Шедевр+100 — совпадает с уже существующей шкалой качества в проекте.
const QUALITY_IP_BONUS = { 1: 0, 2: 10, 3: 20, 4: 50, 5: 100 };
function baseIPForTier(tier) {
  return 500 + (tier - 2) * 100;
}
function itemIP(tier, enchant, quality) {
  return baseIPForTier(tier) + enchant * 100 + (QUALITY_IP_BONUS[quality] || 0);
}
// Зачарование гира (.1-.4) — часть самого item id в AODP (T4_MAIN_SWORD@1), а не отдельный
// query-параметр, как качество: цена совсем другая, id другой, значит для сканеров это отдельные
// строки в списке id запроса (тот же батчинг, что и для остальных id).
function gearEnchantId(baseId, enchant) {
  return enchant > 0 ? `${baseId}@${enchant}` : baseId;
}

// Зачарованные версии предмета торгуются на рынке как отдельные позиции с другими ценами (T4_MAIN_SWORD в Каэрлеоне:
// .0 — 23999, .1 — 44994, .2 — 77998), поэтому сканеры перебирают .0–.4 как разные предметы.
// Гир: суффикс @N, только T4+. Ресурсы: _LEVELn@n, только T4+, камень — максимум .3, каменные блоки — без зачарования.
function enchantVariants(item) {
  const gear = item.category === 'weapon' || item.category === 'armor' || item.category === 'cape';
  const resource = item.category === 'raw' || item.category === 'refined';
  if ((!gear && !resource) || item.tier < 4) return [{ enchant: 0, queryId: item.id }];
  let maxE = 4;
  if (resource) {
    if (item.id.includes('STONEBLOCK')) maxE = 0;
    else if (item.id.includes('_ROCK')) maxE = 3;
  }
  const out = [];
  for (let e = 0; e <= maxE; e++) {
    out.push({ enchant: e, queryId: e === 0 ? item.id : gear ? `${item.id}@${e}` : `${item.id}_LEVEL${e}@${e}` });
  }
  return out;
}

// Охотничьи (Avalon/Demon/Heretic/…) и фракционные плащи в зачарованном виде не крафтятся напрямую: сначала
// делается обычный плащ .0 (обычный плащ + герб + жетон/энергия), а дальше он зачаровывается рунами/душами вручную.
// Рецепт «зачарованный плащ + герб + …» в игре не работает, поэтому для этих слотов зачарование ТОЛЬКО после крафта.
const FORCED_ENCHANT_AFTER_CRAFT_SLOTS = new Set(['плащ (фракция)', 'плащ (охотник)']);
function requiresEnchantAfterCraft(itemId) {
  return FORCED_ENCHANT_AFTER_CRAFT_SLOTS.has(ITEM_SLOT_BY_ID.get(itemId));
}

// Возврат ресурсов (RRR) распространяется не на все материалы рецепта: артефакты, гербы, жетоны фракций и базовый
// плащ (maxreturnamount="0" в items.xml, помечены noReturn в recipes.json) не возвращаются. Коэффициент, на который
// умножается количество/стоимость материала: 1 — для невозвращаемого, (1 − RRR) — для остального.
function returnFactor(resource, rrr) {
  return resource.noReturn ? 1 : 1 - rrr;
}

// --- Возврат ресурсов (RRR) по каждому материалу и городу закупки ---
// Бонус к переработке зависит от города И типа ресурса одновременно: в любом royal-городе базовые 18%, плюс 40%, если город
// даёт спец-бонус именно этому типу ресурса (дерево — Fort Sterling, руда — Thetford, волокно — Lymhurst, шкура — Martlock,
// камень — Bridgewatch); Фокус добавляет ещё 59%. Раньше одна общая ставка применялась ко всем материалам рецепта сразу, а в игре,
// стоя в одном городе, спец-бонус получает максимум один тип ресурса. Формула: RRR = 1 − 1/(1 + бонус/100).
const RRR_ROYAL_BASE = 18;
const RRR_CITY_SPECIAL = 40;
const RRR_FOCUS = 59;
const RESOURCE_TYPE_BY_TOKEN = { WOOD: 'WOOD', PLANKS: 'WOOD', ORE: 'ORE', METALBAR: 'ORE', FIBER: 'FIBER', CLOTH: 'FIBER', HIDE: 'HIDE', LEATHER: 'HIDE', ROCK: 'ROCK', STONEBLOCK: 'ROCK' };
function resourceTypeOf(resourceId) {
  const m = String(resourceId).match(/^T\d_([A-Z]+)/);
  return m ? RESOURCE_TYPE_BY_TOKEN[m[1]] || null : null;
}
// opts = { royalBonus, focus }: royalBonus — «крафчу в royal-городе» (база 18% + спец-бонус города для «своего» ресурса), focus — тратится Фокус.
// Даёт ли этот город спец-бонус именно этому типу ресурса (руда — Thetford и т.д.).
function hasCityBonus(resourceId, city) {
  const type = resourceTypeOf(resourceId);
  return !!(type && BONUS_CITY[type] && normLocation(BONUS_CITY[type]) === normLocation(city));
}
function materialRrr(resourceId, city, opts) {
  let bonus = 0;
  if (opts.royalBonus) {
    bonus += RRR_ROYAL_BASE;
    if (hasCityBonus(resourceId, city)) bonus += RRR_CITY_SPECIAL;
  }
  if (opts.focus) bonus += RRR_FOCUS;
  return rrrFromBonus(bonus);
}
// Параметры запроса: royalBonus / focus (true|false); прежний параметр rrr=<пресет> понимается как запасной вариант.
function parseRrrOptions(req, defaultPresetId = 'none') {
  const q = req.query;
  if (q.royalBonus !== undefined || q.focus !== undefined) return { royalBonus: q.royalBonus === 'true', focus: q.focus === 'true' };
  const preset = RRR_PRESETS.find((p) => p.id === (q.rrr || defaultPresetId)) || RRR_PRESETS[0];
  return { royalBonus: preset.bonus > 0, focus: preset.id.includes('focus') };
}
function rrrOptionsLabel(opts) {
  if (opts.gearRate !== undefined) return `возврат при крафте: ${(opts.gearRate * 100).toFixed(1)}%${opts.gearRrrCustom !== null ? ' (своя ставка)' : ''}`;
  return `бонус города: ${opts.royalBonus ? 'да' : 'нет'} · Фокус: ${opts.focus ? 'да' : 'нет'}`;
}
// Возврат при крафте ГОТОВОГО ГИРА: одна ставка на весь рецепт — пресет (gearRrr, по умолчанию city_bonus = 24.8%) или своя (gearRrrCustom, %).
// Не зависит от города покупки материала: город крафта не угадываем, ставку выбирает игрок. Переработка сырья (refine-*) считается
// по-прежнему по городу и типу ресурса (materialRrr).
function parseGearRrrOptions(req) {
  const custom = parseFloat(req.query.gearRrrCustom);
  const gearRrrCustom = Number.isFinite(custom) ? custom : null;
  return { gearRate: resolveGearRrrRate(req.query.gearRrr, gearRrrCustom), gearRrr: req.query.gearRrr || null, gearRrrCustom };
}
const REFINED_NAME = { WOOD: 'PLANKS', ORE: 'METALBAR', FIBER: 'CLOTH', HIDE: 'LEATHER', ROCK: 'STONEBLOCK' };
// --- Полуфабрикаты: купить готовый материал или переработать самому ---
// Материал рецепта гира (слиток, кожа, доски, ткань, блоки) можно купить готовым или собрать самому: сырьё текущего тира + материал
// предыдущего тира (REFINING_RATIOS) с возвратом при ПЕРЕРАБОТКЕ (своя ставка — refineRate, по умолчанию 36.7%: город с бонусом
// ресурса). Берётся дешевле. Это два разных действия с разным возвратом: переработка возвращает часть сырья, крафт гира — часть
// готовых слитков/кожи; в цене материала уже сидит возврат переработки, а ставка крафта гира применяется поверх — считаем цепочку,
// но в интерфейсе НЕ склеиваем две ставки в одну «эффективную».
const REFINED_ID_RE = /^T(\d)_(PLANKS|METALBAR|CLOTH|LEATHER|STONEBLOCK)(?:_LEVEL(\d)@\d)?$/;
const REFINED_TYPE_BY_NAME = Object.fromEntries(Object.entries(REFINED_NAME).map(([type, refined]) => [refined, type]));
function refineComponents(queryId) {
  const m = String(queryId).match(REFINED_ID_RE);
  if (!m) return null;
  const tier = Number(m[1]);
  const type = REFINED_TYPE_BY_NAME[m[2]];
  const enchant = m[3] ? Number(m[3]) : 0;
  const ratio = REFINING_RATIOS[tier];
  if (!ratio) return null;
  return {
    tier, type, enchant, ratio,
    rawId: effectiveRecipeResourceId(`T${tier}_${type}`, enchant),
    prevId: tier > 2 ? effectiveRecipeResourceId(`T${tier - 1}_${REFINED_NAME[type]}`, enchant) : null,
  };
}
// Добавляет в набор id сырья и предыдущего тира для всех материалов, которые можно переработать самому (их цены нужны для сравнения).
function addRefineComponentIds(idSet, ids) {
  for (const id of ids) {
    const c = refineComponents(id);
    if (c) { idSet.add(c.rawId); if (c.prevId) idSet.add(c.prevId); }
  }
}
// priceOf(id) → { price, city, date } | null — минимальная рыночная цена компонента. Возвращает вариант «переработать самому» или null.
function refineAlternative(queryId, priceOf, rate) {
  const c = refineComponents(queryId);
  if (!c) return null;
  const raw = priceOf(c.rawId);
  if (!raw) return null;
  const prev = c.prevId ? priceOf(c.prevId) : null;
  if (c.prevId && !prev) return null;
  const rawCost = c.ratio.raw * raw.price + (prev ? c.ratio.prevRefined * prev.price : 0);
  const dates = [raw.date, prev ? prev.date : null].filter(Boolean).sort();
  return {
    type: c.type, city: BONUS_CITY[c.type], rate, rawCost, price: rawCost * (1 - rate), date: dates.length ? dates[0] : null,
    components: [
      { id: c.rawId, count: c.ratio.raw, price: raw.price, city: raw.city },
      ...(prev ? [{ id: c.prevId, count: c.ratio.prevRefined, price: prev.price, city: prev.city }] : []),
    ],
  };
}
// Ставка возврата при ПЕРЕРАБОТКЕ (для «переработать самому»): пресет из RRR_PRESETS (по умолчанию город с бонусом ресурса, 36.7%) или своя %.
function parseRefineRate(req) {
  const custom = parseFloat(req.query.refineRrrCustom);
  if (Number.isFinite(custom)) return { rate: Math.min(Math.max(custom, 0), 95) / 100, refineRrr: req.query.refineRrr || null, refineRrrCustom: custom };
  const preset = RRR_PRESETS.find((p) => p.id === req.query.refineRrr) || RRR_PRESETS.find((p) => p.id === 'city_bonus');
  return { rate: rrrFromBonus(preset.bonus), refineRrr: req.query.refineRrr || null, refineRrrCustom: null };
}

// Лучшая котировка материала с учётом возврата в городе покупки: минимум цена × (1 − RRR города). quotes = [{ city, price }].
function bestMaterialQuote(quotes, resource, opts) {
  let best = null;
  for (const q of quotes) {
    const rrr = resource.noReturn ? 0 : opts.gearRate !== undefined ? opts.gearRate : materialRrr(resource.resource, q.city, opts);
    const effective = q.price * (1 - rrr);
    if (!best || effective < best.effective) best = { ...q, rrr, factor: 1 - rrr, effective, cityBonus: opts.gearRate === undefined && !resource.noReturn && !!opts.royalBonus && hasCityBonus(resource.resource, q.city) };
  }
  // Гир: сравниваем с «переработать самому» (если переданы цены компонентов); refineOption отдаём всегда, чтобы интерфейс мог пересчитать
  // выбор при другой ставке переработки без запроса.
  if (opts.refine && opts.gearRate !== undefined) {
    const alt = refineAlternative(resource.queryId || resource.resource, opts.refine.priceOf, opts.refine.rate);
    if (alt) {
      if (best) best.refineOption = alt;
      const rrr = resource.noReturn ? 0 : opts.gearRate;
      if (!best || alt.price < best.price) {
        best = { city: alt.city, price: alt.price, date: alt.date, rrr, factor: 1 - rrr, effective: alt.price * (1 - rrr), cityBonus: false, source: 'refine', refineOption: alt, buyPrice: best ? best.price : null };
      }
    }
  }
  return best;
}

function maxEnchantForGear(tier) {
  return tier >= 4 ? 4 : 0; // T2/T3 гир никогда не зачаровывается — та же логика, что и на фронте
}

// --- Мастерки (Destiny Board) ---
// Дерево категорий (Mastery) и специализаций (Specialization) извлечено из
// achievements.xml того же репозитория игровых дампов, что и остальные данные
// проекта — не по статьям (там разнобой), см. scripts/extract_masteries.py. Ставки из игровых файлов:
// специализация конкретной вещи даёт +2 IP/уровень этой вещи, а категория (Mastery) и специализация
// дают +0.2 IP/уровень на вещи своей ветки. Оба бонуса — только с T4 (mintier=4). Плащи в дереве
// не участвуют. Надбавка по тиру (masterymodifier из items.xml): T4=0%, T5=5%, T6=10%, T7=15%, T8=20% —
// множитель поверх бонуса (подтверждён по вторичному источнику, поэтому вынесен в константу).
const MASTERY_MIN_TIER = 4;
const MASTERY_CATEGORY_IP_PER_LEVEL = 0.2;
const MASTERY_SPEC_IP_PER_LEVEL = 2;
const MASTERY_TIER_MODIFIER = { 4: 0, 5: 0.05, 6: 0.1, 7: 0.15, 8: 0.2 };
const MASTERY_MAX_LEVEL = 200; // 100 базовых + 100 элитных уровней, ставка за уровень одинакова

const SPEC_BY_ID = new Map(MASTERIES.specializations.map((s) => [s.id, s]));
const MASTERY_BY_ID = new Map(MASTERIES.masteries.map((m) => [m.id, m]));
const SPEC_ID_BY_FAMILY = new Map();
for (const spec of MASTERIES.specializations) for (const fam of spec.families) SPEC_ID_BY_FAMILY.set(fam, spec.id);

// Уровни мастерок лежат в data/user-masteries.json отдельно для каждого посетителя (анонимная cookie-сессия sid, без логина):
// { sessions: { <sid>: { masteries: {id: lvl}, specializations: {id: lvl} } } }.
// USER_MASTERIES_PATH переопределяется в тестах, чтобы они не трогали реальные данные пользователя.
const USER_MASTERIES_PATH = process.env.USER_MASTERIES_PATH || path.join(__dirname, 'data', 'user-masteries.json');
const emptyLevels = () => ({ masteries: {}, specializations: {} });
function readMasteriesFile() {
  try {
    return JSON.parse(fs.readFileSync(USER_MASTERIES_PATH, 'utf8'));
  } catch {
    return {};
  }
}
function loadUserMasteryLevels(sessionId) {
  const data = readMasteriesFile();
  if (data.sessions) {
    const mine = data.sessions[sessionId];
    return mine ? { masteries: mine.masteries || {}, specializations: mine.specializations || {} } : emptyLevels();
  }
  // Файл старого формата (один общий набор уровней, сайт был личным): весь прогресс достаётся первому же посетителю
  // и переносится в новый формат, чтобы ничего не потерялось при обновлении.
  if (data.masteries || data.specializations) {
    const legacy = { masteries: data.masteries || {}, specializations: data.specializations || {} };
    saveUserMasteryLevels(sessionId, legacy);
    return legacy;
  }
  return emptyLevels();
}
function saveUserMasteryLevels(sessionId, levels) {
  const data = readMasteriesFile();
  const sessions = data.sessions || {};
  sessions[sessionId] = levels;
  fs.writeFileSync(USER_MASTERIES_PATH, JSON.stringify({ sessions }, null, 2));
}

// Бонус IP от мастерок для конкретного семейства предмета на конкретном тире.
// familyId — id без префикса тира (например "MAIN_SWORD"), как в masteries.json.
function masteryIPBonus(familyId, tier, userLevels) {
  if (tier < MASTERY_MIN_TIER) return 0;
  const specId = SPEC_ID_BY_FAMILY.get(familyId);
  if (!specId) return 0; // плащи и всё, чего нет в дереве специализаций
  const spec = SPEC_BY_ID.get(specId);
  const categoryLevel = (spec.masteryId && userLevels.masteries[spec.masteryId]) || 0;
  const specLevel = userLevels.specializations[specId] || 0;
  const raw = MASTERY_CATEGORY_IP_PER_LEVEL * (categoryLevel + specLevel) + MASTERY_SPEC_IP_PER_LEVEL * specLevel;
  return raw * (1 + (MASTERY_TIER_MODIFIER[tier] || 0));
}

const RESOURCE_TYPES = ['WOOD', 'ORE', 'FIBER', 'HIDE', 'ROCK'];
const RESOURCE_BASE_NAMES = new Set(['WOOD', 'ORE', 'FIBER', 'HIDE', 'ROCK', 'PLANKS', 'METALBAR', 'CLOTH', 'LEATHER']);

const app = express();
const PORT = process.env.PORT || 3000;

// Europe-сервер AODP. Для West/East поменять на west./east.
const AODP_BASE = 'https://europe.albion-online-data.com/api/v2/stats/prices';
const AODP_HISTORY_BASE = 'https://europe.albion-online-data.com/api/v2/stats/history';

const CITIES = ['Caerleon', 'Bridgewatch', 'Lymhurst', 'Martlock', 'Thetford', 'FortSterling', 'Brecilien'];

// Отображаемое имя города, как оно приходит в теле ответа AODP
// (у Fort Sterling есть пробел в ответе, хотя в query-параметре locations его нет)
const CITY_DISPLAY = {
  Caerleon: 'Caerleon',
  Bridgewatch: 'Bridgewatch',
  Lymhurst: 'Lymhurst',
  Martlock: 'Martlock',
  Thetford: 'Thetford',
  FortSterling: 'Fort Sterling',
  Brecilien: 'Brecilien',
};

// Налог с продажи через рынок: 8% без премиума, 4% с премиумом (параметр ?premium=true).
const SALES_TAX = { premium: 0.04, free: 0.08 };
function getSalesTaxRate(req) {
  return req.query.premium === 'true' ? SALES_TAX.premium : SALES_TAX.free;
}

// Чёрный Рынок: к налогу с продажи (4% с премиумом / 8% без) добавляется сбор за размещение ордера 2.5%,
// итого 6.5% / 10.5% (подтверждено двумя независимыми источниками; конкурентный сервис считает по 0.935 = 1 − 6.5%).
// Раньше на БМ налог не учитывался вовсе — это завышало прибыль сканера БМ на 6.5–10.5%.
const SETUP_FEE_RATE = 0.025;
const BM_TAX = { premium: SALES_TAX.premium + SETUP_FEE_RATE, free: SALES_TAX.free + SETUP_FEE_RATE };
function getBmTaxRate(req) {
  return req.query.premium === 'true' ? BM_TAX.premium : BM_TAX.free;
}

// Регулятор бюджета AODP: ВСЕ походы в AODP (живые запросы и фоновый краулер) идут через aodpFetch. Живые — приоритет 1,
// фоновые — 0. По умолчанию 45 запросов в минуту при лимите AODP 180/мин и 300/5 мин (в среднем 60/мин).
const AODP_RATE_PER_MINUTE = Number(process.env.AODP_RATE_PER_MINUTE) || 45;
const aodpBudget = new AodpBudget({ ratePerMinute: AODP_RATE_PER_MINUTE });
async function aodpFetch(url, priority = 1) {
  await aodpBudget.acquire(priority);
  return fetch(url);
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

async function fetchPrices(itemIds, quality) {
  const q = quality || 1;
  const key = `${q}:${itemIds.slice().sort().join(',')}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }
  const url = `${AODP_BASE}/${encodeURIComponent(itemIds.join(','))}?locations=${CITIES.join(',')}&qualities=${q}`;
  const res = await aodpFetch(url);
  if (!res.ok) throw new Error(`AODP responded ${res.status}`);
  const data = await res.json();
  cache.set(key, { ts: Date.now(), data });
  return data;
}

// Не больше AODP_CONCURRENCY одновременных запросов: сканер зачарования гонит ~2200 id разом (~44 чанка),
// и полностью параллельная отправка ловила 429 от AODP.
const AODP_CONCURRENCY = 6;
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// Цены по своему списку локаций (например, города + Чёрный Рынок): нужны там, где общие функции с фиксированным списком городов не годятся.
async function fetchPricesAt(itemIds, quality, locations) {
  const key = `at:${quality}:${locations.join(',')}:${itemIds.slice().sort().join(',')}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;
  const url = `${AODP_BASE}/${encodeURIComponent(itemIds.join(','))}?locations=${locations.join(',')}&qualities=${quality}`;
  const res = await aodpFetch(url);
  if (!res.ok) throw new Error(`AODP responded ${res.status}`);
  const data = await res.json();
  cache.set(key, { ts: Date.now(), data });
  return data;
}

async function fetchPricesBatched(itemIds, quality) {
  const CHUNK = 120; // расширение каталога зачарованными версиями (~5×) не должно во столько же раз умножать число запросов
  const chunks = [];
  for (let i = 0; i < itemIds.length; i += CHUNK) chunks.push(itemIds.slice(i, i + CHUNK));
  const results = await mapLimit(chunks, AODP_CONCURRENCY, (c) => fetchPrices(c, quality));
  return results.flat();
}

// За reverse-proxy (nginx/Caddy с TLS на домене) настоящий адрес клиента приходит в X-Forwarded-For. Доверять этому заголовку можно
// ТОЛЬКО когда прокси действительно стоит перед сервером — иначе любой клиент подделает заголовок и обойдёт лимит по IP.
// Поэтому по умолчанию выключено; при появлении прокси запускать с TRUST_PROXY=true.
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

// Базовые заголовки безопасности (без лишней зависимости): не даём браузеру угадывать тип содержимого,
// встраивать сайт в чужой iframe (кликджекинг) и отдавать полный адрес страницы в Referer чужим сайтам.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Анонимная сессия посетителя: случайный идентификатор в cookie (без пароля и логина) — чтобы личные данные
// (уровни мастерок) разных людей не смешивались. Идентификатор всегда проверяется по формату UUID.
const SESSION_COOKIE = 'sid';
const SESSION_MAX_AGE_SEC = 365 * 24 * 3600;
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}
app.use('/api', (req, res, next) => {
  let sessionId = readCookie(req, SESSION_COOKIE);
  if (!sessionId || !SESSION_ID_RE.test(sessionId)) {
    sessionId = crypto.randomUUID();
    // Secure — только когда соединение реально по HTTPS (req.secure; за прокси — при TRUST_PROXY=true), иначе cookie не поставится на http.
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${sessionId}; Max-Age=${SESSION_MAX_AGE_SEC}; Path=/; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`);
  }
  req.sessionId = sessionId;
  next();
});

// Грубая защита от одного агрессивного посетителя или бота: не больше 60 запросов в минуту с одного IP на /api.
// В тестах отключается (DISABLE_RATE_LIMIT=true): десятки запросов с одного адреса за секунды там норма.
if (process.env.DISABLE_RATE_LIMIT !== 'true') {
  app.use('/api', rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'слишком много запросов, попробуйте через минуту' },
  }));
}

// Список известных предметов для фронта (поиск/автокомплит)
app.get('/api/items', (req, res) => {
  res.json(ITEMS);
});

// Цены по всем городам сразу для набора item id (через запятую).
app.get('/api/prices', async (req, res) => {
  try {
    const itemsParam = req.query.items;
    const quality = Math.min(Math.max(parseInt(req.query.quality, 10) || 1, 1), 5);
    if (!itemsParam) {
      return res.status(400).json({ error: 'нужен параметр "items", например ?items=T4_WOOD,T4_PLANKS' });
    }
    const itemIds = itemsParam.split(',').map((s) => s.trim()).filter(Boolean);
    if (itemIds.length === 0) return res.status(400).json({ error: 'не передано ни одного корректного id предмета' });
    if (itemIds.length > 300) return res.status(400).json({ error: 'максимум 300 предметов за запрос' });
    const data = await fetchPricesBatched(itemIds, quality);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'не удалось получить данные AODP', details: err.message });
  }
});

const HISTORY_CACHE_TTL_MS = 3 * 60 * 1000;
const historyCache = new Map();

function fmtDate(d) {
  return `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`;
}

async function fetchHistoryBatched(itemIds, hours, quality, locations) {
  const CHUNK = 25;
  const now = new Date();
  const start = new Date(now.getTime() - hours * 3600 * 1000);
  const locKey = locations.join(',');

  const chunks = [];
  for (let i = 0; i < itemIds.length; i += CHUNK) chunks.push(itemIds.slice(i, i + CHUNK));

  const results = await mapLimit(
    chunks,
    AODP_CONCURRENCY,
    async (chunk) => {
      const key = `batch:${quality}:${locKey}:${hours}:${chunk.slice().sort().join(',')}`;
      const cached = historyCache.get(key);
      if (cached && Date.now() - cached.ts < HISTORY_CACHE_TTL_MS) return cached.data;
      const url = `${AODP_HISTORY_BASE}/${encodeURIComponent(chunk.join(','))}?date=${fmtDate(start)}&end_date=${fmtDate(now)}&locations=${locKey}&qualities=${quality}&time-scale=1`;
      const response = await aodpFetch(url);
      if (!response.ok) throw new Error(`AODP history responded ${response.status}`);
      const data = await response.json();
      historyCache.set(key, { ts: Date.now(), data });
      return data;
    },
  );
  return results.flat();
}

// AODP отдаёт "Fort Sterling" / "Black Market" с пробелом, а в query-параметрах их пишут без —
// сравниваем по нормализованному имени.
function normLocation(s) {
  return String(s || '').replace(/\s+/g, '').toLowerCase();
}

// Объём сделок по item_id. Если передан locations — считаем только по этим городам
// (нужно, чтобы объём относился к городам конкретной сделки, а не ко всем сразу).
function totalVolume(historyData, itemId, locations, quality) {
  const allowed = locations ? new Set(locations.map(normLocation)) : null;
  let total = 0;
  for (const series of historyData) {
    if (series.item_id !== itemId) continue;
    if (allowed && !allowed.has(normLocation(series.location))) continue;
    if (quality !== undefined && series.quality !== quality) continue;
    for (const p of series.data || []) total += p.item_count;
  }
  return total;
}

// Возраст котировки в минутах; null, если даты нет (AODP отдаёт 0001-01-01 для "нет данных").
function quoteAgeMinutes(dateStr, now) {
  if (!dateStr || dateStr === '0001-01-01T00:00:00') return null;
  return (now - new Date(dateStr + 'Z').getTime()) / 60000;
}

// Возраст сделки = возраст самой старой из её котировок (свежесть цепочки определяет слабое звено).
function dealAgeMinutes(dates, now) {
  let oldest = null;
  for (const d of dates) {
    const age = quoteAgeMinutes(d, now);
    if (age === null) return null;
    if (oldest === null || age > oldest) oldest = age;
  }
  return oldest === null ? null : Math.round(oldest);
}

// Штраф скора за возраст данных: до часа — без штрафа, старше 3 часов — вдвое, между — линейно.
function freshnessDecay(freshMinutes) {
  if (freshMinutes === null || freshMinutes === undefined) return 0.5;
  if (freshMinutes <= 60) return 1;
  if (freshMinutes >= 180) return 0.5;
  return 1 - 0.5 * ((freshMinutes - 60) / 120);
}

// Минимальный порог "это вообще продаётся" — растёт вместе с окном сканирования.
function scaledMinVolume(hours) {
  return Math.max(3, Math.round((hours / 24) * 3));
}

// Композитный скор вместо сортировки по чистому % маржи: log сглаживает объём.
function opportunityScore(profitPct, volume) {
  return profitPct * Math.log2(2 + (volume || 0));
}

app.get('/api/history', async (req, res) => {
  try {
    const item = req.query.item;
    const hours = Math.min(parseInt(req.query.hours, 10) || 24, 168);
    const quality = Math.min(Math.max(parseInt(req.query.quality, 10) || 1, 1), 5);
    if (!item) return res.status(400).json({ error: 'нужен параметр "item"' });

    const now = new Date();
    const start = new Date(now.getTime() - hours * 3600 * 1000);
    const key = `single:${item}:${hours}:${quality}`;
    const cached = historyCache.get(key);
    if (cached && Date.now() - cached.ts < HISTORY_CACHE_TTL_MS) {
      return res.json(cached.data);
    }
    const url = `${AODP_HISTORY_BASE}/${encodeURIComponent(item)}?date=${fmtDate(start)}&end_date=${fmtDate(now)}&locations=${CITIES.join(',')}&qualities=${quality}&time-scale=1`;
    const response = await aodpFetch(url);
    if (!response.ok) throw new Error(`AODP responded ${response.status}`);
    const data = await response.json();
    historyCache.set(key, { ts: Date.now(), data });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'не удалось получить историю AODP', details: err.message });
  }
});

const RESOURCE_NAME_RU = { WOOD: 'Дерево/Доски', ORE: 'Руда/Слитки', FIBER: 'Волокно/Ткань', HIDE: 'Шкура/Кожа', ROCK: 'Камень/Блоки' };

app.get('/api/refining-meta', (req, res) => {
  res.json({
    resourceTypes: RESOURCE_TYPES.map((t) => ({ id: t, name: RESOURCE_NAME_RU[t], bonusCity: BONUS_CITY[t] })),
    rrrPresets: RRR_PRESETS.map((p) => ({ ...p, rrr: rrrFromBonus(p.bonus) })),
    gearRrrPresets: GEAR_RRR_PRESETS.map((p) => ({ ...p, rrr: rrrFromBonus(p.bonus) })),
    rrrBonuses: { royalBase: RRR_ROYAL_BASE, citySpecial: RRR_CITY_SPECIAL, focus: RRR_FOCUS },
  });
});

app.get('/api/refining-calc', async (req, res) => {
  try {
    const type = req.query.type;
    const tier = parseInt(req.query.tier, 10);
    const rrrOpts = parseRrrOptions(req, 'city_bonus');
    const enchant = Math.min(Math.max(parseInt(req.query.enchant, 10) || 0, 0), 4);
    const citiesParam = req.query.cities;

    if (!RESOURCE_TYPES.includes(type)) return res.status(400).json({ error: `type должен быть одним из: ${RESOURCE_TYPES.join(', ')}` });
    if (!REFINING_RATIOS[tier]) return res.status(400).json({ error: 'tier должен быть от 2 до 8' });
    if (req.query.rrr && req.query.royalBonus === undefined && req.query.focus === undefined && !RRR_PRESETS.some((p) => p.id === req.query.rrr)) {
      return res.status(400).json({ error: `rrr должен быть одним из: ${RRR_PRESETS.map((p) => p.id).join(', ')}` });
    }
    const maxEnchant = tier < 4 ? 0 : type === 'ROCK' ? 3 : 4;
    if (enchant > maxEnchant) return res.status(400).json({ error: `зачарование ${enchant} недоступно для T${tier} ${type} (максимум ${maxEnchant})` });

    const refinedName = REFINED_NAME[type];
    const ratio = REFINING_RATIOS[tier];
    const enchSuffix = (id) => (enchant > 0 ? `${id}_LEVEL${enchant}@${enchant}` : id);
    const rawId = enchSuffix(`T${tier}_${type}`);
    const refinedId = enchSuffix(`T${tier}_${refinedName}`);
    const prevId = tier > 2 ? enchSuffix(`T${tier - 1}_${refinedName}`) : null;

    const itemIds = [rawId, refinedId];
    if (prevId) itemIds.push(prevId);
    const data = await fetchPrices(itemIds, 1);

    const byItemCity = {};
    for (const rec of data) {
      if (!byItemCity[rec.item_id]) byItemCity[rec.item_id] = {};
      byItemCity[rec.item_id][rec.city] = rec;
    }

    const taxRate = getSalesTaxRate(req);
    const queryCities = citiesParam ? citiesParam.split(',').map((s) => s.trim()).filter(Boolean) : Object.values(CITY_DISPLAY);

    // Возврат считается в КАЖДОМ городе отдельно: и сырьё, и материал предыдущего тира покупаются там же, где перерабатываются,
    // а спец-бонус города достаётся только «своему» типу ресурса (у остальных типов в этом городе — базовые 18%).
    const perCity = queryCities.map((city) => {
      const rrr = materialRrr(rawId, city, rrrOpts);
      const rawPrice = byItemCity[rawId]?.[city]?.sell_price_min || null;
      const prevPrice = prevId ? byItemCity[prevId]?.[city]?.sell_price_min || null : null;
      const outputSell = byItemCity[refinedId]?.[city]?.buy_price_max || null;
      const outputBuy = byItemCity[refinedId]?.[city]?.sell_price_min || null;
      const netOutputSell = outputSell !== null ? outputSell * (1 - taxRate) : null;
      let baseCost = null;
      if (rawPrice !== null && (prevId === null || prevPrice !== null)) {
        baseCost = ratio.raw * rawPrice + (prevId ? ratio.prevRefined * prevPrice : 0);
      }
      const effectiveCost = baseCost !== null ? baseCost * (1 - rrr) : null;
      const profit = effectiveCost !== null && netOutputSell !== null ? netOutputSell - effectiveCost : null;
      return { city, rawPrice, prevPrice, outputSell, outputBuy, netOutputSell, baseCost, rrr, effectiveCost, profit };
    });

    res.json({ itemId: refinedId, tier, type, enchant, ratio, taxRate, rrrOptions: rrrOpts, rrrLabel: rrrOptionsLabel(rrrOpts), bonusCity: BONUS_CITY[type], perCity });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'не удалось посчитать переработку', details: err.message });
  }
});

// Превращает базовый id ресурса/предмета рецепта в id нужного уровня зачарования.
function effectiveRecipeResourceId(resourceId, enchant) {
  if (!enchant) return resourceId;
  const m = resourceId.match(/^T(\d)_([A-Z]+)/);
  const tier = m ? parseInt(m[1], 10) : null;
  const typeToken = m ? m[2] : null;

  if (tier !== null && tier >= 4 && RESOURCE_BASE_NAMES.has(typeToken)) {
    const maxE = typeToken === 'ROCK' ? 3 : 4;
    if (enchant > maxE) return resourceId;
    return `${resourceId}_LEVEL${enchant}@${enchant}`;
  }
  if (GEAR_IDS.has(resourceId)) {
    const itemTier = ITEM_TIER_BY_ID.get(resourceId);
    if (itemTier >= 4) return `${resourceId}@${enchant}`;
  }
  return resourceId;
}

// Себестоимость (крафт) и лучшая мгновенная цена продажи для каждого тира семейства предмета.
async function computeTierComparison({ itemId, enchant, targetEnchant, enchantAfterRequested, enchantCapped, rrrOpts, taxRate, queryCities, quality: calcQuality = 1, days = 7, marketShare = 1 }) {
  const family = familyIdOf(itemId);
  const items = ITEMS.filter((i) => GEAR_IDS.has(i.id) && familyIdOf(i.id) === family && RECIPES[i.id]).sort((a, b) => a.tier - b.tier);
  if (items.length < 2) return null;

  // Зачарование применимо только с T4: для T2/T3 считаем .0 (enchantCapped подсказывает интерфейсу).
  const plan = items.map((it) => {
    const applicable = it.tier >= 4;
    const afterForItem = enchantAfterRequested || (requiresEnchantAfterCraft(it.id) && enchant > 0);
    const recipeEnchant = afterForItem ? 0 : (applicable ? enchant : 0);
    const finalEnchant = applicable ? (afterForItem ? Math.min(enchant, 3) : enchant) : 0;
    const stepIds = afterForItem && applicable && ENCHANT_MATERIAL_COUNT[it.slot]
      ? Array.from({ length: finalEnchant }, (_, k) => enchantMaterialId(it.tier, k + 1)) : [];
    return { it, recipeEnchant, finalEnchant, stepIds, enchantCapped: enchantCapped || (!applicable && enchant > 0) || (afterForItem && enchant > 3) };
  });

  const materialIds = new Set();
  const finishedIds = [];
  for (const p of plan) {
    for (const r of RECIPES[p.it.id].resources) materialIds.add(effectiveRecipeResourceId(r.resource, p.recipeEnchant));
    for (const id of p.stepIds) materialIds.add(id);
    finishedIds.push(gearEnchantId(p.it.id, p.finalEnchant));
  }
  const locations = queryCities.map((c) => c.replace(/\s+/g, ''));
  const [materialData, finishedData, history] = await Promise.all([
    fetchPricesBatched([...materialIds], 1),
    fetchGearPrices([...new Set([...finishedIds, ...plan.filter((p) => p.recipeEnchant === 0).map((p) => p.it.id)])], ALL_QUALITIES),   // + готовая база .0 для «купить или скрафтить»
    // История — для терпеливой продажи по каждому тиру (без неё «мгновенный» профит в разы занижен)
    fetchHistoryBatched(finishedIds, days * 24, ALL_QUALITIES.join(','), locations).catch(() => []),
  ]);
  const allowed = new Set(queryCities.map(normLocation));
  const quotesByItem = {}; // id -> [{ city, price }]: цену выбираем с учётом возврата в городе покупки (bestMaterialQuote)
  for (const rec of materialData) {
    if (!rec.sell_price_min || !allowed.has(normLocation(rec.city))) continue;
    (quotesByItem[rec.item_id] || (quotesByItem[rec.item_id] = [])).push({ city: rec.city, price: rec.sell_price_min });
  }
  const cheapestByItem = {}; // без возврата — для рун/душ/реликвий зачарования (на них RRR не действует)
  for (const [id, quotes] of Object.entries(quotesByItem)) cheapestByItem[id] = Math.min(...quotes.map((q) => q.price));
  const bestSellByQuality = {}; // `${id}|${quality}` -> { city, price }
  for (const rec of finishedData) {
    if (!rec.buy_price_max || !allowed.has(normLocation(rec.city))) continue;
    const key = `${rec.item_id}|${rec.quality}`;
    if (!bestSellByQuality[key] || rec.buy_price_max > bestSellByQuality[key].price) bestSellByQuality[key] = { city: rec.city, price: rec.buy_price_max };
  }

  return plan.map((p) => {
    const recipe = RECIPES[p.it.id];
    let materials = 0;
    let complete = true;
    for (const r of recipe.resources) {
      const best = bestMaterialQuote(quotesByItem[effectiveRecipeResourceId(r.resource, p.recipeEnchant)] || [], r, rrrOpts);
      if (!best) { complete = false; break; }
      materials += best.price * r.count * best.factor;
    }
    let cost = complete ? materials + (recipe.silver || 0) : null;
    // База .0: как и в основном расчёте — если готовый предмет выбранного качества дешевле крафта, берём его (иначе строка текущего
    // тира расходилась бы с итогом калькулятора).
    if (p.recipeEnchant === 0) {
      let baseBuy = null;
      for (const rec of finishedData) {
        if (rec.item_id !== p.it.id || rec.quality !== calcQuality || !rec.sell_price_min || !allowed.has(normLocation(rec.city))) continue;
        if (baseBuy === null || rec.sell_price_min < baseBuy) baseBuy = rec.sell_price_min;
      }
      if (baseBuy !== null && (cost === null || baseBuy < cost)) cost = baseBuy;
    }
    if (cost !== null && p.stepIds.length) {
      for (const id of p.stepIds) {
        const price = cheapestByItem[id];
        if (!price) { cost = null; break; }
        cost += price * ENCHANT_MATERIAL_COUNT[p.it.slot];
      }
    }
    // Лучшее качество тира — то, где выше чистая цена продажи.
    let best = null;
    for (const quality of ALL_QUALITIES) {
      const sell = bestSellByQuality[`${gearEnchantId(p.it.id, p.finalEnchant)}|${quality}`];
      if (sell && (!best || sell.price > best.sell.price)) best = { quality, sell };
    }
    const netSellPrice = best ? best.sell.price * (1 - taxRate) : null;
    const profitPerUnit = cost !== null && netSellPrice !== null ? netSellPrice - cost : null;

    // Терпеливая продажа тира: лучшее по профиту качество среди тех, где вообще есть сделки; срок — по доле рынка.
    let patient = null;
    if (cost !== null) {
      for (const quality of ALL_QUALITIES) {
        const st = computePatientSell({
          history, itemId: gearEnchantId(p.it.id, p.finalEnchant), days, quantity: 1, taxRate, costPerUnit: cost, queryCities, quality, marketShare,
        });
        if (!st) continue;
        if (!patient || st.profitPerUnit > patient.profitPerUnit) {
          patient = {
            quality, avgSellPrice: st.avgSellPrice, avgDailyVolume: st.avgDailyVolume, profitPerUnit: st.profitPerUnit,
            profitPct: (st.profitPerUnit / cost) * 100,
          };
        }
      }
    }
    return {
      itemId: p.it.id, tier: p.it.tier, enchant: p.finalEnchant, enchantCapped: p.enchantCapped,
      hasPrice: best !== null, cost, bestQuality: best ? best.quality : null, bestSell: best ? best.sell : null,
      netSellPrice, profitPerUnit, profitPct: profitPerUnit !== null && cost > 0 ? (profitPerUnit / cost) * 100 : null,
      patient, isCurrent: p.it.id === itemId,
    };
  });
}

app.get('/api/craft-calc', async (req, res) => {
  try {
    const itemId = req.query.item;
    const enchant = Math.min(Math.max(parseInt(req.query.enchant, 10) || 0, 0), 4);
    const quality = Math.min(Math.max(parseInt(req.query.quality, 10) || 1, 1), 5);
    const quantity = Math.min(Math.max(parseInt(req.query.quantity, 10) || 1, 1), 100000);
    const citiesParam = req.query.cities;
    const rrrOpts = parseGearRrrOptions(req);
    // Чёрный Рынок как ещё одно место продажи в плане (свой налог: налог + Setup Fee всегда — getBmTaxRate).
    const blackMarket = req.query.blackMarket === 'true';
    const bmTaxRate = getBmTaxRate(req);

    if (!itemId || !RECIPES[itemId]) return res.status(404).json({ error: `не найден рецепт для предмета "${itemId}"` });
    const queryCities = citiesParam ? citiesParam.split(',').map((s) => s.trim()).filter(Boolean) : Object.values(CITY_DISPLAY);

    // «Зачаровать после крафта»: делаем (или покупаем, если дешевле) базовый предмет .0 и поднимаем зачарование
    // рунами/душами/реликвиями до целевого уровня — так работает схема «чарю, а не крафчу сразу зачарованное».
    // Зачарование .4 (Awakening) не поддерживается: считаем до .3 и помечаем enchantCapped, чтобы цена продажи
    // не оказалась на .4 при стоимости материалов только до .3.
    const enchantAfterForced = requiresEnchantAfterCraft(itemId) && enchant > 0;
    const enchantAfterRequested = (req.query.enchantAfterCraft === 'true' || enchantAfterForced) && enchant > 0;
    const targetEnchant = enchantAfterRequested ? Math.min(enchant, 3) : enchant;
    const enchantCapped = enchantAfterRequested && enchant > 3;
    const recipeEnchant = enchantAfterRequested ? 0 : enchant;
    const sellThreshold = parseFloat(req.query.sellThreshold) > 0 ? parseFloat(req.query.sellThreshold) : null;
    const marketShare = parseMarketShare(req);
    const priceTolerance = parsePriceTolerance(req);
    const itemSlot = ITEM_SLOT_BY_ID.get(itemId);
    const itemTier = ITEM_TIER_BY_ID.get(itemId);
    const enchantStepIds = enchantAfterRequested && ENCHANT_MATERIAL_COUNT[itemSlot]
      ? Array.from({ length: targetEnchant }, (_, i) => enchantMaterialId(itemTier, i + 1)) : [];

    const recipe = RECIPES[itemId];
    const resourceQueryIds = recipe.resources.map((r) => effectiveRecipeResourceId(r.resource, recipeEnchant));
    const finishedQueryId = targetEnchant > 0 ? `${itemId}@${targetEnchant}` : itemId;

    const refineParams = parseRefineRate(req);
    const materialIdSet = new Set([...resourceQueryIds, ...enchantStepIds]);
    addRefineComponentIds(materialIdSet, resourceQueryIds);   // сырьё и предыдущий тир — для сравнения «купить готовый vs переработать»
    const materialIds = [...materialIdSet];
    const materialData = await fetchPricesBatched(materialIds, 1);
    const finishedData = blackMarket
      ? await fetchPricesAt([finishedQueryId], quality, [...CITIES, BM_QUERY_LOCATION])
      : await fetchPricesBatched([finishedQueryId], quality);
    // Базовый предмет .0: купить готовый или скрафтить — сравнение нужно и при «зачаровать после крафта», и для обычного .0-предмета
    // (галочка «после крафта» на предмете без зачарования не должна менять расчёт).
    const baseChoiceWanted = enchantAfterRequested || enchant === 0;
    const baseData = baseChoiceWanted ? await fetchPricesBatched([itemId], quality) : [];

    const materialByCity = {};
    for (const rec of materialData) {
      if (!materialByCity[rec.item_id]) materialByCity[rec.item_id] = {};
      materialByCity[rec.item_id][rec.city] = rec;
    }
    // Цена сырья — среднее по сделкам за своё окно (materialHours, по умолчанию 24 ч), а не цена одного дешёвого лота.
    const materialHours = parseMaterialHours(req);
    const materialHistory = await fetchHistoryBatched(materialIds, materialHours, 1, queryCities.map((c) => c.replace(/\s+/g, ''))).catch(() => []);
    const materialSeries = indexByItem(materialHistory);
    for (const id of materialIds) {
      const snapshot = Object.values(materialByCity[id] || {}).filter((rec) => rec.sell_price_min && queryCities.some((c) => normLocation(c) === normLocation(rec.city)))
        .map((rec) => ({ city: rec.city, price: rec.sell_price_min, date: rec.sell_price_min_date }));
      const quotes = materialPriceQuotes(materialSeries.get(id), id, materialHours, queryCities, snapshot);
      materialByCity[id] = Object.fromEntries(quotes.map((q) => [q.city, { city: q.city, sell_price_min: q.price, sell_price_min_date: q.date, priceSource: q.source }]));
    }
    const finishedByCity = {};
    for (const rec of finishedData) {
      if (!finishedByCity[rec.item_id]) finishedByCity[rec.item_id] = {};
      finishedByCity[rec.item_id][rec.city] = rec;
    }

    // Минимальная цена компонента переработки среди активных городов (цена сырья — как у остальных материалов: средняя по сделкам за окно).
    const refinePriceOf = (id) => {
      let best = null;
      for (const city of queryCities) {
        const rec = materialByCity[id]?.[city];
        if (rec && rec.sell_price_min && (!best || rec.sell_price_min < best.price)) best = { city, price: rec.sell_price_min, date: rec.sell_price_min_date };
      }
      return best;
    };
    const refineOpts = { ...rrrOpts, refine: { priceOf: refinePriceOf, rate: refineParams.rate } };

    let materialCostPerUnit = 0;       // по номиналу рецепта (без возврата)
    let materialCostAfterReturn = 0;   // с возвратом только на возвращаемые материалы
    let returnableNominal = 0;         // номинал возвращаемых материалов и сколько на них возвращается — для средней ставки в подписи
    let returnableSaved = 0;
    let hasAllPrices = true;
    const recipeBreakdown = recipe.resources.map((r) => {
      const queryId = effectiveRecipeResourceId(r.resource, recipeEnchant);
      const isEnchanted = queryId !== r.resource;
      const cityPrices = materialByCity[queryId] || {};
      const quotes = queryCities.filter((city) => cityPrices[city] && cityPrices[city].sell_price_min).map((city) => ({ city, price: cityPrices[city].sell_price_min }));
      // Город покупки выбираем по цене с учётом возврата именно в нём (а не просто самый дешёвый по ярлыку).
      const cheapest = bestMaterialQuote(quotes, { ...r, queryId }, refineOpts);
      const factor = cheapest ? cheapest.factor : returnFactor(r, 0);
      const refineOption = cheapest ? cheapest.refineOption || null : null;
      const materialSource = cheapest && cheapest.source === 'refine' ? 'refine' : 'buy';
      if (!cheapest) hasAllPrices = false;
      else {
        materialCostPerUnit += cheapest.price * r.count;
        materialCostAfterReturn += cheapest.price * r.count * cheapest.factor;
        if (!r.noReturn) { returnableNominal += cheapest.price * r.count; returnableSaved += cheapest.price * r.count * cheapest.rrr; }
      }

      return {
        returnable: !r.noReturn,
        // Сколько реально закупать: после возврата (RRR) остаток от крафта не нужен, но невозвращаемое берётся по номиналу
        neededToBuy: Math.ceil(r.count * quantity * factor),
        rrr: cheapest ? cheapest.rrr : 0,                    // ставка возврата в городе покупки именно для этого материала
        cityBonus: cheapest ? cheapest.cityBonus : false,    // сработал ли спец-бонус города (город закупки бонусный для этого типа ресурса)
        resource: r.resource,
        resourceName: resolveItemName(r.resource),
        queryId,
        enchanted: isEnchanted,
        count: r.count,
        cheapestCity: cheapest ? cheapest.city : null,
        cheapestPrice: cheapest ? cheapest.price : null,
        // Откуда материал: 'buy' — готовый с рынка, 'refine' — сырьё + предыдущий тир и переработка самому (выгоднее по цене).
        materialSource,
        buyPrice: materialSource === 'refine' ? (cheapest.buyPrice ?? null) : (cheapest ? cheapest.price : null),
        buyCity: materialSource === 'refine' ? null : (cheapest ? cheapest.city : null),
        refineOption,                                        // { city, rate, rawCost, price, components[] } — если материал можно переработать
        priceSource: cheapest ? (materialSource === 'refine' ? 'refine' : (cityPrices[cheapest.city] || {}).priceSource || null) : null,   // 'history' — средняя по сделкам за окно, 'quote' — сделок нет, текущая котировка
        // Цены во всех активных городах (от дешёвых к дорогим): чтобы раскидать терпеливые ордера на закупку по нескольким городам.
        cityPrices: cityPriceList(cityPrices, queryCities),
      };
    });

    const craftCostPerUnit = hasAllPrices ? materialCostAfterReturn + (recipe.silver || 0) : null;
    let effectiveCostPerUnit = materialCostAfterReturn + (recipe.silver || 0);

    let enchantAfterCraft = null;
    let baseBuyByCity = {};
    if (baseChoiceWanted) {
      // База .0: крафтим сами или покупаем готовую — берём дешевле (без жёсткого порога вроде «дороже 2к — крафчу»).
      let baseBuy = null;
      for (const rec of baseData) {
        if (!queryCities.includes(rec.city) || !rec.sell_price_min) continue;
        baseBuyByCity[rec.city] = rec.sell_price_min;
        if (!baseBuy || rec.sell_price_min < baseBuy.price) baseBuy = { city: rec.city, price: rec.sell_price_min };
      }
      const baseSource = baseBuy && (craftCostPerUnit === null || baseBuy.price < craftCostPerUnit) ? 'buy' : 'craft';
      const baseCostPerUnit = baseSource === 'buy' ? baseBuy.price : craftCostPerUnit;
      const perUnitCount = ENCHANT_MATERIAL_COUNT[itemSlot];
      let stepsAllPriced = enchantStepIds.length === 0 || perUnitCount !== undefined;
      const steps = enchantStepIds.map((materialId, i) => {
        let cheapest = null;
        for (const city of queryCities) {
          const price = materialByCity[materialId]?.[city]?.sell_price_min;
          if (price && (!cheapest || price < cheapest.price)) cheapest = { city, price };
        }
        if (!cheapest) stepsAllPriced = false;
        return {
          level: i + 1, materialId, materialName: resolveItemName(materialId), count: perUnitCount,
          cheapestCity: cheapest ? cheapest.city : null, cheapestPrice: cheapest ? cheapest.price : null,
          cityPrices: cityPriceList(materialByCity[materialId] || {}, queryCities),
          cost: cheapest ? cheapest.price * perUnitCount : null,
        };
      });
      const stepsCostPerUnit = steps.reduce((sum, st) => sum + (st.cost || 0), 0);
      hasAllPrices = baseCostPerUnit !== null && stepsAllPriced;
      effectiveCostPerUnit = (baseCostPerUnit || 0) + stepsCostPerUnit;
      // Для .0-предмета без «зачарования после крафта» это лишь выбор «купить или скрафтить» — отдельным полем baseChoice.
      enchantAfterCraft = {
        forced: enchantAfterForced,
        targetLevel: targetEnchant, capped: enchantCapped, baseSource, baseBuy, baseCraftCostPerUnit: craftCostPerUnit,
        baseCostPerUnit, steps, stepsCostPerUnit,
      };
    }
    const finishedCityData = finishedByCity[finishedQueryId] || {};
    const sellPrices = queryCities.map((city) => {
      const rec = finishedCityData[city];
      return { city, sellMin: rec?.sell_price_min || null, buyMax: rec?.buy_price_max || null };
    });
    const taxRate = getSalesTaxRate(req);
    // Чёрный Рынок (по галочке): только покупает, налог свой — мгновенная продажа в его Buy Order. Лучшее место выбираем по цене ПОСЛЕ
    // налога города: у ЧР цена выше, но и налог выше.
    if (blackMarket) {
      const bmRec = Object.values(finishedCityData).find((rec) => normLocation(rec.city) === 'blackmarket');
      if (bmRec) sellPrices.push({ city: bmRec.city, sellMin: null, buyMax: bmRec.buy_price_max || null, blackMarket: true });
    }
    const instantTax = (sp) => (sp.blackMarket ? bmTaxRate : taxRate);
    let bestSell = null;
    for (const sp of sellPrices) {
      if (sp.buyMax && (!bestSell || sp.buyMax * (1 - instantTax(sp)) > bestSell.price * (1 - bestSell.taxRate))) {
        bestSell = { city: sp.city, price: sp.buyMax, blackMarket: !!sp.blackMarket, taxRate: instantTax(sp) };
      }
    }
    const netSellPrice = bestSell ? bestSell.price * (1 - bestSell.taxRate) : null;
    const profitPerUnit = netSellPrice !== null ? netSellPrice - effectiveCostPerUnit : null;

    // Вторая цифра рядом с мгновенной: терпеливая продажа по истории сделок. Не роняем весь расчёт,
    // если история не загрузилась — тогда просто нет блока терпеливой продажи.
    let patientSell = null;
    let qualityComparison = null;
    try {
      const days = parseBulkDays(req);
      const locations = queryCities.map((c) => c.replace(/\s+/g, ''));
      // Один запрос истории по всем 5 качествам: качество сильно влияет на ликвидность (Отличное может продаваться
      // в 100+ раз быстрее Обычного), а себестоимость от качества не зависит — поэтому сравнение бесплатное.
      const history = await fetchHistoryBatched([finishedQueryId], days * 24, ALL_QUALITIES.join(','), blackMarket ? [...locations, BM_QUERY_LOCATION] : locations);
      const forQuality = (q) => computePatientSell({ history, itemId: finishedQueryId, days, quantity, taxRate, costPerUnit: effectiveCostPerUnit, queryCities, quality: q, marketShare, blackMarketTaxRate: blackMarket ? bmTaxRate : null });
      patientSell = forQuality(quality);
      if (patientSell && sellThreshold) patientSell.threshold = computeSellThreshold(patientSell.cities, sellThreshold, quantity, marketShare);
      // План продажи по умолчанию: ВСЕ прибыльные города (у каждого свой налог: у ЧР — свой), партия по индексу профита (maxProfitCityAllocation).
      // Допуск цены относится к плану закупки, а не продажи.
      if (patientSell) {
        const profitableCities = patientSell.byCity.filter((c) => c.profitPerUnit > 0);
        patientSell.plan = maxProfitCityAllocation(
          (profitableCities.length ? profitableCities : patientSell.byCity).map((c) => ({ city: c.city, avgPrice: c.avgSellPrice, avgDailyVolume: c.avgDailyVolume, profitPerUnit: c.profitPerUnit, profitIndex: c.profitIndex })),
          quantity, { marketShare },
        );
        if (patientSell.plan.cities.length) {
          const total = patientSell.plan.cities.reduce((s, c) => s + c.qty, 0);
          const net = (city) => patientSell.byCity.find((b) => b.city === city).netPrice;
          patientSell.plan.netPricePerUnit = patientSell.plan.cities.reduce((s, c) => s + c.qty * net(c.city), 0) / total;   // по налогу каждого города
          patientSell.plan.profitPerUnit = patientSell.plan.netPricePerUnit - effectiveCostPerUnit;
        }
      }
      qualityComparison = ALL_QUALITIES.map((q) => {
        const p = forQuality(q);
        return p && { quality: q, avgSellPrice: p.avgSellPrice, avgDailyVolume: p.avgDailyVolume, daysToSellBatch: p.daysToSellBatch, profitPerUnit: p.profitPerUnit };
      }).filter(Boolean);
    } catch (err) {
      console.error('не удалось загрузить историю для терпеливой продажи:', err.message);
    }

    // Потолок себестоимости и полоса цены продажи (из «Плана крупной партии», слитого в блок Sell Order):
    // «Проходит ли по потолку?» и профит при продаже в заданной полосе цен. Без полосы — по средней цене истории.
    const ceilingParam = parseFloat(req.query.ceiling) > 0 ? parseFloat(req.query.ceiling) : null;
    let sellLowParam = parseFloat(req.query.sellLow) > 0 ? parseFloat(req.query.sellLow) : null;
    let sellHighParam = parseFloat(req.query.sellHigh) > 0 ? parseFloat(req.query.sellHigh) : null;
    let sellPlan = null;
    if (ceilingParam !== null || sellLowParam !== null || sellHighParam !== null) {
      if (sellLowParam === null) sellLowParam = sellHighParam;
      if (sellHighParam === null) sellHighParam = sellLowParam;
      if (sellLowParam === null && patientSell) { sellLowParam = patientSell.avgSellPrice; sellHighParam = patientSell.avgSellPrice; }
      if (sellLowParam !== null && sellHighParam !== null && sellHighParam < sellLowParam) [sellLowParam, sellHighParam] = [sellHighParam, sellLowParam];
      const netLow = sellLowParam !== null ? sellLowParam * (1 - taxRate) : null;
      const netHigh = sellHighParam !== null ? sellHighParam * (1 - taxRate) : null;
      sellPlan = {
        ceiling: ceilingParam, withinCeiling: ceilingParam !== null ? effectiveCostPerUnit <= ceilingParam : null,
        sellLow: sellLowParam, sellHigh: sellHighParam, netLow, netHigh,
        profitLow: netLow !== null ? netLow - effectiveCostPerUnit : null, profitHigh: netHigh !== null ? netHigh - effectiveCostPerUnit : null,
        totalLow: netLow !== null ? (netLow - effectiveCostPerUnit) * quantity : null, totalHigh: netHigh !== null ? (netHigh - effectiveCostPerUnit) * quantity : null,
      };
    }

    // Время закупки сырья и весь цикл (закупка + продажа): считаем по истории торгов самих материалов.
    let acquire = null;
    try {
      const days = parseBulkDays(req);
      const locations = queryCities.map((c) => c.replace(/\s+/g, ''));
      const rows = [];
      const pricesOf = (byCityRecords) => Object.fromEntries(
        Object.entries(byCityRecords || {}).filter(([c, rec]) => queryCities.includes(c) && rec && rec.sell_price_min).map(([c, rec]) => [c, rec.sell_price_min]),
      );
      if (enchantAfterCraft && enchantAfterCraft.baseSource === 'buy') {
        rows.push({ resource: itemId, resourceName: resolveItemName(itemId), queryId: itemId, needed: quantity, city: enchantAfterCraft.baseBuy.city, priceByCity: baseBuyByCity });
      } else {
        recipeBreakdown.forEach((r) => {
          if (r.materialSource === 'refine' && r.refineOption) {
            // Материал перерабатываем сами — закупаем не готовый слиток/кожу, а сырьё и материал предыдущего тира: столько, чтобы после
            // возврата при переработке хватило ровно на нужное число материала (neededToBuy уже учитывает возврат при крафте гира).
            r.refineOption.components.forEach((comp, i) => rows.push({
              resource: `${r.resource}|${comp.id}`, parent: r.resource, source: 'refine', role: i === 0 ? 'raw' : 'prev',
              resourceName: `${r.resourceName} — ${i === 0 ? 'сырьё' : 'материал пред. тира'} (переработка)`, queryId: comp.id,
              needed: Math.ceil(r.neededToBuy * comp.count * (1 - r.refineOption.rate)), city: comp.city,
              priceByCity: pricesOf(materialByCity[comp.id]),
            }));
            return;
          }
          rows.push({
            resource: r.resource, parent: r.resource, source: 'buy', resourceName: r.resourceName, queryId: r.queryId, needed: r.neededToBuy, city: r.cheapestCity,
            priceByCity: pricesOf(materialByCity[r.queryId]),
          });
        });
      }
      if (enchantAfterCraft) {
        for (const st of enchantAfterCraft.steps) rows.push({
          resource: st.materialId, resourceName: st.materialName, queryId: st.materialId, needed: st.count * quantity, city: st.cheapestCity,
          priceByCity: pricesOf(materialByCity[st.materialId]),
        });
      }
      const ids = [...new Set(rows.map((r) => r.queryId))];
      const matHistory = await fetchHistoryBatched(ids, days * 24, 1, locations);
      acquire = computeAcquireTime({ rows, history: matHistory, days, marketShare, priceTolerance });
      // Весь цикл: закупка по плану (узкое место) + продажа по плану (если плана нет — по общему обороту, как раньше)
      const sellDays = patientSell && patientSell.plan && patientSell.plan.totalDays !== null ? patientSell.plan.totalDays : (patientSell ? patientSell.daysToSellBatch : null);
      acquire.cycleDays = acquire.days !== null && sellDays !== null && sellDays !== undefined ? acquire.days + sellDays : null;
      // Во сколько обходится ускорение: план закупки дороже «всё в самом дешёвом городе» на overpay за партию
      acquire.priceTolerance = priceTolerance;
      acquire.overpayTotal = acquire.byResource.reduce((sum, r) => sum + (r.plan ? (r.plan.avgPrice - r.plan.bestPrice) * r.needed : 0), 0);
    } catch (err) {
      console.error('не удалось посчитать время закупки сырья:', err.message);
    }

    // Логистика: галочка «Учитывать телепорт» — материалы покупаются в разных городах и едут в город сборки,
    // готовый предмет — в город продажи; «домашний» город подбирается автоматически.
    let teleport = null;
    if (req.query.teleport === 'true') {
      const travelCities = queryCities.filter((c) => normLocation(c) !== 'caerleon');
      let materials = recipe.resources.map((r) => {
        const queryId = effectiveRecipeResourceId(r.resource, recipeEnchant);
        const priceByCity = {};
        for (const city of travelCities) {
          const price = materialByCity[queryId]?.[city]?.sell_price_min;
          if (price) priceByCity[city] = price;
        }
        return {
          resource: r.resource, resourceName: resolveItemName(r.resource), priceByCity,
          needed: recipeBreakdown.find((b) => b.resource === r.resource).neededToBuy,
        };
      });
      if (enchantAfterCraft) {
        // Схема «чарю»: если базу купили — везём саму вещь, а не сырьё рецепта; руны/души — из своих дешёвых городов.
        if (enchantAfterCraft.baseSource === 'buy') {
          const priceByCity = Object.fromEntries(Object.entries(baseBuyByCity).filter(([c]) => travelCities.includes(c)));
          materials = [{ resource: itemId, resourceName: resolveItemName(itemId), priceByCity, needed: quantity }];
        }
        for (const st of enchantAfterCraft.steps) {
          const priceByCity = {};
          for (const city of travelCities) {
            const price = materialByCity[st.materialId]?.[city]?.sell_price_min;
            if (price) priceByCity[city] = price;
          }
          materials.push({ resource: st.materialId, resourceName: st.materialName, priceByCity, needed: st.count * quantity });
        }
      }
      const instantByCity = {};
      for (const sp of sellPrices) if (sp.buyMax && travelCities.includes(sp.city)) instantByCity[sp.city] = sp.buyMax;
      const patientByCity = patientSell
        ? Object.fromEntries(patientSell.cities.filter((c) => travelCities.includes(c.city)).map((c) => [c.city, c.avgPrice]))
        : null;
      // Материалы без данных о весе перевозить «бесплатно» нельзя молча: считаем их отдельно и честно перечисляем (unweighted).
      const unweighted = materials.filter((m) => !TRAVEL_WEIGHTS[m.resource]).map((m) => m.resourceName);
      if (!TRAVEL_WEIGHTS[itemId]) unweighted.push(resolveItemName(itemId));
      teleport = planCraftTeleport({
        materials: materials.filter((m) => TRAVEL_WEIGHTS[m.resource]),
        finished: { itemId, qty: quantity, instantByCity, patientByCity }, homes: travelCities, taxRate, silverPerUnit: recipe.silver || 0,
      });
      if (teleport) teleport.unweighted = unweighted;
    }

    // Сравнение по тирам: тот же предмет (семейство) на всех тирах — себестоимость и лучшая цена продажи по каждому,
    // качество для каждого тира выбирается автоматически (то, где выше профит). Без него тир приходится долго
    // перебирать руками: разница между тирами бывает решающей (T4.2 Авалон и т.п.).
    let tierComparison = null;
    try {
      tierComparison = await computeTierComparison({
        itemId, enchant, targetEnchant, enchantAfterRequested, enchantCapped, rrrOpts, taxRate, queryCities, quality, marketShare,
        days: parseBulkDays(req),
      });
    } catch (err) {
      console.error('не удалось посчитать сравнение по тирам:', err.message);
    }

    res.json({
      itemId, enchant, quality, quantity, marketShare, priceTolerance, materialHours, setupFeeRate: SETUP_FEE_RATE, blackMarket, bmTaxRate: blackMarket ? bmTaxRate : null,
      // rrr — средняя ставка возврата по возвращаемым материалам (у каждого материала своя, см. recipe[].rrr)
      rrrPreset: { id: 'custom', label: rrrOptionsLabel(rrrOpts), ...rrrOpts, rrr: returnableNominal > 0 ? returnableSaved / returnableNominal : 0 },
      rrrOptions: rrrOpts,
      refineRate: refineParams.rate, refineRrr: refineParams.refineRrr, refineRrrCustom: refineParams.refineRrrCustom,   // возврат при переработке сырья (для «переработать самому»)
      cities: queryCities,
      recipe: recipeBreakdown,
      hasAllMaterialPrices: hasAllPrices,
      materialCostPerUnit,
      effectiveCostPerUnit,
      totalCost: effectiveCostPerUnit * quantity,
      sellPrices,
      bestSell,
      taxRate,
      netSellPrice,
      profitPerUnit,
      patientSell,
      qualityComparison,
      tierComparison,
      sellPlan,
      acquire,
      enchantAfterCraft: enchantAfterRequested ? enchantAfterCraft : null,
      baseChoice: enchantAfterRequested ? null : enchantAfterCraft,   // .0-предмет: «купить готовый или скрафтить» (без зачарования)
      teleport,
      totalProfit: profitPerUnit !== null ? profitPerUnit * quantity : null,
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'не удалось посчитать крафт', details: err.message });
  }
});

// --- Сканер возможностей (спред по всему каталогу) ---
const SCAN_CACHE_TTL_MS = 5 * 60 * 1000;
let scanCache = null;

app.get('/api/opportunities', async (req, res) => {
  try {
    const taxRate = getSalesTaxRate(req);
    // Минимальная абсолютная прибыль с одной штуки (серебро): отсекает дешёвое сырьё с эффектным % спреда, но копеечной прибылью.
    const minProfit = Math.max(parseFloat(req.query.minProfit) || 0, 0);
    const scanKey = `${taxRate}:${minProfit}`;
    if (scanCache && scanCache.key === scanKey && Date.now() - scanCache.ts < SCAN_CACHE_TTL_MS) return res.json(scanCache.data);

    // Каталог × зачарование .0–.4: каждая версия — отдельная позиция рынка.
    const variantByQuery = new Map();
    for (const item of ITEMS) for (const v of enchantVariants(item)) variantByQuery.set(v.queryId, { ...v, baseId: item.id });
    const data = await fetchPricesBatched([...variantByQuery.keys()], 1);

    const byItem = {};
    for (const rec of data) {
      if (!byItem[rec.item_id]) byItem[rec.item_id] = [];
      byItem[rec.item_id].push(rec);
    }

    const now = Date.now();
    const results = [];
    for (const queryId of Object.keys(byItem)) {
      const variant = variantByQuery.get(queryId);
      if (!variant) continue;
      const itemId = variant.baseId;
      const records = byItem[queryId];
      let bestBuy = null; // самая низкая sell_price_min — где дешевле всего купить
      let bestSell = null; // самая высокая buy_price_max — где дороже всего продать
      for (const rec of records) {
        if (rec.sell_price_min && (!bestBuy || rec.sell_price_min < bestBuy.price)) {
          bestBuy = { city: rec.city, price: rec.sell_price_min, date: rec.sell_price_min_date };
        }
        if (rec.buy_price_max && (!bestSell || rec.buy_price_max > bestSell.price)) {
          bestSell = { city: rec.city, price: rec.buy_price_max, date: rec.buy_price_max_date };
        }
      }
      if (!bestBuy || !bestSell) continue;

      // Прибыль считаем после налога с продажи — сырой спред завышает выгоду.
      const grossSellPrice = bestSell.price;
      const spread = grossSellPrice * (1 - taxRate) - bestBuy.price;
      if (spread <= 0 || spread < minProfit) continue;
      const spreadPct = (spread / bestBuy.price) * 100;
      // Свежесть — по двум котировкам самой сделки, а не по любым записям предмета.
      const freshMinutes = dealAgeMinutes([bestBuy.date, bestSell.date], now);
      results.push({ itemId, enchant: variant.enchant, queryId, bestBuy, bestSell, grossSellPrice, taxRate, spread, spreadPct, freshMinutes });
    }

    results.sort((a, b) => b.spreadPct - a.spreadPct);

    // Стадия 2: у ВСЕХ позиций со спредом проверяем реальный объём сделок за 24ч —
    // не только у топ-60 по спреду, иначе туда чаще всего попадают нишевые вещи
    // с огромным спредом на 1-2 случайных ордерах, и почти всё потом отсеивается.
    const candidates = results;
    const MIN_VOLUME_24H = 3; // меньше — считаем "по факту не продаётся"

    let withVolume = candidates;
    try {
      const historyData = await fetchHistoryBatched(candidates.map((c) => c.queryId), 24, 1, CITIES);
      withVolume = candidates
        // Объём — только по двум городам сделки: ликвидность в других городах мне не поможет.
        .map((c) => ({ ...c, volume24h: totalVolume(historyData, c.queryId, [c.bestBuy.city, c.bestSell.city]) }))
        .filter((c) => c.volume24h >= MIN_VOLUME_24H)
        .map((c) => ({ ...c, score: opportunityScore(c.spreadPct, c.volume24h) * freshnessDecay(c.freshMinutes) }))
        .sort((a, b) => b.score - a.score);
    } catch (err) {
      // Если история не смогла подгрузиться — не роняем весь сканер, просто отдаём
      // без данных об объёме (клиент это отобразит как "не проверено").
      console.error('не удалось проверить историю для сканера возможностей:', err.message);
      withVolume = candidates.map((c) => ({ ...c, volume24h: null }));
    }

    const top = withVolume.slice(0, 25);
    scanCache = { key: scanKey, ts: Date.now(), data: top };
    res.json(top);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'не удалось выполнить скан возможностей', details: err.message });
  }
});

// --- Чёрный Рынок ---
// ВАЖНО: параметр локации для Black Market ("BlackMarket", без пробела) подобран
// по аналогии с FortSterling — официально не подтверждено. Если колонка/сканер БМ
// пустые после деплоя — возможно, нужно поправить это значение.
const BM_QUERY_LOCATION = 'BlackMarket';
let bmScanCache = null;

app.get('/api/bm-opportunities', async (req, res) => {
  try {
    // Как и остальные сканеры — только активные города (без Brecilien/Caerleon, если они выключены).
    const citiesParam = req.query.cities;
    const queryCities = citiesParam ? citiesParam.split(',').map((s) => s.trim()).filter(Boolean) : Object.values(CITY_DISPLAY);
    const bmTaxRate = getBmTaxRate(req);
    const cacheKey = `${queryCities.slice().sort().join(',')}:${bmTaxRate}`;
    if (bmScanCache && bmScanCache.key === cacheKey && Date.now() - bmScanCache.ts < SCAN_CACHE_TTL_MS) return res.json(bmScanCache.data);
    const bmLocations = [...queryCities.map((c) => c.replace(/\s+/g, '')), BM_QUERY_LOCATION];

    // Гир × зачарование .0–.4: на БМ зачарованные версии покупают по своим (более высоким) ценам.
    const variantByQuery = new Map();
    for (const item of ITEMS.filter((i) => GEAR_IDS.has(i.id))) {
      for (const v of enchantVariants(item)) variantByQuery.set(v.queryId, { ...v, baseId: item.id });
    }
    const gearIds = [...variantByQuery.keys()];
    const CHUNK = 120;
    const chunks = [];
    for (let i = 0; i < gearIds.length; i += CHUNK) chunks.push(gearIds.slice(i, i + CHUNK));

    const allRecords = [];
    for (const chunk of chunks) {
      const key = `bm:1:${bmLocations.join(',')}:${chunk.slice().sort().join(',')}`;
      const cached = cache.get(key);
      let data;
      if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
        data = cached.data;
      } else {
        const url = `${AODP_BASE}/${encodeURIComponent(chunk.join(','))}?locations=${bmLocations.join(',')}&qualities=1`;
        const response = await aodpFetch(url);
        if (!response.ok) throw new Error(`AODP responded ${response.status}`);
        data = await response.json();
        cache.set(key, { ts: Date.now(), data });
      }
      allRecords.push(...data);
    }

    const byItem = {};
    for (const rec of allRecords) {
      if (!byItem[rec.item_id]) byItem[rec.item_id] = [];
      byItem[rec.item_id].push(rec);
    }

    const now = Date.now();
    const results = [];
    for (const queryId of Object.keys(byItem)) {
      const variant = variantByQuery.get(queryId);
      if (!variant) continue;
      const itemId = variant.baseId;
      const records = byItem[queryId];
      let bestBuy = null;
      let bmSell = null;
      for (const rec of records) {
        const isBM = rec.city === 'Black Market';
        if (!isBM && rec.sell_price_min && (!bestBuy || rec.sell_price_min < bestBuy.price)) {
          bestBuy = { city: rec.city, price: rec.sell_price_min, date: rec.sell_price_min_date };
        }
        if (isBM && rec.buy_price_max && (!bmSell || rec.buy_price_max > bmSell.price)) {
          bmSell = { price: rec.buy_price_max, date: rec.buy_price_max_date };
        }
      }
      if (!bestBuy || !bmSell) continue;
      // Прибыль — после налога и сбора за размещение на БМ.
      const profit = bmSell.price * (1 - bmTaxRate) - bestBuy.price;
      if (profit <= 0) continue;
      const profitPct = (profit / bestBuy.price) * 100;
      // Свежесть — по двум котировкам самой сделки (покупка в городе + цена БМ), а не по всем записям предмета.
      const freshMinutes = dealAgeMinutes([bestBuy.date, bmSell.date], now);
      results.push({ itemId, enchant: variant.enchant, queryId, bestBuy, bmPrice: bmSell.price, bmTaxRate, profit, profitPct, freshMinutes });
    }

    results.sort((a, b) => b.profitPct - a.profitPct);

    const candidates = results;
    const MIN_BM_VOLUME_24H = 3;
    let withVolume = candidates;
    try {
      const historyData = await fetchHistoryBatched(candidates.map((c) => c.queryId), 24, 1, [BM_QUERY_LOCATION]);
      withVolume = candidates
        .map((c) => ({ ...c, bmVolume24h: totalVolume(historyData, c.queryId) }))
        .filter((c) => c.bmVolume24h >= MIN_BM_VOLUME_24H)
        .map((c) => ({ ...c, score: opportunityScore(c.profitPct, c.bmVolume24h) * freshnessDecay(c.freshMinutes) }))
        .sort((a, b) => b.score - a.score);
    } catch (err) {
      console.error('не удалось проверить историю Чёрного Рынка:', err.message);
      withVolume = candidates.map((c) => ({ ...c, bmVolume24h: null }));
    }

    const top = withVolume.slice(0, 25);
    bmScanCache = { key: cacheKey, ts: Date.now(), data: top };
    res.json(top);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'не удалось выполнить скан Чёрного Рынка', details: err.message });
  }
});

// --- План крупной партии ---
// Схема "закупаю бай-ордерами, продаю партией за несколько дней": цены берутся не из мгновенных
// котировок, а как средневзвешенные по объёму за период истории, а вместо "есть ли спред" считаем,
// сколько дней уйдёт на закупку сырья и на распродажу партии, не обваливая рынок.

// Множитель скора за длину цикла (закупка + распродажа): чем дольше капитал заморожен, тем хуже.
// Дольше 30 дней — предупреждение в интерфейсе, дольше 90 — скор почти обнуляется.
function bulkCycleDecay(totalDays) {
  if (totalDays === null || totalDays === undefined) return 0;
  if (totalDays <= 7) return 1;
  if (totalDays <= 14) return 0.8;
  if (totalDays <= 30) return 0.5;
  if (totalDays <= 90) return 0.2;
  return 0.05;
}

// Статистика по городам за период: средневзвешенная цена и объём/день.
// quality — необязательный фильтр: история, запрошенная сразу по всем 5 качествам, приходит рядами с полем quality.
function cityStats(historyData, itemId, days, quality) {
  const acc = {};
  for (const series of historyData) {
    if (series.item_id !== itemId) continue;
    if (quality !== undefined && series.quality !== quality) continue;
    // Несколько рядов одного города (разные качества, если фильтр не задан) складываем, а не затираем.
    const a = acc[series.location] || (acc[series.location] = { volume: 0, weightedSum: 0 });
    for (const p of series.data || []) {
      a.volume += p.item_count;
      a.weightedSum += p.avg_price * p.item_count;
    }
  }
  const out = {};
  for (const [location, a] of Object.entries(acc)) {
    if (a.volume > 0) out[location] = { avgPrice: a.weightedSum / a.volume, totalVolume: a.volume, avgDailyVolume: a.volume / days };
  }
  return out;
}

// Терпеливая продажа готового предмета: не бьём по чужому ордеру на покупку (мгновенная продажа), а выставляем
// свой ордер на продажу и ждём. Цену берём по истории сделок (средневзвешенная по объёму за период),
// а не по текущему sell_price_min — иначе получится красивая маржа на предмете, который висит неделями
// («стать инвестором предмета»). Объём/день и дни на распродажу партии показывают, насколько это реально.
function computePatientSell({ history, itemId, days, quantity, taxRate, costPerUnit, queryCities, quality, marketShare = 1, setupFee = SETUP_FEE_RATE, blackMarketTaxRate = null }) {
  const allowed = new Set(queryCities.map(normLocation));
  if (blackMarketTaxRate !== null) allowed.add('blackmarket');
  const stats = Object.entries(cityStats(history, itemId, days, quality)).filter(([city]) => allowed.has(normLocation(city)));
  if (stats.length === 0) return null;
  // Свой Sell Order: налог с продажи + сбор за размещение (Setup Fee 2.5% от цены ордера, не возвращается).
  const netFactor = 1 - taxRate - setupFee;
  // Чёрный Рынок: своя ставка (налог + Setup Fee уже внутри, второй раз сбор не берём); у обычных городов — налог + сбор.
  const isBm = (city) => normLocation(city) === 'blackmarket';
  const netFactorOf = (city) => (isBm(city) ? 1 - blackMarketTaxRate : netFactor);

  let bestCity = null;
  let allVolume = 0;
  let allWeighted = 0;
  for (const [city, st] of stats) {
    allVolume += st.totalVolume;
    allWeighted += st.avgPrice * st.totalVolume;
    if (!bestCity || st.avgPrice > bestCity.avgPrice) bestCity = { city, avgPrice: st.avgPrice };
  }

  // ЧЕСТНОЕ усреднение: продавать по плану имеет смысл только там, где после налога и сбора выходит прибыль. Наивное среднее по ВСЕМ
  // городам смешивало убыточные рынки с прибыльными (на T4-мече знак профита выходил перевёрнутым: −2427 вместо +459 за штуку).
  // Если прибыльных городов нет — показываем лучший по цене (честный минус), а не выдуманное среднее.
  const profitable = stats.filter(([city, st]) => st.avgPrice * netFactorOf(city) - costPerUnit > 0);
  const used = profitable.length ? profitable : stats.filter(([city]) => city === bestCity.city);
  let usedVolume = 0;
  let usedWeighted = 0;
  let usedNetWeighted = 0;
  for (const [city, st] of used) { usedVolume += st.totalVolume; usedWeighted += st.avgPrice * st.totalVolume; usedNetWeighted += st.avgPrice * netFactorOf(city) * st.totalVolume; }
  const avgSellPrice = usedWeighted / usedVolume;
  const avgDailyVolume = usedVolume / days;
  const netSellPrice = usedNetWeighted / usedVolume;                    // чистая цена — по налогу КАЖДОГО города (ЧР ≠ обычный)
  return {
    days,
    avgSellPrice,                                  // средняя цена ПЛАНА (только прибыльные города)
    marketAvgPrice: allWeighted / allVolume,       // наивное среднее по всем городам — только для справки
    marketDailyVolume: allVolume / days,           // оборот всех городов (для справки)
    setupFee,
    planCities: used.map(([city]) => city),
    skippedCities: profitable.length ? stats.filter(([city]) => !used.some(([c]) => c === city)).map(([city]) => city) : [],
    bestCity,
    cities: stats.map(([city, st]) => ({ city, avgPrice: st.avgPrice, avgDailyVolume: st.avgDailyVolume, netFactor: netFactorOf(city) })),
    // Разбивка по всем активным городам (порог продажи — лишь необязательный фильтр сверху).
    byCity: stats
      .map(([city, st]) => {
        const netPrice = st.avgPrice * netFactorOf(city);
        const profitPerUnit = netPrice - costPerUnit;
        // Индекс профита города: тот же opportunityScore, что ранжирует сканеры (профит% × log2(2 + оборот)) — город с двумя сделками
        // в неделю не обходит честно ликвидный, но чуть менее маржинальный.
        const profitIndex = profitPerUnit > 0 && costPerUnit > 0 ? opportunityScore((profitPerUnit / costPerUnit) * 100, st.avgDailyVolume) : 0;
        return { city, avgSellPrice: st.avgPrice, avgDailyVolume: st.avgDailyVolume, netPrice, taxRate: 1 - netFactorOf(city), blackMarket: isBm(city), profitPerUnit, profitIndex };
      })
      .sort((a, b) => b.avgSellPrice - a.avgSellPrice),
    avgDailyVolume,
    // Дневной оборот по истории — оборот ВСЕГО рынка, а не гарантированно доступный лично тебе объём: конкуренты тоже
    // держат ордера на продажу и часто перевыставляют их, чтобы быть первыми в очереди. Поэтому срок распродажи
    // считаем по реалистичной доле оборота (marketShare), а не по всему объёму.
    marketShare,
    daysToSellBatch: avgDailyVolume > 0 ? quantity / (avgDailyVolume * marketShare) : null,
    netSellPrice,
    profitPerUnit: netSellPrice - costPerUnit,
  };
}

// --- Стоимость телепорта ---
// Быстрое перемещение между городами платное: чем тяжелее и «дороже» груз, тем дороже. Формула
// (подтверждена двумя независимыми гайдами): 150 × вес × количество × коэффициент × дистанция,
// округление вверх до целого на стек, затем × дистанция. Вес и коэффициент (fasttravelfactor) — из items.xml
// (data/travel-weights.json, scripts/extract_travel_weights.py). Серверный множитель = 1 (живое значение
// нигде, кроме клиента, не видно).
const TRAVEL_WEIGHTS = require('./data/travel-weights.json');
const TELEPORT_BASE_COST = 150;

// Топология (со слов игрока): кольцо из 5 городов — Люмхёрст–Бриджуотч–Мартлок–Тетфорд–Форт Стерлинг–обратно.
// Соседние города — дистанция 1, через город — 2. С Бресилиеном и в него — всегда 2. Каэрлеон исключён:
// телепорт оттуда требует полностью пустого инвентаря (с грузом не перемещаться).
const TELEPORT_RING = ['Lymhurst', 'Bridgewatch', 'Martlock', 'Thetford', 'Fort Sterling'];
function teleportDistance(from, to) {
  const a = String(from).replace(/\s+/g, '').toLowerCase();
  const b = String(to).replace(/\s+/g, '').toLowerCase();
  if (a === b) return 0;
  if (a === 'caerleon' || b === 'caerleon') return null;
  if (a === 'brecilien' || b === 'brecilien') return 2;
  const ring = TELEPORT_RING.map((c) => c.replace(/\s+/g, '').toLowerCase());
  const i = ring.indexOf(a);
  const j = ring.indexOf(b);
  if (i === -1 || j === -1) return null;
  const step = Math.abs(i - j);
  return step === 1 || step === ring.length - 1 ? 1 : 2;
}

// Стоимость перевозки qty штук предмета на distance «плеч» (null — веса нет в данных или маршрут недоступен).
function teleportStackCost(itemId, qty, distance) {
  const tw = TRAVEL_WEIGHTS[itemId];
  if (!tw || distance === null || distance === undefined) return null;
  if (distance === 0) return 0;
  return Math.ceil(tw.weight * qty * tw.fastTravelFactor * TELEPORT_BASE_COST) * distance;
}

// Лучший «домашний» город сборки: материалы едут из городов, где они дешевле с учётом дороги, готовый предмет —
// в город с лучшей ценой (за вычетом дороги). Перебираем все города-кандидаты и берём с максимальной прибылью —
// игрока не спрашиваем, где он крафтит. materials: [{ resource, resourceName, needed, priceByCity }],
// finished: { itemId, qty, instantByCity, patientByCity } (цены продажи по городам, patientByCity может быть null).
function planCraftTeleport({ materials, finished, homes, taxRate, silverPerUnit = 0 }) {
  const qty = finished.qty;
  let best = null;
  for (const home of homes) {
    let materialsCost = 0;
    let legsCost = 0;
    const legs = [];
    let feasible = true;
    for (const m of materials) {
      let pick = null;
      for (const [city, price] of Object.entries(m.priceByCity)) {
        const distance = teleportDistance(city, home);
        const leg = teleportStackCost(m.resource, m.needed, distance);
        if (leg === null) continue;
        const total = price * m.needed + leg;
        if (!pick || total < pick.total) pick = { city, price, distance, leg, total };
      }
      if (!pick) { feasible = false; break; }
      materialsCost += pick.price * m.needed;
      legsCost += pick.leg;
      legs.push({ resource: m.resource, resourceName: m.resourceName, fromCity: pick.city, price: pick.price, needed: m.needed, distance: pick.distance, cost: pick.leg });
    }
    if (!feasible) continue;

    const sellOption = (byCity) => {
      let bestSell = null;
      for (const [city, price] of Object.entries(byCity || {})) {
        const distance = teleportDistance(home, city);
        let leg = teleportStackCost(finished.itemId, qty, distance);
        if (leg === null && distance !== null && !TRAVEL_WEIGHTS[finished.itemId]) leg = 0; // нет веса — считаем 0 и говорим об этом (unweighted)
        if (leg === null) continue;
        const net = price * (1 - taxRate) * qty - leg;
        if (!bestSell || net > bestSell.net) bestSell = { city, price, distance, cost: leg, net };
      }
      return bestSell;
    };
    const costPerUnit = (materialsCost + legsCost) / qty + silverPerUnit;
    const instant = sellOption(finished.instantByCity);
    const patient = sellOption(finished.patientByCity);
    const withProfit = (opt) => (opt ? { ...opt, profitPerUnit: opt.net / qty - costPerUnit } : null);
    const candidate = {
      homeCity: home, materialLegs: legs, legsCost, costPerUnit,
      instant: withProfit(instant), patient: withProfit(patient),
    };
    const score = (c) => (c.patient ? c.patient.profitPerUnit : c.instant ? c.instant.profitPerUnit : -Infinity);
    if (!best || score(candidate) > score(best)) best = candidate;
  }
  return best;
}

// Цены материала по всем выбранным городам (записи AODP по городу → [{ city, price }], от дешёвых к дорогим).
function cityPriceList(cityRecords, queryCities) {
  const out = [];
  for (const city of queryCities) {
    const rec = cityRecords[city];
    if (rec && rec.sell_price_min) out.push({ city, price: rec.sell_price_min });
  }
  return out.sort((a, b) => a.price - b.price);
}

// --- Многогородовой план (закупка сырья и продажа готового предмета) ---
// Ценовой допуск — полоса вокруг ЛУЧШЕЙ цены (для закупки — самой низкой, для продажи — самой высокой): город входит в план,
// если его цена не хуже лучшей больше чем на допуск. Допуск города динамический: чем ликвиднее город по сравнению с городом
// лучшей цены, тем больше он (до maxToleranceMult × базового) — большой объём оправдывает чуть худшую цену, но не «огромную».
// Слишком тонкие города (единицы сделок в неделю) достоверным ценовым сигналом не считаются: одна случайная сделка не должна
// выбить из плана все реально ликвидные города. Без памяти между запросами (считается заново на каждый клик).
// Количество делится между городами плана пропорционально их обороту — так у всех одинаковый срок, и он минимален.
// cities: [{ city, avgPrice, avgDailyVolume }]; side: 'buy' | 'sell'.
function planCityAllocation(cities, quantity, { side, priceTolerance = 0.05, marketShare = 1, maxToleranceMult = 3, minDaily = 1, minShareOfMax = 0.02 } = {}) {
  const priced = cities.filter((c) => c.avgPrice > 0 && c.avgDailyVolume > 0);
  const maxVol = priced.reduce((m, c) => Math.max(m, c.avgDailyVolume), 0);
  // тонкие города не считаем достоверными; если достоверных нет — берём всё, что торгуется
  const reliable = priced.filter((c) => c.avgDailyVolume >= minDaily && c.avgDailyVolume >= maxVol * minShareOfMax);
  const pool = reliable.length ? reliable : priced;
  const excluded = priced.filter((c) => !pool.includes(c)).map((c) => ({ city: c.city, reason: 'слишком тонкий рынок для надёжной цены' }));
  if (pool.length === 0) return { cities: [], excluded, avgPrice: null, bestPrice: null, overpayPct: null, totalDays: null };

  const better = (a, b) => (side === 'buy' ? a < b : a > b);
  const best = pool.reduce((a, b) => (better(b.avgPrice, a.avgPrice) ? b : a));
  const eligible = [];
  for (const c of pool) {
    const mult = Math.min(maxToleranceMult, Math.max(1, c.avgDailyVolume / best.avgDailyVolume));
    const tolerance = priceTolerance * mult;
    const gap = side === 'buy' ? c.avgPrice / best.avgPrice - 1 : 1 - c.avgPrice / best.avgPrice; // насколько цена хуже лучшей
    if (gap <= tolerance + 1e-12) eligible.push({ ...c, tolerance, gap: Math.max(gap, 0) });
    else excluded.push({ city: c.city, reason: `цена хуже лучшей на ${(gap * 100).toFixed(1)}% при допуске ${(tolerance * 100).toFixed(1)}%` });
  }
  const totalVolume = eligible.reduce((sum, c) => sum + c.avgDailyVolume, 0);
  let assigned = 0;
  const rows = eligible.map((c) => {
    const qty = Math.floor((quantity * c.avgDailyVolume) / totalVolume);
    assigned += qty;
    return { city: c.city, avgPrice: c.avgPrice, avgDailyVolume: c.avgDailyVolume, tolerance: c.tolerance, gap: c.gap, qty };
  });
  const top = rows.reduce((a, b) => (b.avgDailyVolume > a.avgDailyVolume ? b : a));
  top.qty += quantity - assigned; // остаток округления — самому ликвидному городу
  for (const r of rows) r.days = r.qty / (r.avgDailyVolume * marketShare);
  const avgPrice = quantity > 0 ? rows.reduce((sum, r) => sum + r.avgPrice * r.qty, 0) / quantity : best.avgPrice;
  return {
    cities: rows.sort((a, b) => (side === 'buy' ? a.avgPrice - b.avgPrice : b.avgPrice - a.avgPrice)),
    excluded, bestPrice: best.avgPrice, avgPrice,
    overpayPct: Math.abs(avgPrice / best.avgPrice - 1) * 100,   // насколько план хуже «всё в один лучший город»
    totalDays: quantity / (totalVolume * marketShare),
  };
}

// Ценовой допуск плана, % (по умолчанию 2): 0–50.
// План ПРОДАЖИ «максимизировать профит»: по умолчанию в план входят ВСЕ прибыльные города (не только узкая полоса вокруг лучшей цены),
// а партия раздаётся по индексу профита города: лучший индекс берёт первым, но не больше «разумной вместимости» — оборот × доля рынка ×
// срок равномерного плана × horizon; остаток сверх вместимости делится по обороту. Тонкие рынки (меньше minDaily сделок в день или
// меньше minShareOfMax от самого ликвидного прибыльного) не считаются надёжным местом продажи и в план не входят.
// cities: [{ city, avgPrice, avgDailyVolume, profitPerUnit, profitIndex }] — уже только прибыльные.
function maxProfitCityAllocation(cities, quantity, { marketShare = 1, minDaily = 1, minShareOfMax = 0.02, horizon = 1.5 } = {}) {
  const withVolume = cities.filter((c) => c.avgDailyVolume > 0);
  const maxVolume = withVolume.reduce((m, c) => Math.max(m, c.avgDailyVolume), 0);
  const excluded = [];
  let eligible = [];
  for (const c of cities) {
    if (!(c.avgDailyVolume > 0)) excluded.push({ city: c.city, reason: 'нет сделок за период' });
    else if (c.avgDailyVolume < minDaily || c.avgDailyVolume < maxVolume * minShareOfMax) excluded.push({ city: c.city, reason: `слишком тонкий рынок (${c.avgDailyVolume.toFixed(1)} сделок в день)` });
    else eligible.push(c);
  }
  if (eligible.length === 0 && withVolume.length > 0) {                     // все города тонкие — берём самый ликвидный, план не должен быть пустым
    const top = withVolume.reduce((a, b) => (b.avgDailyVolume > a.avgDailyVolume ? b : a));
    eligible = [top];
    excluded.splice(0, excluded.length, ...cities.filter((c) => c !== top).map((c) => ({ city: c.city, reason: 'слишком тонкий рынок' })));
  }
  if (eligible.length === 0) return { side: 'sell', strategy: 'maxProfit', bestPrice: null, avgPrice: null, overpayPct: 0, totalDays: null, cities: [], excluded };
  const qty = new Map();
  const spread = (list, amount) => {                                        // по обороту; остаток округления — самому ликвидному
    const volume = list.reduce((s, c) => s + c.avgDailyVolume, 0);
    let assigned = 0;
    for (const c of list) { const q = Math.floor((amount * c.avgDailyVolume) / volume); qty.set(c.city, (qty.get(c.city) || 0) + q); assigned += q; }
    const top = list.reduce((a, b) => (b.avgDailyVolume > a.avgDailyVolume ? b : a));
    qty.set(top.city, (qty.get(top.city) || 0) + amount - assigned);
  };
  const evenDays = quantity / (eligible.reduce((s, c) => s + c.avgDailyVolume, 0) * marketShare);
  let left = quantity;
  for (const c of [...eligible].sort((a, b) => b.profitIndex - a.profitIndex || b.profitPerUnit - a.profitPerUnit)) {
    const capacity = Math.floor(c.avgDailyVolume * marketShare * evenDays * horizon);
    const q = Math.min(capacity, left);
    qty.set(c.city, q);
    left -= q;
  }
  if (left > 0) spread(eligible, left);
  const rows = eligible.map((c) => {
    const q = qty.get(c.city) || 0;
    return { city: c.city, avgPrice: c.avgPrice, avgDailyVolume: c.avgDailyVolume, tolerance: null, qty: q, days: q > 0 ? q / (c.avgDailyVolume * marketShare) : 0, profitPerUnit: c.profitPerUnit, profitIndex: c.profitIndex };
  }).filter((r) => r.qty > 0);
  const total = rows.reduce((s, r) => s + r.qty, 0);
  return {
    side: 'sell', strategy: 'maxProfit',
    bestPrice: Math.max(...rows.map((r) => r.avgPrice)),
    avgPrice: rows.reduce((s, r) => s + r.avgPrice * r.qty, 0) / total,
    overpayPct: 0,
    totalDays: rows.reduce((m, r) => Math.max(m, r.days), 0),
    cities: rows,
    excluded: [...excluded, ...eligible.filter((c) => !rows.some((r) => r.city === c.city)).map((c) => ({ city: c.city, reason: 'партию забрали города с лучшим индексом' }))],
  };
}

function parsePriceTolerance(req) {
  const v = parseFloat(req.query.priceTolerance);
  return Math.min(Math.max(Number.isFinite(v) ? v : 2, 0), 50) / 100;
}

// Время закупки сырья: даже если закупаешь по Sell Order'ам других игроков, собрать нужное количество можно лишь
// так быстро, как этот материал торгуется (а на нашу долю приходится не весь оборот). Считаем по каждому материалу
// в городе, где он дешевле всего; общий срок — по узкому месту (самому медленному материалу), как в плане партии.
// rows: [{ resource, resourceName, queryId, needed, city }]
function computeAcquireTime({ rows, history, days, marketShare = 1, priceTolerance = 0.05 }) {
  const byResource = rows.map((r) => {
    const stats = cityStats(history, r.queryId, days);
    // Многогородовой план закупки: цены по городам (текущие sell_price_min) + оборот из истории, допуск динамический.
    if (r.priceByCity && Object.keys(r.priceByCity).length) {
      const cityList = Object.entries(r.priceByCity)
        .map(([city, price]) => {
          const st = Object.entries(stats).find(([c]) => normLocation(c) === normLocation(city));
          return { city, avgPrice: price, avgDailyVolume: st ? st[1].avgDailyVolume : 0 };
        });
      const plan = planCityAllocation(cityList, r.needed, { side: 'buy', priceTolerance, marketShare });
      if (plan.cities.length) {
        return { resource: r.resource, parent: r.parent, source: r.source, role: r.role, queryId: r.queryId, resourceName: r.resourceName, needed: r.needed, city: plan.cities[0].city, avgDailyVolume: plan.cities.reduce((sum, c) => sum + c.avgDailyVolume, 0), daysToAcquire: plan.totalDays, plan };
      }
    }
    // Оборот берём в городе покупки; если там сделок нет — по всем выбранным городам.
    const cityStat = r.city && Object.entries(stats).find(([c]) => normLocation(c) === normLocation(r.city));
    const avgDailyVolume = cityStat ? cityStat[1].avgDailyVolume : Object.values(stats).reduce((sum, st) => sum + st.avgDailyVolume, 0);
    return {
      resource: r.resource, parent: r.parent, source: r.source, role: r.role, queryId: r.queryId, resourceName: r.resourceName, needed: r.needed, city: r.city, avgDailyVolume,
      daysToAcquire: avgDailyVolume > 0 ? r.needed / (avgDailyVolume * marketShare) : null,
    };
  });
  let bottleneck = null;
  for (const r of byResource) if (r.daysToAcquire !== null && (!bottleneck || r.daysToAcquire > bottleneck.daysToAcquire)) bottleneck = r;
  return { byResource, days: bottleneck ? bottleneck.daysToAcquire : null, bottleneckResource: bottleneck ? bottleneck.resource : null, bottleneckParent: bottleneck ? bottleneck.parent || bottleneck.resource : null };
}

// Порог терпеливой продажи: вместо одного лучшего города — все города, где средняя цена не ниже порога
// (при крупных партиях один город не переварит объём без обвала цены). Показываем суммарный спрос и срок.
function computeSellThreshold(cities, threshold, quantity, marketShare = 1) {
  const above = cities.filter((c) => c.avgPrice >= threshold).sort((a, b) => b.avgPrice - a.avgPrice);
  const totalDailyVolume = above.reduce((sum, c) => sum + c.avgDailyVolume, 0);
  return {
    value: threshold,
    cities: above,
    totalDailyVolume,
    daysToSellBatch: totalDailyVolume > 0 ? quantity / (totalDailyVolume * marketShare) : null,
  };
}

// Чистый расчёт плана партии по уже загруженной истории — общий для одиночного плана и сканера,
// чтобы цифры по одному предмету не могли разойтись между двумя режимами.
function computeBulkPlan(opts, materialHistory, finishedHistory) {
  const { itemId, enchant, quantity, days, rrrOpts, taxRate, costCeiling, queryCities, refineRate = null } = opts;
  let { sellLow, sellHigh } = opts;
  const allowedCities = new Set(queryCities.map(normLocation));
  const inScope = (stats) => Object.fromEntries(Object.entries(stats).filter(([city]) => allowedCities.has(normLocation(city))));

  const recipe = RECIPES[itemId];
  const resourceQueryIds = recipe.resources.map((r) => effectiveRecipeResourceId(r.resource, enchant));
  const finishedQueryId = enchant > 0 ? `${itemId}@${enchant}` : itemId;

  // Материалы: берём город с самой дешёвой средней ценой, где вообще идут торги.
  let hasAllPrices = true;
  let effectiveCostPerUnit = recipe.silver || 0;
  const recipeBreakdown = recipe.resources.map((r, idx) => {
    const queryId = resourceQueryIds[idx];
    const stats = inScope(cityStats(materialHistory, queryId, days));
    // Город закупки — по средней цене с учётом возврата именно в нём (у каждого материала свой RRR).
    let source = null;
    for (const [city, st] of Object.entries(stats)) {
      const best = bestMaterialQuote([{ city, price: st.avgPrice }], r, rrrOpts);
      if (!source || best.effective < source.effective) source = { city, ...st, factor: best.factor, rrr: best.rrr, effective: best.effective };
    }
    // «Переработать самому»: сырьё + предыдущий тир по средней цене за период (минимум по городам), переработка возвращает refineRate.
    let refine = null;
    if (refineRate !== null && !r.noReturn) {
      const priceOf = (id) => {
        let best = null;
        for (const [city, st] of Object.entries(inScope(cityStats(materialHistory, id, days)))) if (!best || st.avgPrice < best.price) best = { city, price: st.avgPrice, avgDailyVolume: st.avgDailyVolume };
        return best;
      };
      const alt = refineAlternative(queryId, priceOf, refineRate);
      if (alt) {
        const factor = returnFactor(r, rrrOpts.gearRate !== undefined ? rrrOpts.gearRate : 0);
        if (!source || alt.price * factor < source.effective) {
          refine = { ...alt, factor };
          source = { city: alt.city, avgPrice: alt.price, avgDailyVolume: null, factor, rrr: 1 - factor, effective: alt.price * factor };
        }
      }
    }
    const neededRaw = r.count * quantity;
    const neededAfterRrr = Math.ceil(neededRaw * (source ? source.factor : returnFactor(r, 0)));
    if (!source) hasAllPrices = false;
    else effectiveCostPerUnit += r.count * source.factor * source.avgPrice;
    // Срок закупки при переработке — по самому медленному компоненту (сырьё / предыдущий тир).
    let refineDays = null;
    if (refine) {
      for (const comp of refine.components) {
        const st = inScope(cityStats(materialHistory, comp.id, days));
        const vol = Object.values(st).reduce((m, x) => Math.max(m, x.avgDailyVolume), 0);
        const d = vol > 0 ? (neededAfterRrr * comp.count * (1 - refine.rate)) / vol : null;
        if (d === null) { refineDays = null; break; }
        refineDays = Math.max(refineDays || 0, d);
      }
    }
    return {
      materialSource: refine ? 'refine' : 'buy',
      refineOption: refine ? { city: refine.city, rate: refine.rate, rawCost: refine.rawCost, price: refine.price, components: refine.components } : null,
      resource: r.resource,
      resourceName: resolveItemName(r.resource),
      queryId,
      enchanted: queryId !== r.resource,
      count: r.count,
      neededRaw,
      neededAfterRrr,
      sourceCity: source ? source.city : null,
      avgPrice: source ? source.avgPrice : null,
      avgDailyVolume: source ? source.avgDailyVolume : null,
      daysToAcquire: refine ? refineDays : source ? neededAfterRrr / source.avgDailyVolume : null,
    };
  });

  let bottleneck = null;
  for (const r of recipeBreakdown) {
    if (r.daysToAcquire !== null && (!bottleneck || r.daysToAcquire > bottleneck.daysToAcquire)) bottleneck = r;
  }

  // Готовый предмет: спрос суммируется по всем выбранным городам, цена — средневзвешенная по объёму.
  // filterQuality: история запрошена сразу по всем качествам (сканеры) — берём только ряды нужного качества
  const finishedStats = inScope(cityStats(finishedHistory, finishedQueryId, days, opts.filterQuality ? opts.quality : undefined));
  let totalVol = 0;
  let weighted = 0;
  let bestSellCity = null;
  for (const [city, st] of Object.entries(finishedStats)) {
    totalVol += st.totalVolume;
    weighted += st.avgPrice * st.totalVolume;
    if (!bestSellCity || st.avgPrice > bestSellCity.avgPrice) bestSellCity = { city, avgPrice: st.avgPrice };
  }
  const marketAvgSellPrice = totalVol > 0 ? weighted / totalVol : null;
  const avgDailySellVolume = totalVol / days;
  const daysToSellBatch = avgDailySellVolume > 0 ? quantity / avgDailySellVolume : null;

  // Полоса продажи: если не задана — считаем по рыночной средней.
  if (sellLow === null && sellHigh === null) { sellLow = marketAvgSellPrice; sellHigh = marketAvgSellPrice; }
  else if (sellLow === null) sellLow = sellHigh;
  else if (sellHigh === null) sellHigh = sellLow;
  if (sellLow !== null && sellHigh !== null && sellHigh < sellLow) [sellLow, sellHigh] = [sellHigh, sellLow];

  const netSellLow = sellLow !== null ? sellLow * (1 - taxRate) : null;
  const netSellHigh = sellHigh !== null ? sellHigh * (1 - taxRate) : null;
  const profitPerUnitLow = hasAllPrices && netSellLow !== null ? netSellLow - effectiveCostPerUnit : null;
  const profitPerUnitHigh = hasAllPrices && netSellHigh !== null ? netSellHigh - effectiveCostPerUnit : null;
  const daysToAcquireBatch = bottleneck ? bottleneck.daysToAcquire : null;

  return {
    itemId, enchant, quality: opts.quality, quantity, days,
    rrrPreset: { id: 'custom', label: rrrOptionsLabel(rrrOpts), ...rrrOpts },
    taxRate,
    cities: queryCities,
    recipe: recipeBreakdown,
    hasAllMaterialPrices: hasAllPrices,
    effectiveCostPerUnit,
    costCeiling,
    withinCeiling: costCeiling !== null ? effectiveCostPerUnit <= costCeiling : null,
    bottleneckResource: bottleneck ? bottleneck.resource : null,
    daysToAcquireBatch,
    marketAvgSellPrice,
    bestSellCity,
    avgDailySellVolume,
    daysToSellBatch,
    sellLow,
    sellHigh,
    netSellLow,
    netSellHigh,
    profitPerUnitLow,
    profitPerUnitHigh,
    totalProfitLow: profitPerUnitLow !== null ? profitPerUnitLow * quantity : null,
    totalProfitHigh: profitPerUnitHigh !== null ? profitPerUnitHigh * quantity : null,
    totalDaysEstimate: daysToAcquireBatch !== null && daysToSellBatch !== null ? daysToAcquireBatch + daysToSellBatch : null,
  };
}

// Доля рынка 0.01–1 (в интерфейсе 10/25/50/100%), по умолчанию 25%.
function parseMarketShare(req) {
  return Math.min(Math.max(parseFloat(req.query.marketShare) || 0.25, 0.01), 1);
}

// Период истории можно вписать свой: дни 0.5–30 (по умолчанию 7) и часы 1–720 (по умолчанию 24) — не только 3/7 дней.
function parseBulkDays(req) {
  const v = parseFloat(req.query.days);
  return Number.isFinite(v) && v > 0 ? Math.min(Math.max(v, 0.5), 30) : 7;
}
function parseHistoryHours(req) {
  const v = parseFloat(req.query.hours);
  return Number.isFinite(v) && v > 0 ? Math.min(Math.max(v, 1), 720) : 24;
}

app.get('/api/craft-bulk-plan', async (req, res) => {
  try {
    const itemId = req.query.item;
    const enchant = Math.min(Math.max(parseInt(req.query.enchant, 10) || 0, 0), 4);
    const quality = Math.min(Math.max(parseInt(req.query.quality, 10) || 1, 1), 5);
    const quantity = Math.min(Math.max(parseInt(req.query.quantity, 10) || 1, 1), 100000);
    const days = parseBulkDays(req);
    const rrrOpts = parseGearRrrOptions(req);
    const costCeiling = parseFloat(req.query.ceiling) > 0 ? parseFloat(req.query.ceiling) : null;
    const sellLow = parseFloat(req.query.sellLow) > 0 ? parseFloat(req.query.sellLow) : null;
    const sellHigh = parseFloat(req.query.sellHigh) > 0 ? parseFloat(req.query.sellHigh) : null;
    const citiesParam = req.query.cities;

    if (!itemId || !RECIPES[itemId]) return res.status(404).json({ error: `не найден рецепт для предмета "${itemId}"` });
    const taxRate = getSalesTaxRate(req);
    const queryCities = citiesParam ? citiesParam.split(',').map((s) => s.trim()).filter(Boolean) : Object.values(CITY_DISPLAY);
    const locations = queryCities.map((c) => c.replace(/\s+/g, ''));

    const resourceQueryIds = RECIPES[itemId].resources.map((r) => effectiveRecipeResourceId(r.resource, enchant));
    const finishedQueryId = enchant > 0 ? `${itemId}@${enchant}` : itemId;
    const refineRate = parseRefineRate(req).rate;
    const materialIdSet = new Set(resourceQueryIds);
    addRefineComponentIds(materialIdSet, resourceQueryIds);
    const [materialHistory, finishedHistory] = await Promise.all([
      fetchHistoryBatched([...materialIdSet], days * 24, 1, locations),
      fetchHistoryBatched([finishedQueryId], days * 24, quality, locations),
    ]);

    res.json(computeBulkPlan(
      { itemId, enchant, quality, quantity, days, rrrOpts, taxRate, costCeiling, sellLow, sellHigh, queryCities, refineRate },
      materialHistory, finishedHistory,
    ));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'не удалось посчитать план партии', details: err.message });
  }
});

// Сканер партионных возможностей: та же модель, что и в плане партии, сразу по всем рецептам гира
// (без зачарования, обычное качество). Показывает рецепты, прибыльные при цене продажи по рынку,
// и штрафует длинные циклы закупка+распродажа.
// --- Ленивый крафтер: подбор набора предметов под бюджет ---
// Не «один предмет за раз», а план: что и сколько скрафтить, чтобы потратить именно эту сумму и получить
// максимум прибыли, не планируя продать больше, чем реально купят (доля рынка от дневного объёма).
const LAZY_STRATEGIES = ['balanced', 'expensive', 'mass'];

// Порядок, в котором стратегия набирает позиции: "balanced" — прибыльность с поправкой на ликвидность,
// "expensive" — большая прибыль с штуки (мало штук), "mass" — много ликвидных штук с малой маржой.
function lazyStrategyScore(c, strategy) {
  if (strategy === 'expensive') return c.profitPerUnit;
  if (strategy === 'mass') return c.avgDailySellVolume * c.profitPerUnit;
  return opportunityScore(c.profitPct, c.avgDailySellVolume);
}

// Жадное распределение бюджета. candidates: { itemId, costPerUnit, profitPerUnit, profitPct, avgDailySellVolume }.
// Количество каждой позиции ограничено и бюджетом, и рынком: не больше доли (%) от объёма продаж за sellDays.
function allocateBudget(candidates, { budget, marketSharePct, sellDays, strategy }) {
  const share = marketSharePct / 100;
  const usable = candidates
    .filter((c) => c.costPerUnit > 0 && c.profitPerUnit > 0 && c.avgDailySellVolume > 0)
    .map((c) => ({ ...c, maxQty: Math.floor(c.avgDailySellVolume * sellDays * share) }))
    .filter((c) => c.maxQty >= 1)
    .sort((a, b) => lazyStrategyScore(b, strategy) - lazyStrategyScore(a, strategy));

  let remaining = budget;
  const items = [];
  for (const c of usable) {
    const qty = Math.min(c.maxQty, Math.floor(remaining / c.costPerUnit));
    if (qty < 1) continue;
    const costUsed = qty * c.costPerUnit;
    remaining -= costUsed;
    items.push({ ...c, qty, costUsed, profitEarned: qty * c.profitPerUnit });
  }
  const spent = budget - remaining;
  const totalProfit = items.reduce((sum, it) => sum + it.profitEarned, 0);
  return { budget, spent, remaining, totalProfit, profitPct: spent > 0 ? (totalProfit / spent) * 100 : 0, items };
}

app.get('/api/lazy-crafter', async (req, res) => {
  try {
    const budget = parseFloat(req.query.budget);
    if (!(budget > 0)) return res.status(400).json({ error: 'бюджет должен быть положительным числом' });
    const marketSharePct = req.query.marketShare !== undefined
      ? parseMarketShare(req) * 100
      : Math.min(Math.max(parseFloat(req.query.share) || 25, 1), 100);
    const sellDays = Math.min(Math.max(parseFloat(req.query.sellDays) || 1, 0.5), 30);
    const strategy = LAZY_STRATEGIES.includes(req.query.strategy) ? req.query.strategy : 'balanced';
    const days = parseBulkDays(req);
    const category = ['weapon', 'armor', 'cape'].includes(req.query.category) ? req.query.category : 'all';
    const rrrOpts = parseGearRrrOptions(req);
    const taxRate = getSalesTaxRate(req);
    const citiesParam = req.query.cities;
    const queryCities = citiesParam ? citiesParam.split(',').map((s) => s.trim()).filter(Boolean) : Object.values(CITY_DISPLAY);
    const locations = queryCities.map((c) => c.replace(/\s+/g, ''));

    const categoryById = new Map(ITEMS.map((i) => [i.id, i.category]));
    const itemIds = Object.keys(RECIPES).filter((id) => category === 'all' || categoryById.get(id) === category);
    const materialIdSet = new Set(itemIds.flatMap((id) => RECIPES[id].resources.map((r) => r.resource)));
    addRefineComponentIds(materialIdSet, [...materialIdSet]);
    const materialIds = [...materialIdSet];
    const refineRate = parseRefineRate(req).rate;
    const [materialHistory, finishedHistory] = await Promise.all([
      fetchHistoryBatched(materialIds, days * 24, 1, locations),
      fetchHistoryBatched(itemIds, days * 24, 1, locations),
    ]);

    // Кандидаты: цена и прибыль с одной штуки по партионной модели (средневзвешенные цены за период).
    const candidates = [];
    for (const itemId of itemIds) {
      const plan = computeBulkPlan(
        { itemId, enchant: 0, quality: 1, quantity: 1, days, rrrOpts, taxRate, costCeiling: null, sellLow: null, sellHigh: null, queryCities, refineRate },
        materialHistory, finishedHistory,
      );
      if (!plan.hasAllMaterialPrices || plan.profitPerUnitLow === null || plan.profitPerUnitLow <= 0) continue;
      candidates.push({
        itemId,
        costPerUnit: plan.effectiveCostPerUnit,
        profitPerUnit: plan.profitPerUnitLow,
        profitPct: (plan.profitPerUnitLow / plan.effectiveCostPerUnit) * 100,
        avgDailySellVolume: plan.avgDailySellVolume,
        bestSellCity: plan.bestSellCity,
      });
    }

    const plan = allocateBudget(candidates, { budget, marketSharePct, sellDays, strategy });
    // Сроки закупки и распродажи пересчитываем уже для выбранного количества.
    for (const it of plan.items) {
      const full = computeBulkPlan(
        { itemId: it.itemId, enchant: 0, quality: 1, quantity: it.qty, days, rrrOpts, taxRate, costCeiling: null, sellLow: null, sellHigh: null, queryCities, refineRate },
        materialHistory, finishedHistory,
      );
      it.bottleneckResource = full.bottleneckResource;
      it.daysToAcquireBatch = full.daysToAcquireBatch;
      it.daysToSellBatch = full.daysToSellBatch;
    }
    res.json({ ...plan, strategy, marketSharePct, sellDays, taxRate, candidates: candidates.length });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'не удалось построить план ленивого крафтера', details: err.message });
  }
});

// --- Зачарование: покупка предмета + руны/души/реликвии -> продажа на уровень выше ---

// Количество материала на ОДИН шаг зачарования (.0->.1 руны, .1->.2 души, .2->.3 реликвии) —
// фиксировано по типу слота, НЕ зависит от тира и не меняется между тремя шагами (сверено
// по независимым гайдам сообщества, т.к. официальной документации с точными числами нет).
// Зачарование .4 (Awakening) сюда намеренно не входит — это отдельная механика поверх
// обычного крафта (Avalonian/Siphoned Energy, рандомные "пробуждённые" трейты), не сводится
// к простому "купил материалы -> продал дороже".
const ENCHANT_MATERIAL_COUNT = {
  'двуручное': 384,
  'осн. рука': 288,
  'левая рука': 96,
  торс: 192,
  шлем: 96,
  обувь: 96,
  плащ: 96,
  'плащ (фракция)': 96,
  'плащ (охотник)': 96,
};
const ENCHANT_MATERIAL_BY_LEVEL = { 1: 'RUNE', 2: 'SOUL', 3: 'RELIC' };
function enchantMaterialId(tier, level) {
  return `T${tier}_${ENCHANT_MATERIAL_BY_LEVEL[level]}`;
}

let enchantScanCache = null;

app.get('/api/enchant-opportunities', async (req, res) => {
  try {
    const hours = parseHistoryHours(req);
    const citiesParam = req.query.cities;
    const taxRate = getSalesTaxRate(req);
    const cacheKey = `${hours}:${citiesParam || 'default'}:${taxRate}`;
    if (enchantScanCache && enchantScanCache.key === cacheKey && Date.now() - enchantScanCache.ts < SCAN_CACHE_TTL_MS) {
      return res.json(enchantScanCache.data);
    }
    const queryCities = citiesParam ? citiesParam.split(',').map((s) => s.trim()).filter(Boolean) : Object.values(CITY_DISPLAY);
    const allowedCities = new Set(queryCities.map(normLocation));
    const locations = queryCities.map((c) => c.replace(/\s+/g, ''));

    // Шаги зачарования каждой вещи T4+ : .0->.1, .1->.2, .2->.3
    const baseItems = ITEMS.filter((i) => i.tier >= 4 && GEAR_IDS.has(i.id) && ENCHANT_MATERIAL_COUNT[i.slot]);
    const gearIds = new Set();
    const materialIds = new Set();
    for (const item of baseItems) {
      for (let lvl = 0; lvl <= 3; lvl++) gearIds.add(gearEnchantId(item.id, lvl));
      for (let lvl = 1; lvl <= 3; lvl++) materialIds.add(enchantMaterialId(item.tier, lvl));
    }
    // Качество вещи сохраняется при зачаровании, поэтому цепочка «купить → зачаровать → продать» берётся в ОДНОМ
    // качестве и не смешивается между сторонами. Гир — по всем 5 качествам, материалы (руны/души/реликвии) — Обычные.
    const [gearData, materialData] = await Promise.all([
      fetchGearPrices([...gearIds], ALL_QUALITIES),
      fetchPricesBatched([...materialIds], 1),
    ]);

    const byItemCity = {}; // ключ `${id}|${quality}`
    for (const rec of [...gearData, ...materialData]) {
      if (!allowedCities.has(normLocation(rec.city))) continue;
      const key = `${rec.item_id}|${rec.quality}`;
      (byItemCity[key] || (byItemCity[key] = [])).push(rec);
    }
    const cheapest = (id, quality = 1) => {
      let best = null;
      for (const rec of byItemCity[`${id}|${quality}`] || []) {
        if (rec.sell_price_min && (!best || rec.sell_price_min < best.price)) best = { city: rec.city, price: rec.sell_price_min, date: rec.sell_price_min_date };
      }
      return best;
    };
    const bestSellOf = (id, quality = 1) => {
      let best = null;
      for (const rec of byItemCity[`${id}|${quality}`] || []) {
        if (rec.buy_price_max && (!best || rec.buy_price_max > best.price)) best = { city: rec.city, price: rec.buy_price_max, date: rec.buy_price_max_date };
      }
      return best;
    };

    const now = Date.now();
    const candidates = [];
    for (const item of baseItems) {
      const count = ENCHANT_MATERIAL_COUNT[item.slot];
      for (let to = 1; to <= 3; to++) {
        const from = to - 1;
        const material = cheapest(enchantMaterialId(item.tier, to), 1);
        if (!material) continue;
        for (const quality of ALL_QUALITIES) {
        const buy = cheapest(gearEnchantId(item.id, from), quality);
        const sell = bestSellOf(gearEnchantId(item.id, to), quality);
        if (!buy || !sell) continue;
        const materialCost = count * material.price;
        const cost = buy.price + materialCost;
        const profit = sell.price * (1 - taxRate) - cost;
        if (profit <= 0) continue;
        candidates.push({
          itemId: item.id, quality, fromLevel: from, toLevel: to, buy,
          materialId: enchantMaterialId(item.tier, to), materialCount: count, materialPrice: material.price, materialCost,
          bestSell: sell, taxRate, cost, profit, profitPct: (profit / cost) * 100,
          freshMinutes: dealAgeMinutes([buy.date, material.date, sell.date], now),
        });
        }
      }
    }

    // Честная проверка ликвидности целевого уровня: объём продаж именно .to в городе продажи.
    const minVolume = scaledMinVolume(hours);
    let result = candidates;
    try {
      const targetIds = [...new Set(candidates.map((c) => gearEnchantId(c.itemId, c.toLevel)))];
      const history = await fetchHistoryBatched(targetIds, hours, ALL_QUALITIES.join(','), locations);
      const scored = candidates
        // Ликвидность — целевого уровня, этого качества и в городе продажи.
        .map((c) => ({ ...c, volume: totalVolume(history, gearEnchantId(c.itemId, c.toLevel), [c.bestSell.city], c.quality) }))
        .filter((c) => c.volume >= minVolume)
        .map((c) => ({ ...c, score: opportunityScore(c.profitPct, c.volume) * freshnessDecay(c.freshMinutes) }))
        .sort((a, b) => b.score - a.score);
      // Одна строка на (вещь, шаг): лучшее по скору качество.
      const seen = new Set();
      result = scored.filter((c) => { const k = `${c.itemId}|${c.toLevel}`; return seen.has(k) ? false : (seen.add(k), true); });
    } catch (err) {
      console.error('не удалось проверить историю для сканера зачарования:', err.message);
      const seenFallback = new Set();
      result = candidates.map((c) => ({ ...c, volume: null, score: 0 })).sort((a, b) => b.profitPct - a.profitPct)
        .filter((c) => { const k = `${c.itemId}|${c.toLevel}`; return seenFallback.has(k) ? false : (seenFallback.add(k), true); });
    }
    const top = result.slice(0, 25);
    enchantScanCache = { key: cacheKey, ts: Date.now(), data: top };
    res.json(top);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'не удалось выполнить скан зачарования', details: err.message });
  }
});

// --- Скан маржи и ликвидности: гир × зачарование .0–.3 × качество ---
// Находит вещь, которая одновременно и хорошо продаётся, и даёт маржу: для каждой комбинации считаем себестоимость
// (материалы), среднюю цену продажи по истории и дневной оборот. Оборот можно суммировать по всем городам
// (партиями в каждый — ближе к реальной схеме) или брать только лучший город. .4 (Awakening) не входит — он
// не чарится рунами. «Дней на премиум» — информационная шкала, а не цель: 28 млн серебра / (профит/шт × оборот/день).
const PREMIUM_PRICE_SILVER = 28_000_000;

// Чистая часть: продажа одной комбинации (вещь@зачарование, качество) по уже загруженной истории.
// mode 'sum' — цена средневзвешенная по всем городам, оборот суммируется; 'best' — город с лучшей ценой.
function marginSellStats(history, finishedId, days, quality, queryCities, mode, econ) {
  const allowed = new Set(queryCities.map(normLocation));
  // Чёрный Рынок (econ.bmTaxRate задан): ещё одно место терпеливой продажи по средней цене сделок ЧР; налог у него свой (налог +
  // Setup Fee уже внутри), у обычных городов — налог + сбор за размещение. Чистая цена считается по налогу КАЖДОГО города.
  const bm = econ && econ.bmTaxRate !== undefined && econ.bmTaxRate !== null;
  if (bm) allowed.add('blackmarket');
  const netFactorOf = (city) => (bm && normLocation(city) === 'blackmarket' ? 1 - econ.bmTaxRate : 1 - (econ ? econ.taxRate + (econ.setupFee ?? 0) : 0));
  let stats = Object.entries(cityStats(history, finishedId, days, quality)).filter(([city]) => allowed.has(normLocation(city)));
  if (stats.length === 0) return null;
  const marketVolume = stats.reduce((sum, [, st]) => sum + st.totalVolume, 0) / days; // оборот всех городов — для справки
  // Честный режим (econ = { taxRate, setupFee, cost }): в расчёт идут только города, где продажа через свой Sell Order
  // даёт прибыль после налога и сбора за размещение. Иначе маржа лучшего города применялась бы ко ВСЕМУ рыночному объёму
  // (на сете брони T5 82% оборота шло в убыток, а dailyProfit считался по прибыльному городу на весь объём — завышение в 5.5 раза).
  if (econ) {
    stats = stats.filter(([city, st]) => st.avgPrice * netFactorOf(city) - econ.cost > 0);
    // Шумный город (оборот ничтожен по сравнению с самым ликвидным ПРИБЫЛЬНЫМ) не считается ценовым сигналом — та же защита, что в
    // плане продажи. Сравниваем только среди прибыльных: огромный убыточный рынок не должен объявлять шумом маленький прибыльный.
    if (econ.minShareOfMax && stats.length > 0) {
      const maxVolume = Math.max(...stats.map(([, st]) => st.avgDailyVolume));
      stats = stats.filter(([, st]) => st.avgDailyVolume >= maxVolume * econ.minShareOfMax);
    }
    if (stats.length === 0) return null;
  }
  if (mode === 'best') {
    const [city, st] = stats.reduce((a, b) => (b[1].avgPrice * netFactorOf(b[0]) > a[1].avgPrice * netFactorOf(a[0]) ? b : a));
    return { avgPrice: st.avgPrice, netPrice: st.avgPrice * netFactorOf(city), dailyVolume: st.avgDailyVolume, cities: [city], marketDailyVolume: marketVolume };
  }
  let vol = 0;
  let weighted = 0;
  let netWeighted = 0;
  for (const [city, st] of stats) { vol += st.totalVolume; weighted += st.avgPrice * st.totalVolume; netWeighted += st.avgPrice * netFactorOf(city) * st.totalVolume; }
  return { avgPrice: weighted / vol, netPrice: netWeighted / vol, dailyVolume: vol / days, cities: stats.map(([c]) => c), marketDailyVolume: marketVolume };
}

// Дней, за которые профит с оборота окупил бы премиум: чем меньше — тем масштабнее находка.
function premiumPaybackDays(profitPerUnit, dailyVolume, premiumPrice = PREMIUM_PRICE_SILVER) {
  const daily = profitPerUnit * dailyVolume;
  return daily > 0 ? premiumPrice / daily : null;
}

// --- Объединённый скан (кувшин): маржа и ликвидность + партии + рефайн в одной модели ---
// Читает локальную базу кувшина (lib/jugQuery.js), не ходит в AODP. Одна модель отбора и ранжирования на всё:
//  • для КАЖДОЙ комбинации (зачарование × качество у гира; тир × тип у сырья) сразу считаем ликвидность и честный дневной профит,
//    а лучшую комбинацию предмета выбираем уже по нему — не по голому проценту маржи (раньше ликвидность проверялась после отбора);
//  • «Мгновенно» и «Терпеливо» отличаются только источником цены продажи и оценкой цикла, философия скора одна:
//      instant — продаём в текущий Buy Order лучшего города (налог, без сбора за размещение), спрос — сделки этого города;
//      patient — свой Sell Order по средней цене сделок только в прибыльных городах (налог + сбор 2.5%), цикл закупки и продажи партии;
//  • «сырьё/рефайн» — просто ещё один вид себестоимости (коэффициенты переработки вместо рецепта), скор и отбор те же.
// dailyProfit = профит/шт × штук/день, которые реально удастся продать (доля рынка × оборот); в терпеливом режиме ещё не больше,
// чем позволяет закупка самого узкого материала. Ранг = dailyProfit × поправка на свежесть котировок (× штраф за длинный цикл партии).
const UNIFIED_MAX_ROWS = 60;
const UNIFIED_MIN_CITY_SHARE = 0.02; // «шумный» город: оборот меньше 2% от самого ликвидного не считается ценовым сигналом
let unifiedScanCache = null;

// Защита от выбросов в истории AODP: в реальных данных попадаются точки с абсурдной ценой (T4-плащ по 2 000 в семи городах и
// «в среднем 320 000» в Lymhurst) — без фильтра такой выброс ставит предмет на вершину списка с выдуманным профитом. Для каждого
// (предмет, качество) считаем медиану цены по всем точкам и отбрасываем те, что отличаются от неё больше чем в 4 раза.
const HISTORY_OUTLIER_FACTOR = 4;
function median(sortedAsc) {
  const n = sortedAsc.length;
  return n === 0 ? null : n % 2 ? sortedAsc[(n - 1) / 2] : (sortedAsc[n / 2 - 1] + sortedAsc[n / 2]) / 2;
}
function dropPriceOutliers(series) {
  const prices = new Map(); // "предмет|качество" -> цены всех точек
  for (const s of series) {
    const key = `${s.item_id}|${s.quality}`;
    let list = prices.get(key);
    if (!list) { list = []; prices.set(key, list); }
    for (const p of s.data) list.push(p.avg_price);
  }
  const medians = new Map([...prices].map(([key, list]) => [key, median(list.sort((a, b) => a - b))]));
  const out = [];
  for (const s of series) {
    const m = medians.get(`${s.item_id}|${s.quality}`);
    const data = s.data.filter((p) => p.avg_price <= m * HISTORY_OUTLIER_FACTOR && p.avg_price >= m / HISTORY_OUTLIER_FACTOR);
    if (data.length) out.push({ ...s, data });
  }
  return { series: out, medians };
}

function indexByItem(series) {
  const map = new Map();
  for (const s of series) {
    let list = map.get(s.item_id);
    if (!list) { list = []; map.set(s.item_id, list); }
    list.push(s);
  }
  return map;
}

// Текущие котировки продажи по id во всех выбранных городах: id -> [{ city, price, date }]. Город закупки потом выбирается
// с учётом возврата в нём (bestMaterialQuote), поэтому «самую дешёвую» здесь не выбираем.
function quotesById(records) {
  const out = {};
  for (const rec of records) {
    if (!rec.sell_price_min) continue;
    (out[rec.item_id] || (out[rec.item_id] = [])).push({ city: rec.city, price: rec.sell_price_min, date: rec.sell_price_min_date });
  }
  return out;
}
// Разбивка оборота по городам для строки скана: где сколько торгуется и какие города вошли в расчёт (used) — чтобы цифра «оборот/день»
// не была чёрным ящиком. Города без сделок за период не показываем.
function volumeBreakdown(seriesOfItem, itemId, days, quality, cities, usedCities) {
  const allowed = new Set(cities.map(normLocation));
  const used = new Set(usedCities.map(normLocation));
  return Object.entries(cityStats(seriesOfItem || [], itemId, days, quality))
    .filter(([city]) => allowed.has(normLocation(city)))
    .map(([city, st]) => ({ city, dailyVolume: st.avgDailyVolume, avgPrice: st.avgPrice, inPlan: used.has(normLocation(city)) }))
    .sort((a, b) => b.dailyVolume - a.dailyVolume);
}
// Цена сырья: ОДНА честная цена — средняя по сделкам за окно `hours` (по умолчанию 24 ч), а не цена одного самого дешёвого лота
// (sell_price_min — это цена первой штуки; партия из сотен штук столько не стоит). Окно свежее и отдельное от «Истории» продажи
// готового предмета (7 дней цен — старые). AODP не отдаёт стакан и не различает инициатора сделки, поэтому это именно
// «средняя цена сделок за окно», а не Buy/Sell Order. Города без сделок за окно не участвуют; если сделок нет вовсе — берётся
// текущая котировка (priceSource: 'quote'), чтобы редкий материал (герб, жетон) не остался без цены.
const MATERIAL_HOURS_DEFAULT = 24;
function parseMaterialHours(req) {
  const v = parseFloat(req.query.materialHours);
  return Number.isFinite(v) && v > 0 ? Math.min(Math.max(v, 1), 720) : MATERIAL_HOURS_DEFAULT;
}
// Возвращает [{ city, price, date, source }] по одному материалу. snapshotQuotes — [{ city, price, date }] текущих котировок.
function materialPriceQuotes(seriesOfItem, itemId, hours, cities, snapshotQuotes) {
  const allowed = new Set(cities.map(normLocation));
  const stats = Object.entries(cityStats(seriesOfItem || [], itemId, hours / 24, 1)).filter(([city]) => allowed.has(normLocation(city)));
  if (stats.length > 0) {
    const lastTrade = (city) => {
      let last = null;
      for (const s of seriesOfItem) if (normLocation(s.location) === normLocation(city)) for (const p of s.data) if (p.item_count > 0 && (!last || p.timestamp > last)) last = p.timestamp;
      return last;
    };
    return stats.map(([city, st]) => ({ city, price: st.avgPrice, date: lastTrade(city), source: 'history' }));
  }
  return (snapshotQuotes || []).map((q) => ({ ...q, source: 'quote' }));
}
const cheapestOf = (quotes) => (quotes && quotes.length ? quotes.reduce((a, b) => (b.price < a.price ? b : a)) : null);

// Достоверность цифры: сколько РАЗНЫХ часов за период вообще шли сделки по предмету в городах продажи (не штук: одна оптовая
// сделка на 500 штук — это один час, а не 500 подтверждений рынка). Индекс доверия = n / (n + K): при n = 3 это 13%, при n = 300 — 94%.
const CONFIDENCE_K = 20;
function tradeHoursOf(seriesOfItem, quality, sellCities) {
  const cities = new Set(sellCities.map(normLocation));
  const hours = new Set();
  for (const s of seriesOfItem || []) {
    if (s.quality !== quality || !cities.has(normLocation(s.location))) continue;
    for (const p of s.data) if (p.item_count > 0) hours.add(p.timestamp);
  }
  return hours.size;
}
const confidenceOf = (tradeHours) => tradeHours / (tradeHours + CONFIDENCE_K);

// Лучший город мгновенной продажи (в Buy Order): максимум дневного профита, а не цены — иначе побеждал бы город без спроса.
function instantSellChoice(priceRecords, seriesOfItem, itemId, quality, days, cost, taxRate, medianPrice, bmTaxRate = null) {
  const stats = cityStats(seriesOfItem || [], itemId, days, quality);
  let best = null;
  for (const rec of priceRecords || []) {
    if (rec.quality !== quality || !rec.buy_price_max) continue;
    // Buy Order сильно выше рыночной цены сделок — почти наверняка ошибка или «фантомный» ордер: на него не рассчитываем.
    if (medianPrice !== null && rec.buy_price_max > medianPrice * 3) continue;
    const st = Object.entries(stats).find(([c]) => normLocation(c) === normLocation(rec.city));
    if (!st) continue;
    // Чёрный Рынок — особая точка: только покупает (мгновенная продажа в его ордер), налог выше (налог + Setup Fee всегда).
    // Лучший город выбираем по прибыли ПОСЛЕ налога города, а не по сырой цене: у ЧР цена выше, но и налог выше.
    const isBlackMarket = normLocation(rec.city) === 'blackmarket';
    if (isBlackMarket && bmTaxRate === null) continue;
    const cityTax = isBlackMarket ? bmTaxRate : taxRate;
    const profitPerUnit = rec.buy_price_max * (1 - cityTax) - cost;
    if (profitPerUnit <= 0) continue;
    const dailyVolume = st[1].avgDailyVolume;
    if (!best || profitPerUnit * dailyVolume > best.profitPerUnit * best.dailyVolume) {
      best = { city: rec.city, price: rec.buy_price_max, date: rec.buy_price_max_date, profitPerUnit, dailyVolume, blackMarket: isBlackMarket, taxRate: cityTax };
    }
  }
  return best;
}

// Дней на закупку партии: узкое место — материал с наименьшим оборотом (оборот по выбранным городам, доля рынка).
// null — если у какого-то материала нет сделок за период (закупку честно оценить нельзя).
function unifiedAcquire(needs, materialIndex, days, marketShare, queryCities) {
  let worstDays = 0;
  let maxUnits = Infinity;
  for (const need of needs) {
    const stats = cityStats(materialIndex.get(need.id) || [], need.id, days, 1);
    const allowed = new Set(queryCities.map(normLocation));
    const dailyVolume = Object.entries(stats).filter(([c]) => allowed.has(normLocation(c))).reduce((sum, [, st]) => sum + st.avgDailyVolume, 0);
    if (!(dailyVolume > 0)) return null;
    worstDays = Math.max(worstDays, need.total / (dailyVolume * marketShare));
    maxUnits = Math.min(maxUnits, (dailyVolume * marketShare) / need.perUnit);
  }
  return { days: worstDays, unitsPerDay: maxUnits };
}

app.get('/api/unified-scan', (req, res) => {
  try {
    const mode = req.query.mode === 'instant' ? 'instant' : 'patient';
    const category = ['weapon', 'armor', 'cape'].includes(req.query.category) ? req.query.category : 'all';
    const days = parseBulkDays(req);
    const enchantMode = req.query.enchantMode === 'after' ? 'after' : 'direct';
    const liquidity = req.query.liquidity === 'best' ? 'best' : 'sum';
    const minDaily = Math.max(parseFloat(req.query.minDaily) || 1, 0);
    // Капитал на одну позицию (серебро) и минимум дней на цикл — вместо «доли рынка»: явные параметры, а не спрятанный процент.
    const capital = Math.min(Math.max(parseFloat(req.query.capital) || 500_000, 1000), 100_000_000_000);
    const minDays = Math.min(Math.max(parseFloat(req.query.minDays) || 1, 0.1), 60);
    const materialHours = parseMaterialHours(req);            // окно цен сырья (по умолчанию 24 ч), отдельное от «Истории» продажи
    const rrrOpts = parseGearRrrOptions(req);
    // Чёрный Рынок — в обоих режимах: мгновенно — в его Buy Order, терпеливо — по средней цене сделок ЧР; налог свой (налог + Setup Fee).
    const blackMarket = req.query.blackMarket === 'true';
    const taxRate = getSalesTaxRate(req);
    const bmTaxRate = getBmTaxRate(req);
    const queryCities = req.query.cities ? String(req.query.cities).split(',').map((s) => s.trim()).filter(Boolean) : Object.values(CITY_DISPLAY);
    const locations = queryCities.map((c) => c.replace(/\s+/g, ''));
    const now = Date.now();

    const fresh = jugFreshness(jugDb, now);
    const refineParams = parseRefineRate(req);
    const cacheKey = JSON.stringify([mode, category, days, materialHours, enchantMode, liquidity, minDaily, capital, minDays, rrrOpts, refineParams.rate, blackMarket, taxRate, locations, fresh.lastPricePass, fresh.lastHistoryPass]);
    if (unifiedScanCache && unifiedScanCache.key === cacheKey && now - unifiedScanCache.ts < 60_000) return res.json(unifiedScanCache.data);

    const itemById = new Map(ITEMS.map((i) => [i.id, i]));
    const gearIds = Object.keys(RECIPES).filter((id) => itemById.has(id) && (category === 'all' || itemById.get(id).category === category));

    // Комбинации гира: до T4 зачарования нет; .4 не включаем (не чарится рунами). Охотничьи/фракционные плащи — только «после крафта».
    const combos = [];
    for (const itemId of gearIds) {
      const item = itemById.get(itemId);
      const after = enchantMode === 'after' || requiresEnchantAfterCraft(itemId);
      if (after && !ENCHANT_MATERIAL_COUNT[item.slot]) continue;
      // .4 (Awakening) — обычная, просто более дорогая комбинация: крафтится напрямую из .4-сырья и торгуется как любой лот, поэтому в общем
      // переборе наравне с .0–.3. Рунами до .4 не дойти — при «зачаровать после крафта» потолок .3.
      const maxE = item.tier >= 4 ? (after ? 3 : 4) : 0;
      for (let e = 0; e <= maxE; e++) combos.push({ itemId, item, enchant: e, after });
    }

    const materialIds = new Set();
    for (const c of combos) {
      const matEnchant = c.after ? 0 : c.enchant;
      for (const r of RECIPES[c.itemId].resources) materialIds.add(effectiveRecipeResourceId(r.resource, matEnchant));
      if (c.after) for (let lvl = 1; lvl <= c.enchant; lvl++) materialIds.add(enchantMaterialId(c.item.tier, lvl));
    }
    addRefineComponentIds(materialIds, [...materialIds]);   // сырьё и предыдущий тир — для сравнения «купить готовый vs переработать самому»
    const finishedIds = [...new Set(combos.map((c) => gearEnchantId(c.itemId, c.enchant)))];

    const snapshotQuotes = quotesById(readPrices(jugDb, [...materialIds], { cities: queryCities, qualities: [1] }));
    // Цена сырья — средняя по сделкам за окно materialHours (а не цена одного дешёвого лота); нет сделок — текущая котировка.
    const priceHistory = indexByItem(readHistory(jugDb, [...materialIds], materialHours, { locations, qualities: [1], now }));
    const materialQuotes = {};
    for (const id of materialIds) materialQuotes[id] = materialPriceQuotes(priceHistory.get(id), id, materialHours, queryCities, snapshotQuotes[id]);
    const refineOpts = { ...rrrOpts, refine: { priceOf: (id) => cheapestOf(materialQuotes[id]), rate: refineParams.rate } };
    const cleaned = dropPriceOutliers(readHistory(jugDb, finishedIds, days * 24, { locations: blackMarket ? [...locations, BM_QUERY_LOCATION] : locations, qualities: ALL_QUALITIES, now }));
    const finishedHistory = indexByItem(cleaned.series);
    const medianPrice = (itemId, quality) => cleaned.medians.get(`${itemId}|${quality}`) ?? null;
    const materialHistory = mode === 'patient' ? indexByItem(readHistory(jugDb, [...materialIds], days * 24, { locations, qualities: [1], now })) : null;
    const finishedPrices = new Map();
    if (mode === 'instant') {
      for (const rec of readPrices(jugDb, finishedIds, { cities: blackMarket ? [...queryCities, BM_QUERY_LOCATION] : queryCities })) {
        let list = finishedPrices.get(rec.item_id);
        if (!list) { list = []; finishedPrices.set(rec.item_id, list); }
        list.push(rec);
      }
    }

    const rows = [];
    const pushBest = (candidates) => {
      let best = null;
      for (const c of candidates) if (!best || c.rankScore > best.rankScore) best = c;
      if (best) rows.push(best);
    };

    // Общая часть: из себестоимости, продажи и закупки — строка результата (или null, если предмет не проходит отбор).
    const buildRow = ({ kind, itemId, finishedId, enchant, quality, tier, type, cost, quoteDates, needs, refined = [] }) => {
      const seriesOfItem = finishedHistory.get(finishedId) || [];
      let sellPrice, dailyVolume, sellCities, profitPerUnit, marketDailyVolume, sellDate = null;
      let blackMarketRow = false;
      let sellTax = taxRate;
      if (mode === 'instant') {
        const choice = instantSellChoice(finishedPrices.get(finishedId), seriesOfItem, finishedId, quality, days, cost, taxRate, medianPrice(finishedId, quality), blackMarket ? bmTaxRate : null);
        if (!choice || choice.dailyVolume < minDaily) return null;
        sellPrice = choice.price; dailyVolume = choice.dailyVolume; sellCities = [choice.city]; profitPerUnit = choice.profitPerUnit;
        marketDailyVolume = Object.values(cityStats(seriesOfItem, finishedId, days, quality)).reduce((sum, st) => sum + st.avgDailyVolume, 0);
        sellDate = choice.date;
        blackMarketRow = choice.blackMarket;
        sellTax = choice.taxRate;
      } else {
        const sell = marginSellStats(seriesOfItem, finishedId, days, quality, queryCities, liquidity, { taxRate, setupFee: SETUP_FEE_RATE, cost, minShareOfMax: UNIFIED_MIN_CITY_SHARE, bmTaxRate: blackMarket ? bmTaxRate : null });
        if (!sell || sell.dailyVolume < minDaily) return null;
        sellPrice = sell.avgPrice; dailyVolume = sell.dailyVolume; sellCities = sell.cities; marketDailyVolume = sell.marketDailyVolume;
        profitPerUnit = sell.netPrice - cost;                    // по налогу каждого города (у ЧР свой)
        if (profitPerUnit <= 0) return null;
        blackMarketRow = sell.cities.some((c) => normLocation(c) === 'blackmarket');
        sellTax = null;
      }
      // Размер позиции — из КАПИТАЛА: штук = капитал / себестоимость (дешёвый предмет — много штук, дорогой — мало; один параметр на весь
      // список вместо угадывания партии для каждой позиции и вместо «доли рынка»). Сроки — по ПОЛНОМУ обороту прибыльных городов.
      const quantity = Math.max(Math.floor(capital / cost), 1);
      let daysToAcquire = null;
      const daysToSell = quantity / dailyVolume;
      if (mode === 'patient') {
        const acquire = unifiedAcquire(needs.map((n) => ({ id: n.id, total: Math.ceil(n.perUnit * quantity), perUnit: n.perUnit })), materialHistory, days, 1, queryCities);
        if (!acquire) return null;      // у какого-то материала нет сделок за период — закупку честно оценить нельзя
        daysToAcquire = acquire.days;
      }
      const cycleDays = (daysToAcquire || 0) + daysToSell;
      const adjusted = batchAdjustedDailyProfit({ profitPerUnit, quantity, cycleDays, minDays });
      const dailyProfit = adjusted.dailyProfit;
      const freshMinutes = dealAgeMinutes([...quoteDates, ...(sellDate ? [sellDate] : [])], now);
      const rankScore = dailyProfit * freshnessDecay(freshMinutes);
      const profitPct = (profitPerUnit / cost) * 100;
      const tradeHours = tradeHoursOf(seriesOfItem, quality, sellCities);
      return {
        kind, itemId, enchant, quality, tier, type, cost, avgSellPrice: sellPrice, sellCities, blackMarket: blackMarketRow, sellTaxRate: mode === 'instant' ? sellTax : blackMarketRow ? bmTaxRate : taxRate + SETUP_FEE_RATE, tradeHours, confidence: confidenceOf(tradeHours),
        dailyVolume, marketDailyVolume, byCity: volumeBreakdown(seriesOfItem, finishedId, days, quality, blackMarket ? [...queryCities, BM_QUERY_LOCATION] : queryCities, sellCities), profitPerUnit, profitPct, dailyProfit,
        quantity, batchProfit: adjusted.batchProfit, positionCost: quantity * cost,
        daysToAcquire, daysToSell, cycleDays, effectiveDays: adjusted.effectiveDays, cappedByMinDays: cycleDays < minDays,
        premiumDays: premiumPaybackDays(dailyProfit, 1),
        freshMinutes, rankScore,
        refined,   // материалы, которые выгоднее переработать самому: [{ id, city, buyPrice, price }]
      };
    };

    // Гир
    const byItem = new Map();
    for (const c of combos) {
      const recipe = RECIPES[c.itemId];
      const matEnchant = c.after ? 0 : c.enchant;
      let cost = recipe.silver || 0;
      const needs = [];
      const quoteDates = [];
      const refined = [];
      let complete = true;
      for (const r of recipe.resources) {
        const id = effectiveRecipeResourceId(r.resource, matEnchant);
        const q = bestMaterialQuote(materialQuotes[id] || [], { ...r, queryId: id }, refineOpts);   // город покупки — с учётом возврата в нём
        if (!q) { complete = false; break; }
        cost += q.price * r.count * q.factor;
        if (q.source === 'refine') {
          // Материал перерабатываем сами: закупаем сырьё и предыдущий тир, на переработку возвращается refineRate.
          for (const comp of q.refineOption.components) needs.push({ id: comp.id, perUnit: r.count * q.factor * comp.count * (1 - q.refineOption.rate) });
          refined.push({ id, city: q.city, buyPrice: q.buyPrice, price: q.price });
        } else needs.push({ id, perUnit: r.count * q.factor });
        quoteDates.push(q.date);
      }
      if (!complete) continue;
      if (c.after) {
        for (let lvl = 1; lvl <= c.enchant && complete; lvl++) {
          const id = enchantMaterialId(c.item.tier, lvl);
          const q = cheapestOf(materialQuotes[id]);                         // на руны/души/реликвии возврат не действует
          if (!q) { complete = false; break; }
          cost += q.price * ENCHANT_MATERIAL_COUNT[c.item.slot];
          needs.push({ id, perUnit: ENCHANT_MATERIAL_COUNT[c.item.slot] });
          quoteDates.push(q.date);
        }
        if (!complete) continue;
      }
      const finishedId = gearEnchantId(c.itemId, c.enchant);
      for (const quality of ALL_QUALITIES) {
        const row = buildRow({ kind: 'gear', itemId: c.itemId, finishedId, enchant: c.enchant, quality, tier: c.item.tier, cost, quoteDates, needs, refined });
        if (row) { if (!byItem.has(c.itemId)) byItem.set(c.itemId, []); byItem.get(c.itemId).push(row); }
      }
    }
    for (const candidates of byItem.values()) pushBest(candidates);

    rows.sort((a, b) => b.rankScore - a.rankScore);
    const data = {
      mode, enchantMode, liquidity, days, materialHours, capital, minDays, taxRate,
      setupFeeRate: mode === 'patient' ? SETUP_FEE_RATE : 0, premiumPrice: PREMIUM_PRICE_SILVER,
      blackMarket, bmTaxRate: blackMarket ? bmTaxRate : null,
      rrrOptions: rrrOpts, refineRate: refineParams.rate, enchantRange: enchantMode === 'after' ? '.0–.3' : '.0–.4',
      scanned: combos.length, jug: fresh, results: rows.slice(0, UNIFIED_MAX_ROWS),
    };
    unifiedScanCache = { key: cacheKey, ts: now, data };
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'не удалось выполнить объединённый скан', details: err.message });
  }
});


// --- Скан рефайна (кувшин): своя модель, без «доли рынка» ---
// Сырьё торгуется десятками тысяч штук в день: 10–25% такого оборота — нереалистичное число сделок для одного игрока, и процент от
// него превращал дневной профит в фантастику. Вместо доли рынка — явные и видимые параметры: «Партия» (сколько реально планируешь
// переработать/продать) и «Минимум дней» (быстрее этого срока цикл не идёт: заказы, походы, перевыставление).
// Профит в день = профит с партии ÷ max(честные дни цикла партии, минимум дней): ограничение видно в интерфейсе, а не спрятано в проценте.
function batchAdjustedDailyProfit({ profitPerUnit, quantity, cycleDays, minDays }) {
  const batchProfit = profitPerUnit * quantity;
  const effectiveDays = Math.max(cycleDays, minDays);
  return { batchProfit, effectiveDays, dailyProfit: effectiveDays > 0 ? batchProfit / effectiveDays : 0 };
}

app.get('/api/refine-scan', (req, res) => {
  try {
    const mode = req.query.mode === 'instant' ? 'instant' : 'patient';
    const days = parseBulkDays(req);
    const minDaily = Math.max(parseFloat(req.query.minDaily) || 1, 0);
    // Размер позиции — из КАПИТАЛА (штук = капитал / себестоимость), как в скане гира: дешёвый материал — много штук, дорогой — мало.
    const capital = Math.min(Math.max(parseFloat(req.query.capital) || 500_000, 1000), 100_000_000_000);
    const minDays = Math.min(Math.max(parseFloat(req.query.minDays) || 1, 0.1), 60);
    const rrrOpts = parseRrrOptions(req, 'none');
    const taxRate = getSalesTaxRate(req);
    const queryCities = req.query.cities ? String(req.query.cities).split(',').map((s) => s.trim()).filter(Boolean) : Object.values(CITY_DISPLAY);
    const locations = queryCities.map((c) => c.replace(/\s+/g, ''));
    const allowedCities = new Set(queryCities.map(normLocation));
    const now = Date.now();

    const fresh = jugFreshness(jugDb, now);
    const cacheKey = JSON.stringify([mode, days, minDaily, capital, minDays, rrrOpts, taxRate, locations, fresh.lastPricePass, fresh.lastHistoryPass]);
    if (refineScanCache && refineScanCache.key === cacheKey && now - refineScanCache.ts < 60_000) return res.json(refineScanCache.data);

    const combos = [];
    for (const type of RESOURCE_TYPES) {
      for (const tier of [2, 3, 4, 5, 6, 7, 8]) combos.push({ type, tier, rawId: `T${tier}_${type}`, refinedId: `T${tier}_${REFINED_NAME[type]}`, prevId: tier > 2 ? `T${tier - 1}_${REFINED_NAME[type]}` : null });
    }
    const materialIds = new Set();
    for (const c of combos) { materialIds.add(c.rawId); if (c.prevId) materialIds.add(c.prevId); }
    const finishedIds = combos.map((c) => c.refinedId);

    const currentQuotes = quotesById(readPrices(jugDb, [...materialIds], { cities: queryCities, qualities: [1] }));
    const materialHistory = indexByItem(readHistory(jugDb, [...materialIds], days * 24, { locations, qualities: [1], now }));
    const cleaned = dropPriceOutliers(readHistory(jugDb, finishedIds, days * 24, { locations, qualities: [1], now }));
    const finishedHistory = indexByItem(cleaned.series);
    const finishedPrices = new Map();
    if (mode === 'instant') {
      for (const rec of readPrices(jugDb, finishedIds, { cities: queryCities, qualities: [1] })) {
        (finishedPrices.get(rec.item_id) || finishedPrices.set(rec.item_id, []).get(rec.item_id)).push(rec);
      }
    }

    // Цена материала: мгновенно — текущие котировки продажи; терпеливо — СРЕДНЯЯ цена сделок за период по каждому городу (закупка своими
    // ордерами идёт не по мгновенной цене). Город закупки — по цене после возврата в нём (bestMaterialQuote).
    const materialQuotes = (id) => {
      if (mode === 'instant') return currentQuotes[id] || [];
      return Object.entries(cityStats(materialHistory.get(id) || [], id, days, 1))
        .filter(([city]) => allowedCities.has(normLocation(city)))
        .map(([city, st]) => ({ city, price: st.avgPrice, date: (currentQuotes[id] || []).find((q) => normLocation(q.city) === normLocation(city))?.date || null }));
    };

    const rows = [];
    for (const c of combos) {
      const ratio = REFINING_RATIOS[c.tier];
      const raw = bestMaterialQuote(materialQuotes(c.rawId), { resource: c.rawId }, rrrOpts);
      const prev = c.prevId ? bestMaterialQuote(materialQuotes(c.prevId), { resource: c.prevId }, rrrOpts) : null;
      if (!raw || (c.prevId && !prev)) continue;
      const cost = ratio.raw * raw.price * raw.factor + (c.prevId ? ratio.prevRefined * prev.price * prev.factor : 0);
      const needs = [{ id: c.rawId, perUnit: ratio.raw * raw.factor }];
      if (c.prevId) needs.push({ id: c.prevId, perUnit: ratio.prevRefined * prev.factor });

      const seriesOfItem = finishedHistory.get(c.refinedId) || [];
      let sellPrice, dailyVolume, sellCities, profitPerUnit, sellDate = null;
      if (mode === 'instant') {
        const choice = instantSellChoice(finishedPrices.get(c.refinedId), seriesOfItem, c.refinedId, 1, days, cost, taxRate, cleaned.medians.get(`${c.refinedId}|1`) ?? null);
        if (!choice || choice.dailyVolume < minDaily) continue;
        sellPrice = choice.price; dailyVolume = choice.dailyVolume; sellCities = [choice.city]; profitPerUnit = choice.profitPerUnit; sellDate = choice.date;
      } else {
        const sell = marginSellStats(seriesOfItem, c.refinedId, days, 1, queryCities, 'sum', { taxRate, setupFee: SETUP_FEE_RATE, cost, minShareOfMax: UNIFIED_MIN_CITY_SHARE });
        if (!sell || sell.dailyVolume < minDaily) continue;
        sellPrice = sell.avgPrice; dailyVolume = sell.dailyVolume; sellCities = sell.cities;
        profitPerUnit = sell.avgPrice * (1 - taxRate - SETUP_FEE_RATE) - cost;
        if (profitPerUnit <= 0) continue;
      }
      // Сроки — по ПОЛНОМУ обороту прибыльных городов (без «доли рынка»): позиция на `capital` серебра и её закупка.
      const quantity = Math.max(Math.floor(capital / cost), 1);
      let daysToAcquire = null;
      if (mode === 'patient') {
        const acquire = unifiedAcquire(needs.map((n) => ({ id: n.id, total: Math.ceil(n.perUnit * quantity), perUnit: n.perUnit })), materialHistory, days, 1, queryCities);
        if (!acquire) continue;                                               // у материала нет сделок за период — закупку оценить нельзя
        daysToAcquire = acquire.days;
      }
      const daysToSell = quantity / dailyVolume;
      const cycleDays = (daysToAcquire || 0) + daysToSell;
      const adjusted = batchAdjustedDailyProfit({ profitPerUnit, quantity, cycleDays, minDays });
      const tradeHours = tradeHoursOf(seriesOfItem, 1, sellCities);
      const freshMinutes = dealAgeMinutes([raw.date, ...(prev ? [prev.date] : []), ...(sellDate ? [sellDate] : [])], now);
      rows.push({
        kind: 'material', itemId: c.refinedId, type: c.type, tier: c.tier, cost, avgSellPrice: sellPrice, sellCities,
        dailyVolume, profitPerUnit, profitPct: (profitPerUnit / cost) * 100,
        quantity, batchProfit: adjusted.batchProfit, positionCost: quantity * cost, daysToAcquire, daysToSell, cycleDays, effectiveDays: adjusted.effectiveDays,
        cappedByMinDays: cycleDays < minDays, dailyProfit: adjusted.dailyProfit,
        premiumDays: premiumPaybackDays(adjusted.dailyProfit, 1),
        rawRrr: raw.rrr, prevRrr: prev ? prev.rrr : null, cityBonus: raw.cityBonus || (!!prev && prev.cityBonus),
        tradeHours, confidence: confidenceOf(tradeHours), freshMinutes,
        rankScore: adjusted.dailyProfit * freshnessDecay(freshMinutes),
      });
    }
    rows.sort((a, b) => b.rankScore - a.rankScore);
    const data = {
      mode, days, capital, minDays, taxRate, setupFeeRate: mode === 'patient' ? SETUP_FEE_RATE : 0, premiumPrice: PREMIUM_PRICE_SILVER,
      rrrOptions: rrrOpts, scanned: combos.length, jug: fresh, results: rows,
    };
    refineScanCache = { key: cacheKey, ts: now, data };
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'не удалось выполнить скан рефайна', details: err.message });
  }
});
let refineScanCache = null;

// --- Мастерки: дерево и сохранённые уровни ---
app.get('/api/masteries', (req, res) => {
  res.json({ ...MASTERIES, maxLevel: MASTERY_MAX_LEVEL, levels: loadUserMasteryLevels(req.sessionId) });
});

// Принимает { masteries: { id: level }, specializations: { id: level } } — только изменённые поля;
// уровень 0 удаляет запись. Неизвестные id игнорируются.
app.post('/api/masteries', (req, res) => {
  try {
    const current = loadUserMasteryLevels(req.sessionId);
    const body = req.body || {};
    const apply = (incoming, known, target) => {
      for (const [id, level] of Object.entries(incoming || {})) {
        if (!known.has(id)) continue;
        const lvl = Math.min(Math.max(parseInt(level, 10) || 0, 0), MASTERY_MAX_LEVEL);
        if (lvl === 0) delete target[id];
        else target[id] = lvl;
      }
    };
    apply(body.masteries, MASTERY_BY_ID, current.masteries);
    apply(body.specializations, SPEC_BY_ID, current.specializations);
    saveUserMasteryLevels(req.sessionId, current);
    res.json({ ok: true, ...current });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'не удалось сохранить уровни мастерок', details: err.message });
  }
});

// --- Примерочная: самая дешёвая экипировка под целевой Item Power ---
// Игрок выбирает по предмету (семейству) на каждый слот и целевой средний IP. Для каждого семейства
// перебираются все тиры / зачарования / качества с реальными рыночными ценами, затем ищется K самых
// дешёвых комбинаций, у которых средний IP по 6 слотам не ниже цели. Тир подбирается автоматически.
// Общий IP персонажа — среднее по 6 слотам: голова, торс, обувь, плащ, осн. рука, левая рука.
// Двуручное оружие занимает обе руки и считается дважды. Специализации/мастерство сюда не входят —
// это персональный бонус, а не то, что покупается на рынке.
const FIT_SLOT_LABELS = { weapon: 'оружие', offhand: 'левая рука', head: 'шлем', chest: 'торс', shoes: 'обувь', cape: 'плащ' };
const FIT_ALLOWED_VARIANTS = [3, 5, 10, 15];
const ALL_QUALITIES = [1, 2, 3, 4, 5];

function familyIdOf(itemId) {
  return itemId.replace(/^T\d+_/, '');
}
const ITEMS_BY_FAMILY = new Map();
for (const item of ITEMS) {
  if (!GEAR_IDS.has(item.id)) continue;
  const fam = familyIdOf(item.id);
  if (!ITEMS_BY_FAMILY.has(fam)) ITEMS_BY_FAMILY.set(fam, []);
  ITEMS_BY_FAMILY.get(fam).push(item);
}
// К какому слоту относится семейство (по слоту любого его предмета).
function familySlot(family) {
  const items = ITEMS_BY_FAMILY.get(family);
  return items && items.length ? items[0].slot : null;
}
const SLOT_ACCEPTS = {
  weapon: ['осн. рука', 'двуручное'],
  offhand: ['левая рука'],
  head: ['шлем'],
  chest: ['торс'],
  shoes: ['обувь'],
  cape: ['плащ', 'плащ (фракция)', 'плащ (охотник)'],
};

// Цены гира сразу по нескольким качествам одним запросом (AODP принимает qualities=1,2,3,4,5).
async function fetchGearPrices(queryIds, qualities) {
  const CHUNK = 50;
  const chunks = [];
  for (let i = 0; i < queryIds.length; i += CHUNK) chunks.push(queryIds.slice(i, i + CHUNK));
  const results = await mapLimit(chunks, AODP_CONCURRENCY, async (chunk) => {
    const key = `gear:${qualities.join('')}:${chunk.slice().sort().join(',')}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;
    const url = `${AODP_BASE}/${encodeURIComponent(chunk.join(','))}?locations=${CITIES.join(',')}&qualities=${qualities.join(',')}`;
    const response = await aodpFetch(url);
    if (!response.ok) throw new Error(`AODP responded ${response.status}`);
    const data = await response.json();
    cache.set(key, { ts: Date.now(), data });
    return data;
  });
  return results.flat();
}

// Убираем заведомо невыгодные варианты: если есть вариант с не меньшим IP и не большей ценой,
// покупать этот смысла нет. Остаётся "эффективная граница" цена/IP.
function paretoFrontier(options) {
  const sorted = options.slice().sort((a, b) => b.ip - a.ip || a.price - b.price);
  const frontier = [];
  let bestPrice = Infinity;
  for (const o of sorted) {
    if (o.price < bestPrice) { frontier.push(o); bestPrice = o.price; }
  }
  return frontier;
}

// K самых дешёвых комбинаций, чей суммарный IP лежит в окне [minTotalIP, maxTotalIP]. Слот — { key, mult, options }, где
// mult=2 у двуручного оружия (его IP считается дважды при одной цене). Динамика по сумме IP:
// в каждой "корзине" суммы держим только K самых дешёвых частичных наборов.
function findCheapestOutfits(slots, minTotalIP, maxTotalIP, k) {
  // IP с мастерками дробный, поэтому корзина — округлённая сумма, а точная сумма хранится в самом состоянии.
  let states = new Map([[0, [{ ip: 0, price: 0, picks: [] }]]]);
  for (const slot of slots) {
    const next = new Map();
    for (const list of states.values()) {
      for (const opt of slot.options) {
        for (const st of list) {
          const total = st.ip + slot.mult * opt.ip;
          if (total > maxTotalIP) continue; // IP только растёт — дальше это состояние уже не вернуть в окно
          const bucketKey = Math.round(total);
          let bucket = next.get(bucketKey);
          if (!bucket) { bucket = []; next.set(bucketKey, bucket); }
          bucket.push({ ip: total, price: st.price + opt.price, picks: [...st.picks, { key: slot.key, opt }] });
        }
      }
    }
    for (const bucket of next.values()) {
      bucket.sort((a, b) => a.price - b.price);
      if (bucket.length > k) bucket.length = k;
    }
    states = next;
  }
  const all = [];
  for (const list of states.values()) {
    for (const st of list) if (st.ip >= minTotalIP && st.ip <= maxTotalIP) all.push({ totalIP: st.ip, price: st.price, picks: st.picks });
  }
  all.sort((a, b) => a.price - b.price);
  return all.slice(0, k);
}

app.get('/api/fitting-room', async (req, res) => {
  try {
    const targetIP = parseFloat(req.query.targetIP);
    // Гистерезис: IP скачет ступенями (тир/зачарование/качество), поэтому вместо точной цели берём окно
    // [цель - допуск вниз; цель + допуск вверх]. Так примерочная не тянет слишком дорогую вещь ради пары IP.
    const tolMinus = Math.max(parseFloat(req.query.tolMinus) || 0, 0);
    const tolPlus = Math.max(parseFloat(req.query.tolPlus) || 0, 0);
    const variants = FIT_ALLOWED_VARIANTS.includes(parseInt(req.query.variants, 10)) ? parseInt(req.query.variants, 10) : 3;
    const citiesParam = req.query.cities;
    const queryCities = citiesParam ? citiesParam.split(',').map((s) => s.trim()).filter(Boolean) : Object.values(CITY_DISPLAY);
    const allowedCities = new Set(queryCities.map(normLocation));

    const { weapon, offhand, head, chest, shoes, cape } = req.query;
    if (!weapon || !head || !chest || !shoes || !cape) {
      return res.status(400).json({ error: 'нужно выбрать оружие, шлем, торс, обувь и плащ' });
    }
    if (!(targetIP > 0)) return res.status(400).json({ error: 'targetIP должен быть положительным числом' });

    const families = { weapon, head, chest, shoes, cape };
    for (const [key, fam] of Object.entries(families)) {
      const slot = familySlot(fam);
      if (!slot || !SLOT_ACCEPTS[key].includes(slot)) {
        return res.status(400).json({ error: `"${fam}" не подходит для слота "${FIT_SLOT_LABELS[key]}"` });
      }
    }
    const twoHanded = familySlot(weapon) === 'двуручное';
    if (twoHanded && offhand) return res.status(400).json({ error: 'двуручное оружие уже занимает обе руки — левую руку выбирать не нужно' });
    if (!twoHanded) {
      if (!offhand) return res.status(400).json({ error: 'для одноручного оружия нужно выбрать предмет в левую руку' });
      const slot = familySlot(offhand);
      if (!slot || !SLOT_ACCEPTS.offhand.includes(slot)) return res.status(400).json({ error: `"${offhand}" не подходит для слота "${FIT_SLOT_LABELS.offhand}"` });
      families.offhand = offhand;
    }

    // Все варианты (тир × зачарование) каждого семейства и их id для запроса цен.
    const meta = new Map(); // queryId -> { itemId, tier, enchant }
    for (const fam of Object.values(families)) {
      for (const item of ITEMS_BY_FAMILY.get(fam)) {
        for (let e = 0; e <= maxEnchantForGear(item.tier); e++) {
          meta.set(e > 0 ? `${item.id}@${e}` : item.id, { itemId: item.id, tier: item.tier, enchant: e });
        }
      }
    }
    const prices = await fetchGearPrices([...meta.keys()], ALL_QUALITIES);

    // Самая дешёвая цена покупки по каждому (id, качество) среди выбранных городов.
    const cheapest = new Map();
    for (const rec of prices) {
      if (!rec.sell_price_min || !allowedCities.has(normLocation(rec.city))) continue;
      const key = `${rec.item_id}|${rec.quality}`;
      const cur = cheapest.get(key);
      if (!cur || rec.sell_price_min < cur.price) cheapest.set(key, { price: rec.sell_price_min, city: rec.city });
    }

    const userLevels = loadUserMasteryLevels(req.sessionId);
    const slotDefs = [];
    const emptyFamilies = [];
    for (const [key, fam] of Object.entries(families)) {
      const options = [];
      for (const [queryId, m] of meta) {
        if (familyIdOf(m.itemId) !== fam) continue;
        for (const q of ALL_QUALITIES) {
          const hit = cheapest.get(`${queryId}|${q}`);
          if (!hit) continue;
          const masteryBonus = masteryIPBonus(fam, m.tier, userLevels);
          options.push({
            itemId: m.itemId, tier: m.tier, enchant: m.enchant, quality: q,
            ip: itemIP(m.tier, m.enchant, q) + masteryBonus, masteryBonus, price: hit.price, city: hit.city,
          });
        }
      }
      if (options.length === 0) emptyFamilies.push(fam);
      slotDefs.push({ key, mult: key === 'weapon' && twoHanded ? 2 : 1, options: paretoFrontier(options) });
    }
    if (emptyFamilies.length) return res.status(502).json({ error: `нет рыночных цен ни на один вариант: ${emptyFamilies.join(', ')}` });

    const maxTotal = slotDefs.reduce((sum, s) => sum + s.mult * Math.max(...s.options.map((o) => o.ip)), 0);
    const minIP = targetIP - tolMinus;
    const maxIP = targetIP + tolPlus;
    const outfits = findCheapestOutfits(slotDefs, minIP * 6, maxIP * 6, variants);

    res.json({
      targetIP,
      tolMinus,
      tolPlus,
      maxAchievableIP: maxTotal / 6,
      unreachable: outfits.length === 0 && minIP > maxTotal / 6,
      emptyWindow: outfits.length === 0 && minIP <= maxTotal / 6,
      twoHanded,
      variants: outfits.map((o) => ({
        totalPrice: o.price,
        avgIP: o.totalIP / 6,
        slots: Object.fromEntries(o.picks.map((p) => [p.key, p.opt])),
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'не удалось подобрать экипировку', details: err.message });
  }
});

// --- Кувшин: каталог id для фонового краулера ---
// Всё, что могут запросить калькулятор и сканы: весь гир (.0–.4 на T4+), сырьё и переработанные ресурсы (с зачарованными версиями),
// материалы рецептов на всех уровнях зачарования, руны/души/реликвии для зачарования вещей. Дубликаты убираются.
// Задания краулера: готовый гир ходит во все города И в Чёрный Рынок (ЧР только покупает гир — sell_price_min у него пустой),
// остальное (сырьё, ресурсы, руны/души) — только в города. Число запросов не меняется: чанкуется по предметам, а не по городам.
function buildJugJobs() {
  const all = buildJugCatalog();
  const gear = new Set();
  for (const item of ITEMS) {
    if (item.category !== 'weapon' && item.category !== 'armor' && item.category !== 'cape') continue;
    for (const v of enchantVariants(item)) gear.add(v.queryId);
  }
  return [
    { name: 'gear', ids: all.filter((id) => gear.has(id)), cities: [...CITIES, BM_QUERY_LOCATION] },
    { name: 'materials', ids: all.filter((id) => !gear.has(id)), cities: CITIES },
  ];
}

function buildJugCatalog() {
  const ids = new Set();
  for (const item of ITEMS) {
    for (const v of enchantVariants(item)) ids.add(v.queryId);
  }
  for (const recipe of Object.values(RECIPES)) {
    for (let e = 0; e <= 4; e++) {
      for (const r of recipe.resources) ids.add(effectiveRecipeResourceId(r.resource, e));
    }
  }
  for (let tier = 4; tier <= 8; tier++) {
    for (const level of [1, 2, 3]) ids.add(`T${tier}_${ENCHANT_MATERIAL_BY_LEVEL[level]}`);
  }
  return [...ids].sort();
}

// Помечает каждую запись ответа временем реального похода в AODP (ts из кэша), чтобы кувшин не выдавал ответ двухминутной
// давности из кэша за «только что полученный». Формат остальных данных не меняется — это лишняя служебная строка _fetchedAt.
function tagFetchedAt(data, ts) {
  for (const row of data) row._fetchedAt = ts;
  return data;
}

// Фоновый краулер ходит теми же общими функциями (со своим приоритетом 0 в регуляторе бюджета и общим кэшем ответов),
// что и живые запросы. Данные кладёт в локальную базу — сканеры по ней пока не работают (это следующие шаги).
// База открывается сразу при загрузке модуля: из неё читает и краулер (пишет), и объединённый скан (читает).
// В тестах JUG_DB_PATH=:memory: — тесты не трогают реальную базу и сами засеивают её данными.
const JUG_DB_PATH = process.env.JUG_DB_PATH || path.join(__dirname, 'data', 'jug.db');
const jugDb = openJug(JUG_DB_PATH);
let jugCrawler = null;
function startJug() {
  if (process.env.DISABLE_JUG_CRAWLER === 'true' || jugCrawler) return;
  const catalog = buildJugCatalog();
  const pruned = pruneToCatalog(jugDb, catalog);
  if (pruned.prices || pruned.history) console.log(`кувшин: удалены строки вне каталога — цен ${pruned.prices}, истории ${pruned.history}`);
  const historyStart = () => new Date(Date.now() - 7 * 24 * 3600 * 1000);
  jugCrawler = startJugCrawler({
    db: jugDb,
    jobs: buildJugJobs(),
    log: (msg) => console.log(msg),
    fetchPrices: async (chunk, cities = CITIES) => {
      const key = `jug:prices:${cities.join(',')}:${chunk.join(',')}`;
      const cached = cache.get(key);
      if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return tagFetchedAt(cached.data, cached.ts);
      const url = `${AODP_BASE}/${encodeURIComponent(chunk.join(','))}?locations=${cities.join(',')}&qualities=${ALL_QUALITIES.join(',')}`;
      const response = await aodpFetch(url, 0);
      if (!response.ok) throw new Error(`AODP responded ${response.status}`);
      const ts = Date.now();
      const data = tagFetchedAt(await response.json(), ts);
      cache.set(key, { ts, data });
      return data;
    },
    // История — один раз на самое широкое окно (7 дней): короткие окна (12ч/24ч/72ч) агрегируются из тех же точек локально.
    fetchHistory: async (chunk, cities = CITIES) => {
      const key = `jug:history:${cities.join(',')}:${chunk.join(',')}`;
      const cached = historyCache.get(key);
      if (cached && Date.now() - cached.ts < HISTORY_CACHE_TTL_MS) return tagFetchedAt(cached.data, cached.ts);
      const url = `${AODP_HISTORY_BASE}/${encodeURIComponent(chunk.join(','))}?date=${fmtDate(historyStart())}&end_date=${fmtDate(new Date())}&locations=${cities.join(',')}&qualities=${ALL_QUALITIES.join(',')}&time-scale=1`;
      const response = await aodpFetch(url, 0);
      if (!response.ok) throw new Error(`AODP history responded ${response.status}`);
      const ts = Date.now();
      const data = tagFetchedAt(await response.json(), ts);
      historyCache.set(key, { ts, data });
      return data;
    },
  });
}

// Порт занимаем только при прямом запуске (node server.js); при require() из тестов — нет.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Albion market table запущен на http://localhost:${PORT}`);
  });
  startJug();
}

// Тесты подменяют AODP по-разному — кэши ответов между тестами сбрасываем, чтобы не было «отравления» кэша.
function resetCaches() {
  cache.clear();
  historyCache.clear();
  scanCache = null;
  bmScanCache = null;
  unifiedScanCache = null;
  refineScanCache = null;
  enchantScanCache = null;
}

module.exports = {
  app,
  resetCaches,
  refineComponents,
  refineAlternative,
  bestMaterialQuote,
  itemIP,
  baseIPForTier,
  maxEnchantForGear,
  masteryIPBonus,
  familyIdOf,
  paretoFrontier,
  findCheapestOutfits,
  freshnessDecay,
  bulkCycleDecay,
  opportunityScore,
  scaledMinVolume,
  getSalesTaxRate,
  getBmTaxRate,
  quoteAgeMinutes,
  dealAgeMinutes,
  normLocation,
  totalVolume,
  cityStats,
  computeBulkPlan,
  returnFactor,
  requiresEnchantAfterCraft,
  cityPriceList,
  marginSellStats,
  premiumPaybackDays,
  computePatientSell,
  computeAcquireTime,
  planCityAllocation,
  maxProfitCityAllocation,
  batchAdjustedDailyProfit,
  computeSellThreshold,
  teleportDistance,
  teleportStackCost,
  planCraftTeleport,
  enchantMaterialId,
  ENCHANT_MATERIAL_COUNT,
  gearEnchantId,
  enchantVariants,
  mapLimit,
  allocateBudget,
  lazyStrategyScore,
  effectiveRecipeResourceId,
  buildJugCatalog,
  buildJugJobs,
  aodpBudget,
  jugDb,
  materialRrr,
  resourceTypeOf,
  tradeHoursOf,
  confidenceOf,
};
