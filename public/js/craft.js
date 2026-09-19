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

function selectCraftItem(item) {
  craftSelectedItem = item;
  craftEl.search.value = '';
  craftEl.suggestions.innerHTML = '';
  craftEl.selected.innerHTML = `<img src="${iconUrl(item.id, 32)}" alt="" onerror="this.style.visibility='hidden'" /><strong>${item.name}</strong>`;

  const maxE = maxEnchantFor(item);
  const opts = [{ v: 0, l: 'Без зачар.' }, { v: 1, l: 'Зачар. 1' }, { v: 2, l: 'Зачар. 2' }, { v: 3, l: 'Зачар. 3' }, { v: 4, l: 'Зачар. 4' }];
  craftEl.enchant.innerHTML = opts.map((o) => `<option value="${o.v}" ${o.v > maxE ? 'disabled' : ''}>${o.l}</option>`).join('');

  craftEl.controls.style.display = 'flex';
  craftEl.result.innerHTML = '';
  bulkEl.panel.style.display = 'block';
  bulkEl.result.innerHTML = '';
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
  const recipeRows = data.recipe.map((r) => {
    const needed = r.count * data.quantity;
    const baseName = r.resourceName || r.resource;
    const name = r.enchanted ? `${baseName} <span class="ench-tag">зачар. ${data.enchant}</span>` : baseName;
    const missing = r.cheapestPrice === null;
    const subtotal = missing ? null : r.cheapestPrice * needed;
    return `
      <tr>
        <td>${name}</td>
        <td>${needed.toLocaleString('ru-RU')}</td>
        <td class="${missing ? 'missing' : ''}">${missing ? 'нет цены' : `${r.cheapestCity}: ${r.cheapestPrice.toLocaleString('ru-RU')}`}</td>
        <td class="${missing ? 'missing' : ''}">${missing ? '—' : subtotal.toLocaleString('ru-RU')}</td>
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
      <thead><tr><th>Материал</th><th>Нужно всего</th><th>Где дешевле</th><th>Сумма</th></tr></thead>
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
      <div class="craft-summary-row"><span>Мгновенная продажа: лучшая цена (в чужой ордер на покупку)</span><span>${data.bestSell ? `${data.bestSell.city}: ${data.bestSell.price.toLocaleString('ru-RU')}` : 'нет данных'}</span></div>
      <div class="craft-summary-row"><span>После налога с продажи (${(data.taxRate * 100).toFixed(0)}%)</span><span>${data.netSellPrice !== null ? Math.round(data.netSellPrice).toLocaleString('ru-RU') : '—'}</span></div>
      <div class="craft-summary-row"><span>Профит / шт</span><span class="${profitClass}">${data.profitPerUnit !== null ? Math.round(data.profitPerUnit).toLocaleString('ru-RU') : '—'}</span></div>
      <div class="craft-summary-row"><strong>Итого на ${data.quantity.toLocaleString('ru-RU')} шт</strong><strong class="${profitClass}">${data.totalProfit !== null ? Math.round(data.totalProfit).toLocaleString('ru-RU') : '—'}</strong></div>
    </div>
    ${enchantAfterHtml(data)}
    ${patientSellHtml(data)}
    ${teleportHtml(data)}
  `;
  const craftTables = craftEl.result.querySelectorAll('table');
  wireTableSort(craftTables[0], 'craft-recipe');
  wireTableSort(craftTables[1], 'craft-sell');
}


// Разбивка терпеливой продажи по ВСЕМ активным городам: цена, спрос и профит по каждому (порог — лишь фильтр сверху).
function byCityHtml(p, data) {
  if (!p.byCity || p.byCity.length === 0) return '';
  const minPrice = p.threshold ? p.threshold.value : null;
  const rows = p.byCity.map((c) => {
    const dim = minPrice !== null && c.avgSellPrice < minPrice;
    const cls = c.profitPerUnit > 0 ? 'profit-pos' : 'profit-neg';
    return `<tr class="${dim ? 'below-threshold' : ''}"><td>${c.city}</td><td>${fmtNum(c.avgSellPrice)}</td><td>${fmtNum(c.avgDailyVolume, 1)}</td><td class="${cls}">${fmtNum(c.profitPerUnit)}</td></tr>`;
  }).join('');
  return `
    <details open class="by-city">
      <summary>Терпеливая продажа по городам${minPrice !== null ? ` (серые — ниже порога ${fmtNum(minPrice)})` : ''}</summary>
      <div class="table-scroll"><table class="craft-recipe-table">
        <thead><tr><th>Город</th><th>Средняя цена</th><th>Сделок в день</th><th>Профит / шт</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
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

// Порог продажи: все города, где терпеливая цена не ниже порога, — партию можно развезти по нескольким рынкам.
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
  const rows = e.steps.map((st) => `
    <tr><td>.${st.level - 1} → .${st.level}</td><td>${st.materialName}</td><td>${fmtNum(st.count)}</td>
    <td>${st.cheapestCity ? `${st.cheapestCity}: ${fmtNum(st.cheapestPrice)}` : 'нет цены'}</td><td>${st.cost !== null ? fmtNum(st.cost) : '—'}</td></tr>`).join('');
  return `
    <div class="craft-summary enchant-after">
      <div class="craft-summary-row"><strong>Зачарование после крафта: до .${e.targetLevel}</strong><span></span></div>
      ${e.capped ? '<div class="craft-summary-row"><span class="scan-stale">⚠ Зачарование .4 (Awakening) не поддерживается — посчитано до .3</span><span></span></div>' : ''}
      <div class="craft-summary-row"><span>База .0 / шт</span><span>${base}</span></div>
      <div class="table-scroll"><table class="craft-recipe-table">
        <thead><tr><th>Шаг</th><th>Материал</th><th>Штук на 1 вещь</th><th>Где дешевле</th><th>Стоимость</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="craft-summary-row"><span>Зачарование / шт</span><span>${fmtNum(e.stepsCostPerUnit)}</span></div>
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
      ${sellLine('Терпеливая продажа', t.patient)}
      ${sellLine('Мгновенная продажа', t.instant)}
    </div>`;
}

// Терпеливая продажа: свой ордер на продажу по средней цене истории; объём и дни на распродажу защищают
// от «прибыли» на предмете, который не продаётся.
function patientSellHtml(data) {
  const p = data.patientSell;
  if (!p) {
    return '<div class="craft-summary patient-sell"><div class="craft-summary-row"><span>Терпеливая продажа</span><span>нет истории сделок за период</span></div></div>';
  }
  const cls = p.profitPerUnit > 0 ? 'profit-pos' : 'profit-neg';
  const totalProfit = p.profitPerUnit * data.quantity;
  const slow = p.daysToSellBatch !== null && p.daysToSellBatch > 30;
  return `
    <div class="craft-summary patient-sell">
      <div class="craft-summary-row"><strong>Терпеливая продажа (свой ордер, история за ${p.days} дн.)</strong><span></span></div>
      <div class="craft-summary-row"><span>Средняя цена сделок за период</span><span>${fmtNum(p.avgSellPrice)}</span></div>
      <div class="craft-summary-row"><span>Лучший город по цене</span><span>${p.bestCity.city}: ${fmtNum(p.bestCity.avgPrice)}</span></div>
      <div class="craft-summary-row"><span>Спрос: сделок в день (по выбранным городам)</span><span>${fmtNum(p.avgDailyVolume, 1)}</span></div>
      <div class="craft-summary-row"><span>Дней на распродажу ${fmtNum(data.quantity)} шт</span><span class="${slow ? 'scan-stale' : ''}">${fmtDays(p.daysToSellBatch)}${slow ? ' ⚠' : ''}</span></div>
      <div class="craft-summary-row"><span>После налога с продажи (${(data.taxRate * 100).toFixed(0)}%)</span><span>${fmtNum(p.netSellPrice)}</span></div>
      <div class="craft-summary-row"><span>Профит / шт</span><span class="${cls}">${fmtNum(p.profitPerUnit)}</span></div>
      <div class="craft-summary-row"><strong>Итого на ${fmtNum(data.quantity)} шт</strong><strong class="${cls}">${fmtNum(totalProfit)}</strong></div>
      ${thresholdHtml(p)}
      ${byCityHtml(p, data)}
      ${qualityComparisonHtml(data)}
    </div>`;
}

// --- План крупной партии ---
const bulkEl = {
  panel: document.getElementById('bulk-panel'),
  quantity: document.getElementById('bulk-quantity'),
  ceiling: document.getElementById('bulk-ceiling'),
  sellLow: document.getElementById('bulk-sell-low'),
  sellHigh: document.getElementById('bulk-sell-high'),
  days: document.getElementById('bulk-days'),
  run: document.getElementById('bulk-run'),
  result: document.getElementById('bulk-result'),
};
bulkEl.run.addEventListener('click', runBulkPlan);

async function runBulkPlan() {
  if (!craftSelectedItem) return;
  bulkEl.result.innerHTML = 'Считаю по истории торгов, это может занять несколько секунд...';
  try {
    const params = new URLSearchParams({
      item: craftSelectedItem.id, enchant: craftEl.enchant.value, quality: craftEl.quality.value,
      quantity: bulkEl.quantity.value || '1', days: bulkEl.days.value, rrr: craftEl.rrr.value,
      cities: activeCities().join(','), premium: premiumParam(),
    });
    if (bulkEl.ceiling.value) params.set('ceiling', bulkEl.ceiling.value);
    if (bulkEl.sellLow.value) params.set('sellLow', bulkEl.sellLow.value);
    if (bulkEl.sellHigh.value) params.set('sellHigh', bulkEl.sellHigh.value);
    const res = await fetch(`/api/craft-bulk-plan?${params}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderBulkPlan(data);
  } catch (err) {
    bulkEl.result.innerHTML = `<span style="color:#ff6b6b">Ошибка: ${err.message}</span>`;
  }
}

function fmtNum(n, digits = 0) {
  return n === null || n === undefined ? '—' : n.toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
function fmtDays(n) {
  return n === null || n === undefined ? '—' : `${n.toFixed(1)} дн.`;
}

function renderBulkPlan(data) {
  const rows = data.recipe.map((r) => {
    const baseName = r.resourceName || r.resource;
    const name = r.enchanted ? `${baseName} <span class="ench-tag">зачар. ${data.enchant}</span>` : baseName;
    const missing = r.avgPrice === null;
    const isBottleneck = r.resource === data.bottleneckResource;
    return `
      <tr class="${isBottleneck ? 'calc-best-row' : ''}">
        <td>${name}${isBottleneck ? ' 🐢' : ''}</td>
        <td>${fmtNum(r.neededAfterRrr)}</td>
        <td class="${missing ? 'missing' : ''}">${missing ? 'нет торгов' : r.sourceCity}</td>
        <td class="${missing ? 'missing' : ''}">${fmtNum(r.avgPrice)}</td>
        <td>${fmtNum(r.avgDailyVolume, 1)}</td>
        <td>${fmtNum(r.daysToAcquire, 1)}</td>
      </tr>
    `;
  }).join('');

  const warning = !data.hasAllMaterialPrices
    ? `<p class="calc-note" style="color:#cc8844">⚠ По части материалов за выбранный период не было торгов в выбранных городах — план по ним посчитать нельзя.</p>`
    : '';
  const bottleneck = data.recipe.find((r) => r.resource === data.bottleneckResource);
  const ceilingRow = data.costCeiling !== null
    ? `<div class="craft-summary-row"><span>Потолок себестоимости</span><span>${fmtNum(data.costCeiling)}</span></div>
       <div class="craft-summary-row"><span>Проходит по потолку?</span><span class="${data.withinCeiling ? 'profit-pos' : 'profit-neg'}">${data.withinCeiling ? 'да' : 'нет'}</span></div>`
    : '';
  const bandText = data.sellLow === data.sellHigh
    ? fmtNum(data.sellLow)
    : `${fmtNum(data.sellLow)}—${fmtNum(data.sellHigh)}`;
  const profitText = data.profitPerUnitLow === data.profitPerUnitHigh
    ? fmtNum(data.profitPerUnitLow)
    : `${fmtNum(data.profitPerUnitLow)} … ${fmtNum(data.profitPerUnitHigh)}`;
  const totalText = data.totalProfitLow === data.totalProfitHigh
    ? fmtNum(data.totalProfitLow)
    : `${fmtNum(data.totalProfitLow)} … ${fmtNum(data.totalProfitHigh)}`;
  const profitClass = data.profitPerUnitLow === null ? '' : data.profitPerUnitLow > 0 ? 'profit-pos' : 'profit-neg';

  bulkEl.result.innerHTML = `
    ${warning}
    <div class="table-scroll"><table class="craft-recipe-table">
      <thead><tr><th>Материал</th><th>Нужно (после RRR)</th><th>Где закупать</th><th>Ср. цена</th><th>Объём/день</th><th>Дней на закупку</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="craft-summary">
      <div class="craft-summary-row"><span>Себестоимость/шт (по средней цене за период)</span><span>${fmtNum(data.effectiveCostPerUnit)}</span></div>
      ${ceilingRow}
      <div class="craft-summary-row"><span>Узкое место закупки</span><span>${bottleneck ? bottleneck.resourceName : '—'}</span></div>
      <div class="craft-summary-row"><span>Дней на закупку партии из ${fmtNum(data.quantity)} шт</span><span>${fmtNum(data.daysToAcquireBatch, 1)}</span></div>
      <div class="craft-summary-row"><span>Рыночная цена продажи (средняя за период)</span><span>${fmtNum(data.marketAvgSellPrice)}</span></div>
      <div class="craft-summary-row"><span>Спрос/день на готовый предмет</span><span>${fmtNum(data.avgDailySellVolume, 1)}</span></div>
      <div class="craft-summary-row"><span>Дней на распродажу партии</span><span>${fmtNum(data.daysToSellBatch, 1)}</span></div>
      <div class="craft-summary-row"><span>Профит/шт в полосе продажи ${bandText} (за вычетом налога ${(data.taxRate * 100).toFixed(0)}%)</span><span class="${profitClass}">${profitText}</span></div>
      <div class="craft-summary-row"><strong>Итого профит на партию</strong><strong class="${profitClass}">${totalText}</strong></div>
      <div class="craft-summary-row"><span>Весь цикл (закупка + продажа)</span><span>${fmtDays(data.totalDaysEstimate)}</span></div>
    </div>
  `;
  wireTableSort(bulkEl.result.querySelector('table'), 'bulk-recipe');
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
        <td><button class="scan-add-btn" data-id="${item.id}" data-quantity="${r.quantity}" data-quality="${r.quality}">в план партии</button></td>
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
  bulkScanEl.result.querySelectorAll('.scan-add-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = findItem(btn.dataset.id);
      if (!item) return;
      selectCraftItem(item);
      bulkEl.quantity.value = btn.dataset.quantity;
      if (btn.dataset.quality) craftEl.quality.value = btn.dataset.quality;
      bulkEl.panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

initCraft();
