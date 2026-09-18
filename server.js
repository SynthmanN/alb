const express = require('express');
const path = require('path');
const { ITEMS } = require('./data/items');
const { REFINING_RATIOS, RRR_PRESETS, rrrFromBonus, BONUS_CITY } = require('./data/refining');
const RECIPES = require('./data/recipes.json');
const EXTRA_ITEM_NAMES = require('./data/extra-item-names.json');

const GEAR_IDS = new Set(ITEMS.filter((i) => i.category === 'weapon' || i.category === 'armor' || i.category === 'cape').map((i) => i.id));
const ITEM_TIER_BY_ID = new Map(ITEMS.map((i) => [i.id, i.tier]));
const ITEM_NAME_BY_ID = new Map(ITEMS.map((i) => [i.id, i.name]));
function resolveItemName(id) {
  return ITEM_NAME_BY_ID.get(id) || EXTRA_ITEM_NAMES[id] || id;
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

app.listen(PORT, () => {
  console.log(`Albion market table running on http://localhost:${PORT}`);
});
