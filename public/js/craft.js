// Страница «Крафт»: калькулятор, план крупной партии, сканеры крафта и партий.

// --- Калькулятор крафта гира ---
const craftEl = {
  search: document.getElementById('craft-search'),
  categoryFilter: document.getElementById('craft-category-filter'),
  tierFilter: document.getElementById('craft-tier-filter'),
  suggestions: document.getElementById('craft-suggestions'),
  selected: document.getElementById('craft-selected'),
  controls: document.getElementById('craft-controls'),
  enchant: document.getElementById('craft-enchant'),
  quality: document.getElementById('craft-quality'),
  rrr: document.getElementById('craft-rrr'),
  quantity: document.getElementById('craft-quantity'),
  run: document.getElementById('craft-run'),
  result: document.getElementById('craft-result'),
};

let craftSelectedItem = null;

async function initCraft() {
  const res = await fetch('/api/refining-meta');
  const meta = await res.json();
  craftEl.rrr.innerHTML = meta.rrrPresets.map((p) => `<option value="${p.id}">${p.label} (${(p.rrr * 100).toFixed(1)}%)</option>`).join('');
  craftEl.rrr.value = 'city_bonus';

  craftEl.search.addEventListener('input', (e) => renderCraftSuggestions(e.target.value));
  craftEl.categoryFilter.addEventListener('change', () => renderCraftSuggestions(craftEl.search.value));
  craftEl.tierFilter.addEventListener('change', () => renderCraftSuggestions(craftEl.search.value));
  craftEl.run.addEventListener('click', runCraftCalc);
}

function renderCraftSuggestions(query) {
  craftEl.suggestions.innerHTML = '';
  const q = (query || '').toLowerCase();
  const cat = craftEl.categoryFilter.value;
  const tier = craftEl.tierFilter.value;
  if (!q && !cat && !tier) return;

  const matches = ALL_ITEMS.filter((i) => {
    if (i.category !== 'weapon' && i.category !== 'armor' && i.category !== 'cape') return false;
    if (cat && i.category !== cat) return false;
    if (tier && String(i.tier) !== tier) return false;
    if (q && !i.name.toLowerCase().includes(q) && !i.id.toLowerCase().includes(q)) return false;
    return true;
  }).slice(0, 30);

  for (const item of matches) {
    const chip = document.createElement('div');
    chip.className = 'suggestion-item';
    const extra = [item.slot, item.material].filter(Boolean).join(', ');
    const label = extra ? `${item.name} (${extra})` : item.name;
    chip.innerHTML = `<img class="item-icon-sm" src="${iconUrl(item.id, 24)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" /><span>${label}</span>`;
    chip.onclick = () => selectCraftItem(item);
    craftEl.suggestions.appendChild(chip);
  }
}

function fmtNum(n, digits = 0) {
  return n === null || n === undefined ? '—' : n.toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
function fmtDays(n) {
  return n === null || n === undefined ? '—' : `${n.toFixed(1)} дн.`;
}

// Предметы того же семейства (тот же предмет на других тирах): T4_MAIN_SWORD → MAIN_SWORD.
function craftFamilyItems(item) {
  const family = item.id.replace(/^T\d+_/, '');
  return ALL_ITEMS.filter((i) => i.category === item.category && i.id.replace(/^T\d+_/, '') === family && RECIPES_KNOWN(i)).sort((a, b) => a.tier - b.tier);
}
// В каталоге на клиенте рецептов нет — предмет крафтится, если это гир (weapon/armor/cape).
function RECIPES_KNOWN(i) {
  return i.category === 'weapon' || i.category === 'armor' || i.category === 'cape';
}

// keep=true — переключение тира: зачарование и качество сохраняются, результат пересчитывается на месте.
function selectCraftItem(item, keep = false) {
  const prevEnchant = craftEl.enchant.value;
  craftSelectedItem = item;
  craftEl.search.value = '';
  craftEl.suggestions.innerHTML = '';
  const tiers = craftFamilyItems(item);
  const tierSwitch = tiers.length > 1
    ? `<label class="tier-switch">Тир <select id="craft-tier-switch">${tiers.map((t) => `<option value="${t.id}" ${t.id === item.id ? 'selected' : ''}>T${t.tier}</option>`).join('')}</select></label>`
    : '';
  craftEl.selected.innerHTML = `<img src="${iconUrl(item.id, 32)}" alt="" onerror="this.style.visibility='hidden'" /><strong>${item.name}</strong>${tierSwitch}`;
  const sw = document.getElementById('craft-tier-switch');
  if (sw) sw.addEventListener('change', () => switchCraftTier(sw.value));

  const maxE = maxEnchantFor(item);
  const opts = [{ v: 0, l: 'Без зачар.' }, { v: 1, l: 'Зачар. 1' }, { v: 2, l: 'Зачар. 2' }, { v: 3, l: 'Зачар. 3' }, { v: 4, l: 'Зачар. 4' }];
  craftEl.enchant.innerHTML = opts.map((o) => `<option value="${o.v}" ${o.v > maxE ? 'disabled' : ''}>${o.l}</option>`).join('');
  if (keep && Number(prevEnchant) <= maxE) craftEl.enchant.value = prevEnchant;

  craftEl.controls.style.display = 'flex';
  document.getElementById('craft-extra').style.display = 'block';
  if (!keep) craftEl.result.innerHTML = '';
}

// Быстрая смена тира без повторного поиска: тот же предмет на другом тире, зачарование/качество/количество те же.
function switchCraftTier(itemId) {
  const item = findItem(itemId);
  if (!item) return;
  selectCraftItem(item, true);
  runCraftCalc();
}

async function runCraftCalc() {
  if (!craftSelectedItem) return;
  craftEl.result.innerHTML = 'Считаю...';
  try {
    const params = new URLSearchParams({
      item: craftSelectedItem.id, enchant: craftEl.enchant.value, quality: craftEl.quality.value,
      quantity: craftEl.quantity.value || '1', rrr: craftEl.rrr.value, cities: activeCities().join(','),
      premium: premiumParam(),
    });
    params.set('marketShare', document.getElementById('craft-market-share').value);
    params.set('days', document.getElementById('craft-days').value);
    for (const [id, name] of [['craft-ceiling', 'ceiling'], ['craft-sell-low', 'sellLow'], ['craft-sell-high', 'sellHigh']]) {
      const v = document.getElementById(id).value;
      if (v) params.set(name, v);
    }
    if (document.getElementById('craft-teleport').checked) params.set('teleport', 'true');
    if (document.getElementById('craft-enchant-after').checked) params.set('enchantAfterCraft', 'true');
    const threshold = document.getElementById('craft-sell-threshold').value;
    if (threshold) params.set('sellThreshold', threshold);
    const res = await fetch(`/api/craft-calc?${params}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderCraftResult(data);
  } catch (err) {
    craftEl.result.innerHTML = `<span style="color:#ff6b6b">Ошибка: ${err.message}</span>`;
  }
}

function renderCraftResult(data) {
  // Всё, что закупается (сырьё рецепта и материалы зачарования), — в одной таблице материалов; шаги зачарования
  // отдельно описаны в блоке «Зачарование после крафта». Количество материалов зачарования масштабируется на партию.
  const materialRowsData = data.recipe.map((r) => ({ ...r, needed: r.count * data.quantity, enchStep: null }));
  if (data.enchantAfterCraft) {
    for (const st of data.enchantAfterCraft.steps) {
      materialRowsData.push({
        resourceName: st.materialName, resource: st.materialId, enchanted: false, enchStep: st.level,
        needed: st.count * data.quantity, cheapestCity: st.cheapestCity, cheapestPrice: st.cheapestPrice, cityPrices: st.cityPrices,
      });
    }
  }
  const recipeRows = materialRowsData.map((r) => {
    const needed = r.needed;
    const baseName = r.resourceName || r.resource;
    const name = r.enchanted ? `${baseName} <span class="ench-tag">зачар. ${data.enchant}</span>`
      : r.enchStep ? `${baseName} <span class="ench-tag">.${r.enchStep - 1} → .${r.enchStep}</span>` : baseName;
    const missing = r.cheapestPrice === null;
    const subtotal = missing ? null : r.cheapestPrice * needed;
    return `
      <tr>
        <td>${name}</td>
        <td>${needed.toLocaleString('ru-RU')}</td>
        <td class="${missing ? 'missing' : ''}" data-sort-value="${r.cheapestPrice ?? ''}">${missing ? 'нет цены' : cityPricesCell(r.cheapestCity, r.cheapestPrice, r.cityPrices)}</td>
        <td class="${missing ? 'missing' : ''}">${missing ? '—' : subtotal.toLocaleString('ru-RU')}</td>
        <td data-sort-value="${acquireDaysFor(data, r.resource) ?? ''}">${acquireDaysFor(data, r.resource) !== null ? fmtDays(acquireDaysFor(data, r.resource)) : '—'}${data.acquire && data.acquire.bottleneckResource === r.resource ? ' 🐢' : ''}</td>
      </tr>
    `;
  }).join('');

  const warning = !data.hasAllMaterialPrices
    ? `<p class="calc-note" style="color:#cc8844">⚠ По части материалов (например, чертежи/жетоны фракций) нет рыночных цен в выбранных городах — итоговая себестоимость занижена на их стоимость.</p>`
    : '';

  const sellRows = data.sellPrices.map((sp) => {
    const isBest = data.bestSell && sp.city === data.bestSell.city;
    return `<tr class="${isBest ? 'calc-best-row' : ''}"><td>${sp.city}</td><td>${sp.sellMin ?? '—'}</td><td>${sp.buyMax ?? '—'}</td></tr>`;
  }).join('');

  const profitClass = data.profitPerUnit === null ? '' : data.profitPerUnit > 0 ? 'profit-pos' : 'profit-neg';

  craftEl.result.innerHTML = `
    ${warning}
    <div class="table-scroll"><table class="craft-recipe-table">
      <thead><tr><th>Материал</th><th>Нужно всего</th><th>Где дешевле</th><th>Сумма</th><th>Дней на закупку</th></tr></thead>
      <tbody>${recipeRows}</tbody>
    </table></div>
    <details style="margin-top:10px">
      <summary style="cursor:pointer; font-size:13px; color:#9aa0aa">Цены готового предмета по городам</summary>
      <div class="table-scroll"><table class="craft-recipe-table" style="margin-top:6px">
        <thead><tr><th>Город</th><th>Купить</th><th>Продать</th></tr></thead>
        <tbody>${sellRows}</tbody>
      </table></div>
    </details>
    <div class="craft-summary">
      <div class="craft-summary-row"><span>Себестоимость материала / шт (сырое)</span><span>${Math.round(data.materialCostPerUnit).toLocaleString('ru-RU')}</span></div>
      <div class="craft-summary-row"><span>Себестоимость с учётом RRR (${(data.rrrPreset.rrr * 100).toFixed(1)}%) / шт</span><span>${Math.round(data.effectiveCostPerUnit).toLocaleString('ru-RU')}</span></div>
      <div class="craft-summary-row"><span>Продажа в Buy Order: лучшая цена (мгновенно, в чужой ордер на покупку)</span><span>${data.bestSell ? `${data.bestSell.city}: ${data.bestSell.price.toLocaleString('ru-RU')}` : 'нет данных'}</span></div>
      <div class="craft-summary-row"><span>После налога с продажи (${(data.taxRate * 100).toFixed(0)}%)</span><span>${data.netSellPrice !== null ? Math.round(data.netSellPrice).toLocaleString('ru-RU') : '—'}</span></div>
      <div class="craft-summary-row"><span>Профит / шт</span><span class="${profitClass}">${data.profitPerUnit !== null ? Math.round(data.profitPerUnit).toLocaleString('ru-RU') : '—'}</span></div>
      <div class="craft-summary-row"><strong>Итого на ${data.quantity.toLocaleString('ru-RU')} шт</strong><strong class="${profitClass}">${data.totalProfit !== null ? Math.round(data.totalProfit).toLocaleString('ru-RU') : '—'}</strong></div>
    </div>
    ${tierComparisonHtml(data)}
    ${enchantAfterHtml(data)}
    ${patientSellHtml(data)}
    ${teleportHtml(data)}
  `;
  craftEl.result.querySelectorAll('tr.tier-row').forEach((tr) => tr.addEventListener('click', () => switchCraftTier(tr.dataset.itemId)));
  const craftTables = craftEl.result.querySelectorAll('table');
  wireTableSort(craftTables[0], 'craft-recipe');
  wireTableSort(craftTables[1], 'craft-sell');
}


// Цена материала: самая дешёвая — в подписи, клик раскрывает все города (чтобы раскидать терпеливые ордера на закупку
// по нескольким городам и быстрее собрать сырьё).
function cityPricesCell(cheapestCity, cheapestPrice, cityPrices) {
  const main = `${cheapestCity}: ${fmtNum(cheapestPrice)}`;
  if (!cityPrices || cityPrices.length < 2) return main;
  const list = cityPrices.map((c) => `<li>${c.city}: ${fmtNum(c.price)}${c.price > cheapestPrice ? ` <small>(+${((c.price / cheapestPrice - 1) * 100).toFixed(0)}%)</small>` : ''}</li>`).join('');
  return `<details class="city-prices"><summary>${main}</summary><ul>${list}</ul></details>`;
}

// Сравнение по тирам: себестоимость и лучшая цена продажи в Buy Order для каждого тира того же предмета.
function tierComparisonHtml(data) {
  const t = data.tierComparison;
  if (!t || t.length === 0) return '';
  const rows = t.map((r) => {
    const cls = r.profitPerUnit === null ? '' : r.profitPerUnit > 0 ? 'profit-pos' : 'profit-neg';
    return `
      <tr class="tier-row ${r.isCurrent ? 'calc-best-row' : ''}" data-item-id="${r.itemId}" title="Переключить на T${r.tier}">
        <td data-sort-value="${r.tier}">T${r.tier}${r.enchant ? `.${r.enchant}` : ''}${r.enchantCapped && r.tier < 4 ? ' <span class="scan-stale" title="Зачарование доступно только с T4">без чарки</span>' : ''}</td>
        <td>${r.cost !== null ? fmtNum(r.cost) : 'нет цен на материалы'}</td>
        <td data-sort-value="${r.bestQuality ?? ''}">${r.bestQuality ? QUALITY_NAMES[r.bestQuality] : '—'}</td>
        <td>${r.bestSell ? `${r.bestSell.city}: ${fmtNum(r.bestSell.price)}` : 'нет предложений'}</td>
        <td class="${cls}" data-sort-value="${r.profitPerUnit ?? ''}">${r.profitPerUnit !== null ? `${fmtNum(r.profitPerUnit)} (${r.profitPct.toFixed(1)}%)` : '—'}</td>
        <td class="${r.patient && r.patient.profitPerUnit > 0 ? 'profit-pos' : 'profit-neg'}" data-sort-value="${r.patient ? r.patient.profitPerUnit : ''}">${r.patient ? `${fmtNum(r.patient.profitPerUnit)} (${r.patient.profitPct.toFixed(1)}%), ${QUALITY_NAMES[r.patient.quality]}, ${fmtNum(r.patient.avgDailyVolume, 1)}/день` : '—'}</td>
      </tr>`;
  }).join('');
  return `
    <details open class="tier-comparison">
      <summary>Сравнение по тирам (клик по строке — переключить тир; Buy Order — мгновенная продажа в чужой ордер, Sell Order — свой ордер по средней цене истории; качество лучшее по каждому тиру)</summary>
      <div class="table-scroll"><table class="craft-recipe-table">
        <thead><tr><th>Тир</th><th>Себестоимость / шт</th><th>Лучшее качество</th><th>Продать (Buy Order)</th><th>Профит / шт (Buy Order)</th><th>Профит / шт (Sell Order, по истории)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </details>`;
}

// Дней на закупку материала (по истории торгов, с учётом доли рынка); null — нет данных.
function acquireDaysFor(data, resource) {
  const row = data.acquire && data.acquire.byResource.find((a) => a.resource === resource);
  return row && row.daysToAcquire !== null ? row.daysToAcquire : null;
}

// Разбивка продажи через Sell Order по ВСЕМ активным городам: цена, спрос и профит по каждому (порог — лишь фильтр сверху).
// План продажи партии по городам: штуки распределяются пропорционально дневному обороту каждого города
// (в Люмхёрсте 100 в день, в Мартлоке 20 — везём туда 5:1). «Дней здесь» у всех городов сходится в одну цифру —
// она и есть срок распродажи всей партии по плану. При заданном пороге в план входят только города выше порога.
function salePlanByCity(byCity, quantity, marketShare, minPrice) {
  const eligible = byCity.filter((c) => c.avgDailyVolume > 0 && (minPrice === null || c.avgSellPrice >= minPrice));
  const totalVolume = eligible.reduce((sum, c) => sum + c.avgDailyVolume, 0);
  if (eligible.length === 0 || totalVolume <= 0) return { rows: new Map(), totalVolume: 0, days: null };
  const rows = new Map();
  let assigned = 0;
  eligible.forEach((c) => {
    const qty = Math.floor((quantity * c.avgDailyVolume) / totalVolume);
    rows.set(c.city, { qty, days: null });
    assigned += qty;
  });
  // остаток от округления — самому ликвидному городу, чтобы сумма плана совпадала с партией
  const top = eligible.reduce((a, b) => (b.avgDailyVolume > a.avgDailyVolume ? b : a));
  rows.get(top.city).qty += quantity - assigned;
  eligible.forEach((c) => {
    const r = rows.get(c.city);
    r.days = r.qty / (c.avgDailyVolume * marketShare);
  });
  return { rows, totalVolume, days: quantity / (totalVolume * marketShare) };
}

function byCityHtml(p, data) {
  if (!p.byCity || p.byCity.length === 0) return '';
  const minPrice = p.threshold ? p.threshold.value : null;
  const plan = salePlanByCity(p.byCity, data.quantity, p.marketShare ?? 1, minPrice);
  const rows = p.byCity.map((c) => {
    const dim = minPrice !== null && c.avgSellPrice < minPrice;
    const cls = c.profitPerUnit > 0 ? 'profit-pos' : 'profit-neg';
    const pr = plan.rows.get(c.city);
    return `<tr class="${dim ? 'below-threshold' : ''}"><td>${c.city}</td><td>${fmtNum(c.avgSellPrice)}</td><td>${fmtNum(c.avgDailyVolume, 1)}</td><td class="${cls}">${fmtNum(c.profitPerUnit)}</td>
      <td data-sort-value="${pr ? pr.qty : ''}">${pr ? fmtNum(pr.qty) : '—'}</td><td data-sort-value="${pr ? pr.days : ''}">${pr ? fmtDays(pr.days) : '—'}</td></tr>`;
  }).join('');
  return `
    <details open class="by-city">
      <summary>План продажи через Sell Order по городам${minPrice !== null ? ` (серые — ниже порога ${fmtNum(minPrice)}, в план не входят)` : ''}</summary>
      <div class="table-scroll"><table class="craft-recipe-table">
        <thead><tr><th>Город</th><th>Средняя цена</th><th>Сделок в день</th><th>Профит / шт</th><th>Везти сюда, шт</th><th>Дней здесь</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="calc-note">Партия ${fmtNum(data.quantity)} шт делится между городами пропорционально их дневному обороту; при доле рынка ${((p.marketShare ?? 1) * 100).toFixed(0)}% весь план занимает ${fmtDays(plan.days)} — так продаётся партия целиком, а не «по одному лучшему городу».</p>
    </details>`;
}

// Сравнение по качеству: у одной и той же вещи ликвидность разных качеств отличается на порядки.
function qualityComparisonHtml(data) {
  const q = data.qualityComparison;
  if (!q || q.length === 0) return '';
  const best = q.reduce((a, b) => ((b.daysToSellBatch ?? Infinity) < (a.daysToSellBatch ?? Infinity) ? b : a));
  const rows = q.map((r) => {
    const cls = r.profitPerUnit > 0 ? 'profit-pos' : 'profit-neg';
    const slow = r.daysToSellBatch !== null && r.daysToSellBatch > 30;
    return `<tr class="${r.quality === data.quality ? 'calc-best-row' : ''}">
      <td>${QUALITY_NAMES[r.quality]}${r.quality === best.quality ? ' ⚡' : ''}</td>
      <td>${fmtNum(r.avgSellPrice)}</td><td>${fmtNum(r.avgDailyVolume, 1)}</td>
      <td class="${slow ? 'scan-stale' : ''}">${fmtDays(r.daysToSellBatch)}${slow ? ' ⚠' : ''}</td><td class="${cls}">${fmtNum(r.profitPerUnit)}</td></tr>`;
  }).join('');
  return `
    <details open class="quality-comparison">
      <summary>Сравнение по качеству (⚡ — самая быстрая распродажа; выбранное качество выделено)</summary>
      <div class="table-scroll"><table class="craft-recipe-table">
        <thead><tr><th>Качество</th><th>Средняя цена</th><th>Сделок в день</th><th>Дней на распродажу</th><th>Профит / шт</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </details>`;
}

// Порог продажи: все города, где цена Sell Order не ниже порога, — партию можно развезти по нескольким рынкам.
function thresholdHtml(p) {
  const t = p.threshold;
  if (!t) return '';
  if (t.cities.length === 0) {
    return `<div class="craft-summary-row"><span>Города с ценой не ниже ${fmtNum(t.value)}</span><span>нет ни одного</span></div>`;
  }
  const list = t.cities.map((c) => `${c.city}: ${fmtNum(c.avgPrice)} (${fmtNum(c.avgDailyVolume, 1)}/день)`).join('; ');
  const slow = t.daysToSellBatch !== null && t.daysToSellBatch > 30;
  return `
    <div class="craft-summary-row"><span>Города с ценой не ниже ${fmtNum(t.value)}</span><span>${list}</span></div>
    <div class="craft-summary-row"><span>Суммарный спрос: ${fmtNum(t.totalDailyVolume, 1)} в день → дней на распродажу партии</span><span class="${slow ? 'scan-stale' : ''}">${fmtDays(t.daysToSellBatch)}${slow ? ' ⚠' : ''}</span></div>`;
}

// «Зачаровать после крафта»: откуда берём базу .0 и сколько стоят руны/души/реликвии по шагам.
function enchantAfterHtml(data) {
  const e = data.enchantAfterCraft;
  if (!e) return '';
  const base = e.baseSource === 'buy'
    ? `покупка дешевле крафта: ${e.baseBuy.city}, ${fmtNum(e.baseBuy.price)}`
    : `крафт из материалов: ${fmtNum(e.baseCraftCostPerUnit)}`;
  const stepLines = e.steps.map((st) => `
    <div class="craft-summary-row"><span>.${st.level - 1} → .${st.level}: ${st.materialName} × ${fmtNum(st.count * data.quantity)} (${fmtNum(st.count)} на вещь)</span><span>${st.cost !== null ? `${fmtNum(st.cost)} / шт` : 'нет цены'}</span></div>`).join('');
  return `
    <div class="craft-summary enchant-after">
      <div class="craft-summary-row"><strong>Зачарование после крафта: до .${e.targetLevel}</strong><span></span></div>
      ${e.forced ? '<div class="craft-summary-row"><span>Этот плащ в зачарованном виде не крафтится: сначала делается обычный, затем зачаровывается рунами/душами.</span><span></span></div>' : ''}
      ${e.capped ? '<div class="craft-summary-row"><span class="scan-stale">⚠ Зачарование .4 (Awakening) не поддерживается — посчитано до .3</span><span></span></div>' : ''}
      <div class="craft-summary-row"><span>База .0 / шт</span><span>${base}</span></div>
      ${stepLines}
      <div class="craft-summary-row"><span>Зачарование / шт (материалы — в таблице выше)</span><span>${fmtNum(e.stepsCostPerUnit)}</span></div>
      <div class="craft-summary-row"><strong>Итого себестоимость с зачарованием / шт</strong><strong>${fmtNum(data.effectiveCostPerUnit)}</strong></div>
    </div>`;
}

// Логистика по телепорту: где собирать, откуда везти материалы, куда везти готовый предмет и как это меняет профит.
function teleportHtml(data) {
  if (!document.getElementById('craft-teleport').checked) return '';
  const t = data.teleport;
  if (!t) {
    return '<div class="craft-summary teleport-plan"><div class="craft-summary-row"><span>Телепорт</span><span>маршрут посчитать нельзя (нет цен в городах без Каэрлеона)</span></div></div>';
  }
  const legRows = t.materialLegs.map((l) => `
    <tr><td>${l.resourceName}</td><td>${l.fromCity}</td><td>${fmtNum(l.needed)}</td><td>${l.distance === 0 ? 'на месте' : `×${l.distance}`}</td><td>${fmtNum(l.cost)}</td></tr>`).join('');
  const sellLine = (label, opt) => {
    if (!opt) return `<div class="craft-summary-row"><span>${label}</span><span>нет цен</span></div>`;
    const cls = opt.profitPerUnit > 0 ? 'profit-pos' : 'profit-neg';
    return `
      <div class="craft-summary-row"><span>${label}: везём в ${opt.city} (${opt.distance === 0 ? 'на месте' : `×${opt.distance}`}, перевозка ${fmtNum(opt.cost)})</span><span class="${cls}">профит/шт ${fmtNum(opt.profitPerUnit)}</span></div>`;
  };
  return `
    <div class="craft-summary teleport-plan">
      <div class="craft-summary-row"><strong>Логистика (телепорт): собираем в ${t.homeCity}</strong><span></span></div>
      <div class="table-scroll"><table class="craft-recipe-table">
        <thead><tr><th>Материал</th><th>Покупаем в</th><th>Штук</th><th>Дистанция</th><th>Перевозка</th></tr></thead>
        <tbody>${legRows}</tbody>
      </table></div>
      <div class="craft-summary-row"><span>Перевозка материалов, всего</span><span>${fmtNum(t.legsCost)}</span></div>
      <div class="craft-summary-row"><span>Себестоимость с логистикой / шт</span><span>${fmtNum(t.costPerUnit)}</span></div>
      ${sellLine('Продажа через Sell Order', t.patient)}
      ${sellLine('Продажа в Buy Order', t.instant)}
    </div>`;
}

// Потолок себестоимости и полоса цены продажи (бывший «План крупной партии»): проходит ли по потолку, профит в полосе.
function sellPlanHtml(data) {
  const sp = data.sellPlan;
  if (!sp) return '';
  const band = sp.sellLow === null ? '—' : sp.sellLow === sp.sellHigh ? fmtNum(sp.sellLow) : `${fmtNum(sp.sellLow)}—${fmtNum(sp.sellHigh)}`;
  const range = (a, b) => (a === null ? '—' : a === b ? fmtNum(a) : `${fmtNum(a)} … ${fmtNum(b)}`);
  const cls = sp.profitLow !== null && sp.profitLow > 0 ? 'profit-pos' : 'profit-neg';
  return `
      ${sp.ceiling !== null ? `<div class="craft-summary-row"><span>Потолок себестоимости ${fmtNum(sp.ceiling)}: проходит?</span><span class="${sp.withinCeiling ? 'profit-pos' : 'profit-neg'}">${sp.withinCeiling ? 'да' : 'нет'}</span></div>` : ''}
      <div class="craft-summary-row"><span>Профит / шт в полосе продажи ${band} (после налога ${(data.taxRate * 100).toFixed(0)}%)</span><span class="${cls}">${range(sp.profitLow, sp.profitHigh)}</span></div>
      <div class="craft-summary-row"><strong>Итого на партию в этой полосе</strong><strong class="${cls}">${range(sp.totalLow, sp.totalHigh)}</strong></div>`;
}

// Время закупки сырья и весь цикл: закупка (узкое место) + продажа — отдельной графой рядом со временем на продажу.
function cycleRowsHtml(data) {
  const a = data.acquire;
  if (!a || a.days === null) return '';
  const bottleneck = a.byResource.find((r) => r.resource === a.bottleneckResource);
  return `
      <div class="craft-summary-row"><span>Дней на закупку сырья (узкое место: ${bottleneck ? bottleneck.resourceName : '—'}, по доле рынка ${(data.marketShare * 100).toFixed(0)}%)</span><span>${fmtDays(a.days)}</span></div>
      <div class="craft-summary-row"><strong>Весь цикл: закупка + продажа</strong><strong>${a.cycleDays !== null ? fmtDays(a.cycleDays) : '—'}</strong></div>`;
}

// Продажа через Sell Order: свой ордер на продажу по средней цене истории; объём и дни на распродажу защищают
// от «прибыли» на предмете, который не продаётся.
function patientSellHtml(data) {
  const p = data.patientSell;
  if (!p) {
    return '<div class="craft-summary patient-sell"><div class="craft-summary-row"><span>Продажа через Sell Order</span><span>нет истории сделок за период</span></div></div>';
  }
  const cls = p.profitPerUnit > 0 ? 'profit-pos' : 'profit-neg';
  const totalProfit = p.profitPerUnit * data.quantity;
  const slow = p.daysToSellBatch !== null && p.daysToSellBatch > 30;
  return `
    <div class="craft-summary patient-sell">
      <div class="craft-summary-row"><strong>Продажа через Sell Order (свой ордер, история за ${p.days} дн.)</strong><span></span></div>
      <div class="craft-summary-row"><span>Средняя цена сделок за период</span><span>${fmtNum(p.avgSellPrice)}</span></div>
      <div class="craft-summary-row"><span>Лучший город по цене</span><span>${p.bestCity.city}: ${fmtNum(p.bestCity.avgPrice)}</span></div>
      <div class="craft-summary-row"><span>Спрос: сделок в день (по выбранным городам)</span><span>${fmtNum(p.avgDailyVolume, 1)}</span></div>
      <div class="craft-summary-row"><span>Дней на распродажу ${fmtNum(data.quantity)} шт (по доле рынка ${(p.marketShare * 100).toFixed(0)}%: тебе достаётся ~${fmtNum(p.avgDailyVolume * p.marketShare, 1)} из ${fmtNum(p.avgDailyVolume, 1)} сделок в день)</span><span class="${slow ? 'scan-stale' : ''}">${fmtDays(p.daysToSellBatch)}${slow ? ' ⚠' : ''}</span></div>
      ${cycleRowsHtml(data)}
      ${sellPlanHtml(data)}
      <div class="craft-summary-row"><span>После налога с продажи (${(data.taxRate * 100).toFixed(0)}%)</span><span>${fmtNum(p.netSellPrice)}</span></div>
      <div class="craft-summary-row"><span>Профит / шт</span><span class="${cls}">${fmtNum(p.profitPerUnit)}</span></div>
      <div class="craft-summary-row"><strong>Итого на ${fmtNum(data.quantity)} шт</strong><strong class="${cls}">${fmtNum(totalProfit)}</strong></div>
      ${thresholdHtml(p)}
      ${byCityHtml(p, data)}
      ${qualityComparisonHtml(data)}
    </div>`;
}

// --- Сканер выгодности крафта ---
const craftScanBtn = document.getElementById('craft-scan-run');
const craftScanHours = document.getElementById('craft-scan-hours');
const craftScanResult = document.getElementById('craft-scan-result');
craftScanBtn.addEventListener('click', runCraftScan);

async function runCraftScan() {
  craftScanBtn.disabled = true;
  craftScanResult.innerHTML = 'Считаю себестоимость по всем рецептам, это может занять несколько секунд...';
  try {
    const params = new URLSearchParams({ hours: craftScanHours.value, cities: activeCities().join(','), rrr: 'none', premium: premiumParam() });
    const res = await fetch(`/api/craft-opportunities?${params}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderCraftScanResult(data);
  } catch (err) {
    craftScanResult.innerHTML = `<span style="color:#ff6b6b">Ошибка: ${err.message}</span>`;
  } finally {
    craftScanBtn.disabled = false;
  }
}

function renderCraftScanResult(rows) {
  if (rows.length === 0) {
    craftScanResult.innerHTML = '<div class="chart-empty">Ничего не нашлось — либо всё отфильтровано по низкой ликвидности, либо AODP недоступен.</div>';
    return;
  }
  const rowsHtml = rows.map((r) => {
    const item = findItem(r.itemId) || { id: r.itemId, name: r.itemId };
    const volumeText = r.volume === null ? 'не проверено' : `${r.volume} сделок`;
    return `
      <tr>
        <td><img class="item-icon-sm" src="${iconUrl(item.id, 24)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" /> ${item.name}</td>
        <td data-sort-value="${r.quality}">${QUALITY_NAMES[r.quality] || '—'}</td>
        <td>${Math.round(r.cost).toLocaleString('ru-RU')}</td>
        <td>${r.bestSell.city}: ${r.bestSell.price.toLocaleString('ru-RU')}</td>
        <td class="scan-spread-hot">+${Math.round(r.profit).toLocaleString('ru-RU')} (${r.profitPct.toFixed(1)}%)</td>
        <td>${volumeText}</td>
        <td><button class="scan-add-btn" data-id="${item.id}" data-quality="${r.quality}">в калькулятор</button></td>
      </tr>
    `;
  }).join('');

  craftScanResult.innerHTML = `
    <p class="calc-note">Без зачарования. Проверяются все 5 качеств готового предмета — показано лучшее по скору (профит × ликвидность именно этого качества). Профит — после налога с продажи. Объём — по городу продажи за выбранный период, малоликвидное уже отфильтровано. Старые котировки понижают позицию в списке.</p>
    <div class="table-scroll"><table class="scan-table">
      <thead><tr><th>Предмет</th><th>Качество</th><th>Себестоимость/шт</th><th>Продать</th><th>Профит/шт</th><th>Объём</th><th></th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>
  `;
  wireTableSort(craftScanResult.querySelector('table'), 'craft-scan');
  highlightBestRow(craftScanResult.querySelector('table'), rows);
  craftScanResult.querySelectorAll('.scan-add-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = findItem(btn.dataset.id);
      if (item) {
        selectCraftItem(item);
        if (btn.dataset.quality) craftEl.quality.value = btn.dataset.quality; // сразу то качество, которое нашёл скан
        document.getElementById('craft-controls').scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  });
}


// --- Сканер партионных возможностей ---
const bulkScanEl = {
  category: document.getElementById('bulk-scan-category'),
  quantity: document.getElementById('bulk-scan-quantity'),
  days: document.getElementById('bulk-scan-days'),
  run: document.getElementById('bulk-scan-run'),
  result: document.getElementById('bulk-scan-result'),
};
bulkScanEl.run.addEventListener('click', runBulkScan);

async function runBulkScan() {
  bulkScanEl.run.disabled = true;
  bulkScanEl.result.innerHTML = 'Считаю партионную модель по всем рецептам, это может занять несколько секунд...';
  try {
    const params = new URLSearchParams({
      category: bulkScanEl.category.value, quantity: bulkScanEl.quantity.value || '1000', days: bulkScanEl.days.value,
      rrr: craftEl.rrr.value, cities: activeCities().join(','), premium: premiumParam(),
    });
    const res = await fetch(`/api/craft-bulk-opportunities?${params}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderBulkScanResult(data);
  } catch (err) {
    bulkScanEl.result.innerHTML = `<span style="color:#ff6b6b">Ошибка: ${err.message}</span>`;
  } finally {
    bulkScanEl.run.disabled = false;
  }
}

function renderBulkScanResult(rows) {
  if (rows.length === 0) {
    bulkScanEl.result.innerHTML = '<div class="chart-empty">Ничего не нашлось — при партионной модели сейчас нет прибыльных рецептов в выбранных городах.</div>';
    return;
  }
  const rowsHtml = rows.map((r) => {
    const item = findItem(r.itemId) || { id: r.itemId, name: r.itemId };
    const long = r.totalDays > 30;
    return `
      <tr>
        <td><img class="item-icon-sm" src="${iconUrl(item.id, 24)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" /> ${item.name}</td>
        <td>${Math.round(r.cost).toLocaleString('ru-RU')}</td>
        <td data-sort-value="${r.quality}">${QUALITY_NAMES[r.quality] || '—'}</td>
        <td>${r.bestSellCity.city}: ${Math.round(r.bestSellCity.avgPrice).toLocaleString('ru-RU')}</td>
        <td class="scan-spread-hot">+${Math.round(r.profit).toLocaleString('ru-RU')} (${r.profitPct.toFixed(1)}%)</td>
        <td>${itemName(r.bottleneckResource)}</td>
        <td class="${long ? 'scan-stale' : ''}" data-sort-value="${r.totalDays}">${r.totalDays.toFixed(1)} дн.${long ? ' ⚠' : ''}</td>
        <td><button class="scan-add-btn" data-id="${item.id}" data-quantity="${r.quantity}" data-quality="${r.quality}">в калькулятор</button></td>
      </tr>
    `;
  }).join('');

  bulkScanEl.result.innerHTML = `
    <p class="calc-note">Цены — средневзвешенные за период, профит — после налога с продажи. «Дней» — закупка узкого материала + распродажа партии из ${rows[0].quantity.toLocaleString('ru-RU')} шт.</p>
    <div class="table-scroll"><table class="scan-table">
      <thead><tr><th>Предмет</th><th>Себестоимость/шт</th><th>Качество</th><th>Продать</th><th>Профит/шт</th><th>Узкое место</th><th>Дней</th><th></th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>
  `;
  wireTableSort(bulkScanEl.result.querySelector('table'), 'bulk-scan');
  highlightBestRow(bulkScanEl.result.querySelector('table'), rows);
  bulkScanEl.result.querySelectorAll('.scan-add-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = findItem(btn.dataset.id);
      if (!item) return;
      selectCraftItem(item);
      craftEl.quantity.value = btn.dataset.quantity;
      if (btn.dataset.quality) craftEl.quality.value = btn.dataset.quality;
      document.getElementById('craft-controls').scrollIntoView({ behavior: 'smooth', block: 'center' });
      runCraftCalc();
    });
  });
}

// --- Ленивый крафтер ---
const lazyEl = {
  budget: document.getElementById('lazy-budget'),
  share: document.getElementById('lazy-share'),
  sellDays: document.getElementById('lazy-sell-days'),
  strategy: document.getElementById('lazy-strategy'),
  history: document.getElementById('lazy-history'),
  run: document.getElementById('lazy-run'),
  result: document.getElementById('lazy-result'),
};
lazyEl.run.addEventListener('click', runLazyCrafter);

async function runLazyCrafter() {
  lazyEl.run.disabled = true;
  lazyEl.result.innerHTML = 'Подбираю план по истории торгов, это может занять несколько секунд...';
  try {
    const params = new URLSearchParams({
      budget: lazyEl.budget.value || '0', share: lazyEl.share.value || '25', sellDays: lazyEl.sellDays.value || '1',
      strategy: lazyEl.strategy.value, days: lazyEl.history.value, rrr: craftEl.rrr.value,
      cities: activeCities().join(','), premium: premiumParam(),
    });
    const res = await fetch(`/api/lazy-crafter?${params}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderLazyCrafter(data);
  } catch (err) {
    lazyEl.result.innerHTML = `<span style="color:#ff6b6b">Ошибка: ${err.message}</span>`;
  } finally {
    lazyEl.run.disabled = false;
  }
}

function renderLazyCrafter(data) {
  if (data.items.length === 0) {
    lazyEl.result.innerHTML = '<div class="chart-empty">План не получился — при таком бюджете и доле рынка нет прибыльных позиций.</div>';
    return;
  }
  const rows = data.items.map((it) => {
    const item = findItem(it.itemId) || { id: it.itemId, name: it.itemId };
    return `
      <tr>
        <td><img class="item-icon-sm" src="${iconUrl(item.id, 24)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" /> ${item.name}</td>
        <td>${fmtNum(it.qty)}</td>
        <td>${fmtNum(it.costPerUnit)}</td>
        <td>${it.bestSellCity.city}: ${fmtNum(it.bestSellCity.avgPrice)}</td>
        <td class="scan-spread-hot">+${fmtNum(it.profitPerUnit)}</td>
        <td>${fmtNum(it.costUsed)}</td>
        <td class="scan-spread-hot">+${fmtNum(it.profitEarned)}</td>
        <td data-sort-value="${it.daysToAcquireBatch + it.daysToSellBatch}">${fmtDays(it.daysToAcquireBatch)} + ${fmtDays(it.daysToSellBatch)}</td>
        <td>${it.bottleneckResource ? itemName(it.bottleneckResource) : '—'}</td>
      </tr>`;
  }).join('');
  lazyEl.result.innerHTML = `
    <div class="craft-summary">
      <div class="craft-summary-row"><span>Бюджет</span><span>${fmtNum(data.budget)}</span></div>
      <div class="craft-summary-row"><span>Потратим</span><span>${fmtNum(data.spent)} (остаток ${fmtNum(data.remaining)})</span></div>
      <div class="craft-summary-row"><strong>Ожидаемая прибыль</strong><strong class="profit-pos">+${fmtNum(data.totalProfit)} (${data.profitPct.toFixed(1)}%)</strong></div>
      <div class="craft-summary-row"><span>Позиций в плане</span><span>${data.items.length} из ${data.candidates} прибыльных</span></div>
    </div>
    <div class="table-scroll"><table class="scan-table">
      <thead><tr><th>Предмет</th><th>Кол-во</th><th>Себестоимость/шт</th><th>Продать</th><th>Профит/шт</th><th>Потрачено</th><th>Прибыль</th><th>Закупка + продажа</th><th>Узкое место</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  `;
  wireTableSort(lazyEl.result.querySelector('table'), 'lazy');
}

// --- Скан маржи и ликвидности ---
const marginEl = {
  category: document.getElementById('margin-category'),
  enchantMode: document.getElementById('margin-enchant-mode'),
  liquidity: document.getElementById('margin-liquidity'),
  minDaily: document.getElementById('margin-min-daily'),
  days: document.getElementById('margin-days'),
  run: document.getElementById('margin-run'),
  result: document.getElementById('margin-result'),
};
marginEl.run.addEventListener('click', runMarginScan);

async function runMarginScan() {
  marginEl.run.disabled = true;
  marginEl.result.innerHTML = 'Перебираю весь гир × зачарование × качество по истории торгов, это может занять несколько секунд...';
  try {
    const params = new URLSearchParams({
      category: marginEl.category.value, enchantMode: marginEl.enchantMode.value, liquidity: marginEl.liquidity.value,
      minDaily: marginEl.minDaily.value || '0', days: marginEl.days.value, rrr: craftEl.rrr.value,
      marketShare: document.getElementById('margin-market-share').value,
      cities: activeCities().join(','), premium: premiumParam(),
    });
    const res = await fetch(`/api/craft-margin-opportunities?${params}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderMarginScan(data);
  } catch (err) {
    marginEl.result.innerHTML = `<span style="color:#ff6b6b">Ошибка: ${err.message}</span>`;
  } finally {
    marginEl.run.disabled = false;
  }
}

function renderMarginScan(data) {
  if (data.results.length === 0) {
    marginEl.result.innerHTML = '<div class="chart-empty">Ничего не нашлось — нет прибыльных комбинаций с таким оборотом. Попробуй снизить «Оборот от».</div>';
    return;
  }
  const rows = data.results.map((r) => {
    const item = findItem(r.itemId) || { id: r.itemId, name: r.itemId };
    const days = r.premiumDays === null ? '—' : r.premiumDays < 1000 ? fmtNum(r.premiumDays, 0) : '>1000';
    return `
      <tr>
        <td><img class="item-icon-sm" src="${iconUrl(item.id, 24, r.enchant)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" /> ${item.name}${enchantTag(r.enchant)}</td>
        <td data-sort-value="${r.quality}">${QUALITY_NAMES[r.quality]}</td>
        <td>${fmtNum(r.cost)}</td>
        <td>${fmtNum(r.avgSellPrice)}</td>
        <td data-sort-value="${r.dailyVolume}">${fmtNum(r.dailyVolume, 1)}${data.liquidity === 'best' ? '' : ` <small>(${r.sellCities.length} гор.)</small>`}<br><small>тебе ~${fmtNum(r.yourDailyVolume, 1)}</small></td>
        <td class="scan-spread-hot" data-sort-value="${r.profitPerUnit}">+${fmtNum(r.profitPerUnit)} (${r.profitPct.toFixed(0)}%)</td>
        <td data-sort-value="${r.dailyProfit}">${fmtNum(r.dailyProfit)}</td>
        <td data-sort-value="${r.premiumDays ?? ''}" title="28 000 000 ÷ дневной профит с оборота — только шкала масштаба">${days}</td>
        <td><button class="scan-add-btn" data-id="${item.id}" data-enchant="${r.enchant}" data-quality="${r.quality}">в калькулятор</button></td>
      </tr>`;
  }).join('');
  marginEl.result.innerHTML = `
    <p class="calc-note">Просмотрено комбинаций: ${fmtNum(data.scanned)}. Профит — после налога с продажи (${(data.taxRate * 100).toFixed(0)}%), цена — средняя по сделкам за ${data.days} дн.,
      оборот — ${data.liquidity === 'best' ? 'лучший город' : 'сумма по всем выбранным городам'}; доля рынка ${(data.marketShare * 100).toFixed(0)}% (профит в день и «дней на премиум» — по твоей доле, а не по всему обороту). Способ зачарования: ${data.enchantMode === 'after' ? 'после крафта рунами' : 'крафт из зачарованного сырья'}.</p>
    <div class="table-scroll"><table class="scan-table">
      <thead><tr><th>Предмет</th><th>Качество</th><th>Себестоимость</th><th>Ср. цена продажи</th><th>Оборот/день (рынок)</th><th>Профит/шт</th><th>Профит/день (твоя доля)</th><th>Дней на премиум</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  wireTableSort(marginEl.result.querySelector('table'), 'margin-scan');
  highlightBestRow(marginEl.result.querySelector('table'), data.results);
  marginEl.result.querySelectorAll('.scan-add-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = findItem(btn.dataset.id);
      if (!item) return;
      selectCraftItem(item);
      craftEl.enchant.value = btn.dataset.enchant;
      craftEl.quality.value = btn.dataset.quality;
      document.getElementById('craft-enchant-after').checked = data.enchantMode === 'after' && btn.dataset.enchant !== '0';
      document.getElementById('craft-controls').scrollIntoView({ behavior: 'smooth', block: 'center' });
      runCraftCalc();
    });
  });
}

initCraft();
