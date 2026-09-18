const express = require('express');
const path = require('path');
const { ITEMS } = require('./data/items');
const { REFINING_RATIOS, RRR_PRESETS, rrrFromBonus, BONUS_CITY } = require('./data/refining');
const RECIPES = require('./data/recipes.json');
const EXTRA_ITEM_NAMES = require('./data/extra-item-names.json');

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
function maxEnchantForGear(tier) {
  return tier >= 4 ? 4 : 0; // T2/T3 гир никогда не зачаровывается — та же логика, что и на фронте
}

const RESOURCE_TYPES = ['WOOD', 'ORE', 'FIBER', 'HIDE', 'ROCK'];
const REFINED_NAME = { WOOD: 'PLANKS', ORE: 'METALBAR', FIBER: 'CLOTH', HIDE: 'LEATHER', ROCK: 'STONEBLOCK' };
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
  const res = await fetch(url);
  if (!res.ok) throw new Error(`AODP responded ${res.status}`);
  const data = await res.json();
  cache.set(key, { ts: Date.now(), data });
  return data;
}

async function fetchPricesBatched(itemIds, quality) {
  const CHUNK = 50;
  const chunks = [];
  for (let i = 0; i < itemIds.length; i += CHUNK) chunks.push(itemIds.slice(i, i + CHUNK));
  const results = await Promise.all(chunks.map((c) => fetchPrices(c, quality)));
  return results.flat();
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

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
      return res.status(400).json({ error: 'query param "items" is required, e.g. ?items=T4_WOOD,T4_PLANKS' });
    }
    const itemIds = itemsParam.split(',').map((s) => s.trim()).filter(Boolean);
    if (itemIds.length === 0) return res.status(400).json({ error: 'no valid item ids provided' });
    if (itemIds.length > 300) return res.status(400).json({ error: 'max 300 items per request' });
    const data = await fetchPricesBatched(itemIds, quality);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'failed to fetch AODP data', details: err.message });
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

  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const key = `batch:${quality}:${locKey}:${hours}:${chunk.slice().sort().join(',')}`;
      const cached = historyCache.get(key);
      if (cached && Date.now() - cached.ts < HISTORY_CACHE_TTL_MS) return cached.data;
      const url = `${AODP_HISTORY_BASE}/${encodeURIComponent(chunk.join(','))}?date=${fmtDate(start)}&end_date=${fmtDate(now)}&locations=${locKey}&qualities=${quality}&time-scale=1`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`AODP history responded ${response.status}`);
      const data = await response.json();
      historyCache.set(key, { ts: Date.now(), data });
      return data;
    })
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
function totalVolume(historyData, itemId, locations) {
  const allowed = locations ? new Set(locations.map(normLocation)) : null;
  let total = 0;
  for (const series of historyData) {
    if (series.item_id !== itemId) continue;
    if (allowed && !allowed.has(normLocation(series.location))) continue;
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
    if (!item) return res.status(400).json({ error: 'query param "item" is required' });

    const now = new Date();
    const start = new Date(now.getTime() - hours * 3600 * 1000);
    const key = `single:${item}:${hours}:${quality}`;
    const cached = historyCache.get(key);
    if (cached && Date.now() - cached.ts < HISTORY_CACHE_TTL_MS) {
      return res.json(cached.data);
    }
    const url = `${AODP_HISTORY_BASE}/${encodeURIComponent(item)}?date=${fmtDate(start)}&end_date=${fmtDate(now)}&locations=${CITIES.join(',')}&qualities=${quality}&time-scale=1`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`AODP responded ${response.status}`);
    const data = await response.json();
    historyCache.set(key, { ts: Date.now(), data });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'failed to fetch AODP history', details: err.message });
  }
});

const RESOURCE_NAME_RU = { WOOD: 'Дерево/Доски', ORE: 'Руда/Слитки', FIBER: 'Волокно/Ткань', HIDE: 'Шкура/Кожа', ROCK: 'Камень/Блоки' };

app.get('/api/refining-meta', (req, res) => {
  res.json({
    resourceTypes: RESOURCE_TYPES.map((t) => ({ id: t, name: RESOURCE_NAME_RU[t], bonusCity: BONUS_CITY[t] })),
    rrrPresets: RRR_PRESETS.map((p) => ({ ...p, rrr: rrrFromBonus(p.bonus) })),
  });
});

app.get('/api/refining-calc', async (req, res) => {
  try {
    const type = req.query.type;
    const tier = parseInt(req.query.tier, 10);
    const rrrId = req.query.rrr || 'city_bonus';
    const enchant = Math.min(Math.max(parseInt(req.query.enchant, 10) || 0, 0), 4);
    const citiesParam = req.query.cities;

    if (!RESOURCE_TYPES.includes(type)) return res.status(400).json({ error: `type must be one of: ${RESOURCE_TYPES.join(', ')}` });
    if (!REFINING_RATIOS[tier]) return res.status(400).json({ error: 'tier must be 2-8' });
    const preset = RRR_PRESETS.find((p) => p.id === rrrId);
    if (!preset) return res.status(400).json({ error: `rrr must be one of: ${RRR_PRESETS.map((p) => p.id).join(', ')}` });
    const maxEnchant = tier < 4 ? 0 : type === 'ROCK' ? 3 : 4;
    if (enchant > maxEnchant) return res.status(400).json({ error: `enchant ${enchant} not available for T${tier} ${type} (max ${maxEnchant})` });

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

    const rrr = rrrFromBonus(preset.bonus);
    const taxRate = getSalesTaxRate(req);
    const queryCities = citiesParam ? citiesParam.split(',').map((s) => s.trim()).filter(Boolean) : Object.values(CITY_DISPLAY);

    const perCity = queryCities.map((city) => {
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
      return { city, rawPrice, prevPrice, outputSell, outputBuy, netOutputSell, baseCost, effectiveCost, profit };
    });

    res.json({ itemId: refinedId, tier, type, enchant, ratio, taxRate, rrrPreset: { ...preset, rrr }, bonusCity: BONUS_CITY[type], perCity });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'failed to compute refining calc', details: err.message });
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

app.get('/api/craft-calc', async (req, res) => {
  try {
    const itemId = req.query.item;
    const enchant = Math.min(Math.max(parseInt(req.query.enchant, 10) || 0, 0), 4);
    const quality = Math.min(Math.max(parseInt(req.query.quality, 10) || 1, 1), 5);
    const quantity = Math.min(Math.max(parseInt(req.query.quantity, 10) || 1, 1), 100000);
    const citiesParam = req.query.cities;
    const rrrId = req.query.rrr || 'none';

    if (!itemId || !RECIPES[itemId]) return res.status(404).json({ error: `no recipe found for item "${itemId}"` });
    const preset = RRR_PRESETS.find((p) => p.id === rrrId) || RRR_PRESETS[0];
    const rrr = rrrFromBonus(preset.bonus);
    const queryCities = citiesParam ? citiesParam.split(',').map((s) => s.trim()).filter(Boolean) : Object.values(CITY_DISPLAY);

    const recipe = RECIPES[itemId];
    const resourceQueryIds = recipe.resources.map((r) => effectiveRecipeResourceId(r.resource, enchant));
    const finishedQueryId = enchant > 0 ? `${itemId}@${enchant}` : itemId;

    const materialIds = [...new Set(resourceQueryIds)];
    const materialData = await fetchPricesBatched(materialIds, 1);
    const finishedData = await fetchPricesBatched([finishedQueryId], quality);

    const materialByCity = {};
    for (const rec of materialData) {
      if (!materialByCity[rec.item_id]) materialByCity[rec.item_id] = {};
      materialByCity[rec.item_id][rec.city] = rec;
    }
    const finishedByCity = {};
    for (const rec of finishedData) {
      if (!finishedByCity[rec.item_id]) finishedByCity[rec.item_id] = {};
      finishedByCity[rec.item_id][rec.city] = rec;
    }

    let materialCostPerUnit = 0;
    let hasAllPrices = true;
    const recipeBreakdown = recipe.resources.map((r) => {
      const queryId = effectiveRecipeResourceId(r.resource, enchant);
      const isEnchanted = queryId !== r.resource;
      const cityPrices = materialByCity[queryId] || {};
      let cheapest = null;
      for (const city of queryCities) {
        const rec = cityPrices[city];
        if (rec && rec.sell_price_min && (!cheapest || rec.sell_price_min < cheapest.price)) {
          cheapest = { city, price: rec.sell_price_min };
        }
      }
      if (!cheapest) hasAllPrices = false;
      else materialCostPerUnit += cheapest.price * r.count;

      return {
        resource: r.resource,
        resourceName: resolveItemName(r.resource),
        queryId,
        enchanted: isEnchanted,
        count: r.count,
        cheapestCity: cheapest ? cheapest.city : null,
        cheapestPrice: cheapest ? cheapest.price : null,
      };
    });

    const effectiveCostPerUnit = materialCostPerUnit * (1 - rrr) + (recipe.silver || 0);
    const finishedCityData = finishedByCity[finishedQueryId] || {};
    const sellPrices = queryCities.map((city) => {
      const rec = finishedCityData[city];
      return { city, sellMin: rec?.sell_price_min || null, buyMax: rec?.buy_price_max || null };
    });
    let bestSell = null;
    for (const sp of sellPrices) {
      if (sp.buyMax && (!bestSell || sp.buyMax > bestSell.price)) bestSell = { city: sp.city, price: sp.buyMax };
    }
    const taxRate = getSalesTaxRate(req);
    const netSellPrice = bestSell ? bestSell.price * (1 - taxRate) : null;
    const profitPerUnit = netSellPrice !== null ? netSellPrice - effectiveCostPerUnit : null;

    res.json({
      itemId, enchant, quality, quantity,
      rrrPreset: { ...preset, rrr },
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
      totalProfit: profitPerUnit !== null ? profitPerUnit * quantity : null,
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'failed to compute craft calc', details: err.message });
  }
});

// --- Сканер возможностей (спред по всему каталогу) ---
const SCAN_CACHE_TTL_MS = 5 * 60 * 1000;
let scanCache = null;

app.get('/api/opportunities', async (req, res) => {
  try {
    const taxRate = getSalesTaxRate(req);
    if (scanCache && scanCache.taxRate === taxRate && Date.now() - scanCache.ts < SCAN_CACHE_TTL_MS) return res.json(scanCache.data);

    const allIds = ITEMS.map((i) => i.id);
    const data = await fetchPricesBatched(allIds, 1);

    const byItem = {};
    for (const rec of data) {
      if (!byItem[rec.item_id]) byItem[rec.item_id] = [];
      byItem[rec.item_id].push(rec);
    }

    const now = Date.now();
    const results = [];
    for (const itemId of Object.keys(byItem)) {
      const records = byItem[itemId];
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
      if (spread <= 0) continue;
      const spreadPct = (spread / bestBuy.price) * 100;
      // Свежесть — по двум котировкам самой сделки, а не по любым записям предмета.
      const freshMinutes = dealAgeMinutes([bestBuy.date, bestSell.date], now);
      results.push({ itemId, bestBuy, bestSell, grossSellPrice, taxRate, spread, spreadPct, freshMinutes });
    }

    results.sort((a, b) => b.spreadPct - a.spreadPct);

    // Стадия 2: у ВСЕХ позиций со спредом проверяем реальный объём сделок за 24ч —
    // не только у топ-60 по спреду, иначе туда чаще всего попадают нишевые вещи
    // с огромным спредом на 1-2 случайных ордерах, и почти всё потом отсеивается.
    const candidates = results;
    const MIN_VOLUME_24H = 3; // меньше — считаем "по факту не продаётся"

    let withVolume = candidates;
    try {
      const historyData = await fetchHistoryBatched(candidates.map((c) => c.itemId), 24, 1, CITIES);
      withVolume = candidates
        // Объём — только по двум городам сделки: ликвидность в других городах мне не поможет.
        .map((c) => ({ ...c, volume24h: totalVolume(historyData, c.itemId, [c.bestBuy.city, c.bestSell.city]) }))
        .filter((c) => c.volume24h >= MIN_VOLUME_24H)
        .map((c) => ({ ...c, score: opportunityScore(c.spreadPct, c.volume24h) * freshnessDecay(c.freshMinutes) }))
        .sort((a, b) => b.score - a.score);
    } catch (err) {
      // Если история не смогла подгрузиться — не роняем весь сканер, просто отдаём
      // без данных об объёме (клиент это отобразит как "не проверено").
      console.error('history check failed for opportunities scan:', err.message);
      withVolume = candidates.map((c) => ({ ...c, volume24h: null }));
    }

    const top = withVolume.slice(0, 25);
    scanCache = { taxRate, ts: Date.now(), data: top };
    res.json(top);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'failed to scan opportunities', details: err.message });
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
    const cacheKey = queryCities.slice().sort().join(',');
    if (bmScanCache && bmScanCache.key === cacheKey && Date.now() - bmScanCache.ts < SCAN_CACHE_TTL_MS) return res.json(bmScanCache.data);
    const bmLocations = [...queryCities.map((c) => c.replace(/\s+/g, '')), BM_QUERY_LOCATION];

    const gearIds = ITEMS.filter((i) => i.category === 'weapon' || i.category === 'armor' || i.category === 'cape').map((i) => i.id);
    const CHUNK = 50;
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
        const response = await fetch(url);
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
    for (const itemId of Object.keys(byItem)) {
      const records = byItem[itemId];
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
      if (!bestBuy || !bmSell || bmSell.price <= bestBuy.price) continue;
      const profit = bmSell.price - bestBuy.price;
      const profitPct = (profit / bestBuy.price) * 100;
      // Свежесть — по двум котировкам самой сделки (покупка в городе + цена БМ), а не по всем записям предмета.
      const freshMinutes = dealAgeMinutes([bestBuy.date, bmSell.date], now);
      results.push({ itemId, bestBuy, bmPrice: bmSell.price, profit, profitPct, freshMinutes });
    }

    results.sort((a, b) => b.profitPct - a.profitPct);

    const candidates = results;
    const MIN_BM_VOLUME_24H = 3;
    let withVolume = candidates;
    try {
      const historyData = await fetchHistoryBatched(candidates.map((c) => c.itemId), 24, 1, [BM_QUERY_LOCATION]);
      withVolume = candidates
        .map((c) => ({ ...c, bmVolume24h: totalVolume(historyData, c.itemId) }))
        .filter((c) => c.bmVolume24h >= MIN_BM_VOLUME_24H)
        .map((c) => ({ ...c, score: opportunityScore(c.profitPct, c.bmVolume24h) * freshnessDecay(c.freshMinutes) }))
        .sort((a, b) => b.score - a.score);
    } catch (err) {
      console.error('BM history check failed:', err.message);
      withVolume = candidates.map((c) => ({ ...c, bmVolume24h: null }));
    }

    const top = withVolume.slice(0, 25);
    bmScanCache = { key: cacheKey, ts: Date.now(), data: top };
    res.json(top);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'failed to scan black market', details: err.message });
  }
});

// --- Сканер крафта ---
let craftScanCache = null;

app.get('/api/craft-opportunities', async (req, res) => {
  try {
    const ALLOWED_HOURS = [12, 24, 72, 168];
    const hours = ALLOWED_HOURS.includes(parseInt(req.query.hours, 10)) ? parseInt(req.query.hours, 10) : 24;
    const rrrId = req.query.rrr || 'none';
    const citiesParam = req.query.cities;
    const taxRate = getSalesTaxRate(req);
    const cacheKey = `${hours}:${rrrId}:${citiesParam || 'default'}:${taxRate}`;

    if (craftScanCache && craftScanCache.key === cacheKey && Date.now() - craftScanCache.ts < SCAN_CACHE_TTL_MS) {
      return res.json(craftScanCache.data);
    }

    const preset = RRR_PRESETS.find((p) => p.id === rrrId) || RRR_PRESETS[0];
    const rrr = rrrFromBonus(preset.bonus);
    const queryCities = citiesParam ? citiesParam.split(',').map((s) => s.trim()).filter(Boolean) : Object.values(CITY_DISPLAY);

    const itemIds = Object.keys(RECIPES);
    const allMaterialIds = [...new Set(itemIds.flatMap((id) => RECIPES[id].resources.map((r) => r.resource)))];

    const [materialData, finishedData] = await Promise.all([
      fetchPricesBatched(allMaterialIds, 1),
      fetchPricesBatched(itemIds, 1),
    ]);

    const materialByCity = {};
    for (const rec of materialData) {
      if (!materialByCity[rec.item_id]) materialByCity[rec.item_id] = {};
      materialByCity[rec.item_id][rec.city] = rec;
    }
    const finishedByCity = {};
    for (const rec of finishedData) {
      if (!finishedByCity[rec.item_id]) finishedByCity[rec.item_id] = {};
      finishedByCity[rec.item_id][rec.city] = rec;
    }

    const results = [];
    for (const itemId of itemIds) {
      const recipe = RECIPES[itemId];
      let cost = 0;
      let complete = true;
      const quoteDates = [];
      for (const r of recipe.resources) {
        const cityPrices = materialByCity[r.resource] || {};
        let cheapest = null;
        for (const city of queryCities) {
          const rec = cityPrices[city];
          if (rec && rec.sell_price_min && (!cheapest || rec.sell_price_min < cheapest.price)) {
            cheapest = { price: rec.sell_price_min, date: rec.sell_price_min_date };
          }
        }
        if (cheapest === null) { complete = false; break; }
        cost += cheapest.price * r.count;
        quoteDates.push(cheapest.date);
      }
      if (!complete) continue;

      const effectiveCost = cost * (1 - rrr) + (recipe.silver || 0);
      const sellCityData = finishedByCity[itemId] || {};
      let bestSell = null;
      for (const city of queryCities) {
        const rec = sellCityData[city];
        if (rec && rec.buy_price_max && (!bestSell || rec.buy_price_max > bestSell.price)) {
          bestSell = { city, price: rec.buy_price_max, date: rec.buy_price_max_date };
        }
      }
      if (!bestSell) continue;
      const netSell = bestSell.price * (1 - taxRate);
      if (netSell <= effectiveCost) continue;

      const profit = netSell - effectiveCost;
      const profitPct = (profit / effectiveCost) * 100;
      // Свежесть — по самой старой из котировок сделки: цены материалов и цена продажи.
      const freshMinutes = dealAgeMinutes([...quoteDates, bestSell.date], Date.now());
      results.push({ itemId, cost: effectiveCost, bestSell, taxRate, profit, profitPct, freshMinutes });
    }

    results.sort((a, b) => b.profitPct - a.profitPct);

    const candidates = results;
    const minVolume = scaledMinVolume(hours);
    let withVolume = candidates;
    try {
      const historyData = await fetchHistoryBatched(candidates.map((c) => c.itemId), hours, 1, queryCities);
      withVolume = candidates
        // Объём — по городу, где продаём готовый предмет.
        .map((c) => ({ ...c, volume: totalVolume(historyData, c.itemId, [c.bestSell.city]) }))
        .filter((c) => c.volume >= minVolume)
        .map((c) => ({ ...c, score: opportunityScore(c.profitPct, c.volume) * freshnessDecay(c.freshMinutes) }))
        .sort((a, b) => b.score - a.score);
    } catch (err) {
      console.error('craft scan history check failed:', err.message);
      withVolume = candidates.map((c) => ({ ...c, volume: null }));
    }

    const top = withVolume.slice(0, 25);
    craftScanCache = { key: cacheKey, ts: Date.now(), data: top };
    res.json(top);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'failed to scan craft opportunities', details: err.message });
  }
});

// --- Сканер рефайна ---
let refiningScanCache = null;

app.get('/api/refining-opportunities', async (req, res) => {
  try {
    const ALLOWED_HOURS = [12, 24, 72, 168];
    const hours = ALLOWED_HOURS.includes(parseInt(req.query.hours, 10)) ? parseInt(req.query.hours, 10) : 24;
    const rrrId = req.query.rrr || 'none';
    const citiesParam = req.query.cities;
    const taxRate = getSalesTaxRate(req);
    const cacheKey = `${hours}:${rrrId}:${citiesParam || 'default'}:${taxRate}`;

    if (refiningScanCache && refiningScanCache.key === cacheKey && Date.now() - refiningScanCache.ts < SCAN_CACHE_TTL_MS) {
      return res.json(refiningScanCache.data);
    }

    const preset = RRR_PRESETS.find((p) => p.id === rrrId) || RRR_PRESETS[0];
    const rrr = rrrFromBonus(preset.bonus);
    const queryCities = citiesParam ? citiesParam.split(',').map((s) => s.trim()).filter(Boolean) : Object.values(CITY_DISPLAY);

    const combos = [];
    for (const type of RESOURCE_TYPES) {
      for (const tier of [2, 3, 4, 5, 6, 7, 8]) combos.push({ type, tier });
    }

    const allIds = new Set();
    for (const { type, tier } of combos) {
      allIds.add(`T${tier}_${type}`);
      allIds.add(`T${tier}_${REFINED_NAME[type]}`);
      if (tier > 2) allIds.add(`T${tier - 1}_${REFINED_NAME[type]}`);
    }

    const data = await fetchPricesBatched([...allIds], 1);
    const byItemCity = {};
    for (const rec of data) {
      if (!byItemCity[rec.item_id]) byItemCity[rec.item_id] = {};
      byItemCity[rec.item_id][rec.city] = rec;
    }

    const cheapestAcross = (itemId) => {
      let best = null;
      for (const city of queryCities) {
        const rec = byItemCity[itemId]?.[city];
        if (rec && rec.sell_price_min && (!best || rec.sell_price_min < best.price)) {
          best = { price: rec.sell_price_min, date: rec.sell_price_min_date };
        }
      }
      return best;
    };
    const bestSellAcross = (itemId) => {
      let best = null;
      for (const city of queryCities) {
        const rec = byItemCity[itemId]?.[city];
        if (rec && rec.buy_price_max && (!best || rec.buy_price_max > best.price)) {
          best = { city, price: rec.buy_price_max, date: rec.buy_price_max_date };
        }
      }
      return best;
    };

    const results = [];
    for (const { type, tier } of combos) {
      const ratio = REFINING_RATIOS[tier];
      const rawId = `T${tier}_${type}`;
      const refinedId = `T${tier}_${REFINED_NAME[type]}`;
      const prevId = tier > 2 ? `T${tier - 1}_${REFINED_NAME[type]}` : null;

      const rawQuote = cheapestAcross(rawId);
      const prevQuote = prevId ? cheapestAcross(prevId) : null;
      if (rawQuote === null || (prevId && prevQuote === null)) continue;

      const cost = ratio.raw * rawQuote.price + (prevId ? ratio.prevRefined * prevQuote.price : 0);
      const effectiveCost = cost * (1 - rrr);

      const bestSell = bestSellAcross(refinedId);
      if (!bestSell) continue;
      const netSell = bestSell.price * (1 - taxRate);
      if (netSell <= effectiveCost) continue;

      const profit = netSell - effectiveCost;
      const profitPct = (profit / effectiveCost) * 100;
      const freshMinutes = dealAgeMinutes([rawQuote.date, ...(prevQuote ? [prevQuote.date] : []), bestSell.date], Date.now());
      results.push({ itemId: refinedId, type, tier, cost: effectiveCost, bestSell, taxRate, profit, profitPct, freshMinutes });
    }

    results.sort((a, b) => b.profitPct - a.profitPct);

    const candidates = results;
    const minVolume = scaledMinVolume(hours);
    let withVolume = candidates;
    try {
      const historyData = await fetchHistoryBatched(candidates.map((c) => c.itemId), hours, 1, queryCities);
      withVolume = candidates
        .map((c) => ({ ...c, volume: totalVolume(historyData, c.itemId, [c.bestSell.city]) }))
        .filter((c) => c.volume >= minVolume)
        .map((c) => ({ ...c, score: opportunityScore(c.profitPct, c.volume) * freshnessDecay(c.freshMinutes) }))
        .sort((a, b) => b.score - a.score);
    } catch (err) {
      console.error('refining scan history check failed:', err.message);
      withVolume = candidates.map((c) => ({ ...c, volume: null }));
    }

    const top = withVolume.slice(0, 25);
    refiningScanCache = { key: cacheKey, ts: Date.now(), data: top };
    res.json(top);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'failed to scan refining opportunities', details: err.message });
  }
});

// --- План крупной партии ---
// Схема "закупаю бай-ордерами, продаю партией за несколько дней": цены берутся не из мгновенных
// котировок, а как средневзвешенные по объёму за период истории, а вместо "есть ли спред" считаем,
// сколько дней уйдёт на закупку сырья и на распродажу партии, не обваливая рынок.
const BULK_ALLOWED_DAYS = [3, 7];

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
function cityStats(historyData, itemId, days) {
  const out = {};
  for (const series of historyData) {
    if (series.item_id !== itemId) continue;
    let volume = 0;
    let weightedSum = 0;
    for (const p of series.data || []) {
      volume += p.item_count;
      weightedSum += p.avg_price * p.item_count;
    }
    if (volume > 0) out[series.location] = { avgPrice: weightedSum / volume, totalVolume: volume, avgDailyVolume: volume / days };
  }
  return out;
}

// Чистый расчёт плана партии по уже загруженной истории — общий для одиночного плана и сканера,
// чтобы цифры по одному предмету не могли разойтись между двумя режимами.
function computeBulkPlan(opts, materialHistory, finishedHistory) {
  const { itemId, enchant, quantity, days, preset, rrr, taxRate, costCeiling, queryCities } = opts;
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
    let source = null;
    for (const [city, st] of Object.entries(stats)) {
      if (!source || st.avgPrice < source.avgPrice) source = { city, ...st };
    }
    const neededRaw = r.count * quantity;
    const neededAfterRrr = Math.ceil(neededRaw * (1 - rrr));
    if (!source) hasAllPrices = false;
    else effectiveCostPerUnit += r.count * (1 - rrr) * source.avgPrice;
    return {
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
      daysToAcquire: source ? neededAfterRrr / source.avgDailyVolume : null,
    };
  });

  let bottleneck = null;
  for (const r of recipeBreakdown) {
    if (r.daysToAcquire !== null && (!bottleneck || r.daysToAcquire > bottleneck.daysToAcquire)) bottleneck = r;
  }

  // Готовый предмет: спрос суммируется по всем выбранным городам, цена — средневзвешенная по объёму.
  const finishedStats = inScope(cityStats(finishedHistory, finishedQueryId, days));
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
    rrrPreset: { ...preset, rrr },
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

function parseBulkDays(req) {
  return BULK_ALLOWED_DAYS.includes(parseInt(req.query.days, 10)) ? parseInt(req.query.days, 10) : 7;
}

app.get('/api/craft-bulk-plan', async (req, res) => {
  try {
    const itemId = req.query.item;
    const enchant = Math.min(Math.max(parseInt(req.query.enchant, 10) || 0, 0), 4);
    const quality = Math.min(Math.max(parseInt(req.query.quality, 10) || 1, 1), 5);
    const quantity = Math.min(Math.max(parseInt(req.query.quantity, 10) || 1, 1), 100000);
    const days = parseBulkDays(req);
    const rrrId = req.query.rrr || 'none';
    const costCeiling = parseFloat(req.query.ceiling) > 0 ? parseFloat(req.query.ceiling) : null;
    const sellLow = parseFloat(req.query.sellLow) > 0 ? parseFloat(req.query.sellLow) : null;
    const sellHigh = parseFloat(req.query.sellHigh) > 0 ? parseFloat(req.query.sellHigh) : null;
    const citiesParam = req.query.cities;

    if (!itemId || !RECIPES[itemId]) return res.status(404).json({ error: `no recipe found for item "${itemId}"` });
    const preset = RRR_PRESETS.find((p) => p.id === rrrId) || RRR_PRESETS[0];
    const rrr = rrrFromBonus(preset.bonus);
    const taxRate = getSalesTaxRate(req);
    const queryCities = citiesParam ? citiesParam.split(',').map((s) => s.trim()).filter(Boolean) : Object.values(CITY_DISPLAY);
    const locations = queryCities.map((c) => c.replace(/\s+/g, ''));

    const resourceQueryIds = RECIPES[itemId].resources.map((r) => effectiveRecipeResourceId(r.resource, enchant));
    const finishedQueryId = enchant > 0 ? `${itemId}@${enchant}` : itemId;
    const [materialHistory, finishedHistory] = await Promise.all([
      fetchHistoryBatched([...new Set(resourceQueryIds)], days * 24, 1, locations),
      fetchHistoryBatched([finishedQueryId], days * 24, quality, locations),
    ]);

    res.json(computeBulkPlan(
      { itemId, enchant, quality, quantity, days, preset, rrr, taxRate, costCeiling, sellLow, sellHigh, queryCities },
      materialHistory, finishedHistory,
    ));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'failed to compute bulk plan', details: err.message });
  }
});

// Сканер партионных возможностей: та же модель, что и в плане партии, сразу по всем рецептам гира
// (без зачарования, обычное качество). Показывает рецепты, прибыльные при цене продажи по рынку,
// и штрафует длинные циклы закупка+распродажа.
app.get('/api/craft-bulk-opportunities', async (req, res) => {
  try {
    const category = ['weapon', 'armor', 'cape'].includes(req.query.category) ? req.query.category : 'all';
    const quantity = Math.min(Math.max(parseInt(req.query.quantity, 10) || 1000, 1), 100000);
    const days = parseBulkDays(req);
    const rrrId = req.query.rrr || 'none';
    const citiesParam = req.query.cities;
    const preset = RRR_PRESETS.find((p) => p.id === rrrId) || RRR_PRESETS[0];
    const rrr = rrrFromBonus(preset.bonus);
    const taxRate = getSalesTaxRate(req);
    const queryCities = citiesParam ? citiesParam.split(',').map((s) => s.trim()).filter(Boolean) : Object.values(CITY_DISPLAY);
    const locations = queryCities.map((c) => c.replace(/\s+/g, ''));

    const categoryById = new Map(ITEMS.map((i) => [i.id, i.category]));
    const itemIds = Object.keys(RECIPES).filter((id) => category === 'all' || categoryById.get(id) === category);
    const materialIds = [...new Set(itemIds.flatMap((id) => RECIPES[id].resources.map((r) => r.resource)))];

    const [materialHistory, finishedHistory] = await Promise.all([
      fetchHistoryBatched(materialIds, days * 24, 1, locations),
      fetchHistoryBatched(itemIds, days * 24, 1, locations),
    ]);

    const results = [];
    for (const itemId of itemIds) {
      const plan = computeBulkPlan(
        { itemId, enchant: 0, quality: 1, quantity, days, preset, rrr, taxRate, costCeiling: null, sellLow: null, sellHigh: null, queryCities },
        materialHistory, finishedHistory,
      );
      if (!plan.hasAllMaterialPrices || plan.profitPerUnitLow === null || plan.profitPerUnitLow <= 0) continue;
      if (plan.totalDaysEstimate === null) continue;
      const profitPct = (plan.profitPerUnitLow / plan.effectiveCostPerUnit) * 100;
      results.push({
        itemId,
        cost: plan.effectiveCostPerUnit,
        marketAvgSellPrice: plan.marketAvgSellPrice,
        bestSellCity: plan.bestSellCity,
        profit: plan.profitPerUnitLow,
        profitPct,
        bottleneckResource: plan.bottleneckResource,
        daysToAcquireBatch: plan.daysToAcquireBatch,
        daysToSellBatch: plan.daysToSellBatch,
        totalDays: plan.totalDaysEstimate,
        avgDailySellVolume: plan.avgDailySellVolume,
        quantity,
        score: opportunityScore(profitPct, plan.avgDailySellVolume) * bulkCycleDecay(plan.totalDaysEstimate),
      });
    }
    results.sort((a, b) => b.score - a.score);
    res.json(results.slice(0, 25));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'failed to scan bulk craft opportunities', details: err.message });
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
  cape: ['плащ', 'плащ (фракция)'],
};

// Цены гира сразу по нескольким качествам одним запросом (AODP принимает qualities=1,2,3,4,5).
async function fetchGearPrices(queryIds, qualities) {
  const CHUNK = 50;
  const chunks = [];
  for (let i = 0; i < queryIds.length; i += CHUNK) chunks.push(queryIds.slice(i, i + CHUNK));
  const results = await Promise.all(chunks.map(async (chunk) => {
    const key = `gear:${qualities.join('')}:${chunk.slice().sort().join(',')}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;
    const url = `${AODP_BASE}/${encodeURIComponent(chunk.join(','))}?locations=${CITIES.join(',')}&qualities=${qualities.join(',')}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`AODP responded ${response.status}`);
    const data = await response.json();
    cache.set(key, { ts: Date.now(), data });
    return data;
  }));
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
  let states = new Map([[0, [{ price: 0, picks: [] }]]]);
  for (const slot of slots) {
    const next = new Map();
    for (const [ip, list] of states) {
      for (const opt of slot.options) {
        const total = ip + slot.mult * opt.ip;
        if (total > maxTotalIP) continue; // IP только растёт — дальше это состояние уже не вернуть в окно
        let bucket = next.get(total);
        if (!bucket) { bucket = []; next.set(total, bucket); }
        for (const st of list) bucket.push({ price: st.price + opt.price, picks: [...st.picks, { key: slot.key, opt }] });
      }
    }
    for (const [total, bucket] of next) {
      bucket.sort((a, b) => a.price - b.price);
      if (bucket.length > k) bucket.length = k;
    }
    states = next;
  }
  const all = [];
  for (const [ip, list] of states) {
    if (ip >= minTotalIP && ip <= maxTotalIP) for (const st of list) all.push({ totalIP: ip, price: st.price, picks: st.picks });
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

    const slotDefs = [];
    const emptyFamilies = [];
    for (const [key, fam] of Object.entries(families)) {
      const options = [];
      for (const [queryId, m] of meta) {
        if (familyIdOf(m.itemId) !== fam) continue;
        for (const q of ALL_QUALITIES) {
          const hit = cheapest.get(`${queryId}|${q}`);
          if (!hit) continue;
          options.push({ itemId: m.itemId, tier: m.tier, enchant: m.enchant, quality: q, ip: itemIP(m.tier, m.enchant, q), price: hit.price, city: hit.city });
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
    res.status(502).json({ error: 'failed to compute fitting room', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Albion market table running on http://localhost:${PORT}`);
});
