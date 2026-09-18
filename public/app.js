const ALWAYS_CITIES = ['Fort Sterling', 'Bridgewatch', 'Lymhurst', 'Martlock', 'Thetford'];
const OPTIONAL_CITIES = ['Caerleon', 'Brecilien'];
let enabledOptional = new Set(JSON.parse(localStorage.getItem('albion_optional_cities') || '[]'));

function activeCities() {
  return [...ALWAYS_CITIES, ...OPTIONAL_CITIES.filter((c) => enabledOptional.has(c))];
}

// Премиум-аккаунт меняет налог с продажи (4% вместо 8%) — передаётся во все расчёты прибыли.
let premium = localStorage.getItem('albion_premium') === 'true';
function premiumParam() {
  return premium ? 'true' : 'false';
}

// --- Сортировка таблиц по клику на заголовок ---
// Первый клик — по убыванию (▼), второй — по возрастанию (▲). Работает одинаково во всех таблицах:
// значение ячейки берётся из data-sort-value, иначе из текста (число в начале / после "город:").
const tableSortStates = {}; // ключ таблицы -> { label, dir }

function cellSortValue(td) {
  if (!td) return null;
  if (td.dataset.sortValue !== undefined) {
    if (td.dataset.sortValue === '') return null;
    const n = Number(td.dataset.sortValue);
    return Number.isNaN(n) ? td.dataset.sortValue.toLowerCase() : n;
  }
  const text = td.textContent.trim();
  if (!text || text === '—' || text === 'не проверено' || text === 'нет цены') return null;
  const tail = text.includes(':') ? text.slice(text.lastIndexOf(':') + 1) : text;
  const m = tail.replace(/\s+/g, '').replace(',', '.').match(/^[+-]?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : text.toLowerCase();
}

function compareSortValues(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // пустые всегда внизу, в любом направлении
  if (b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  return a.localeCompare(b, 'ru');
}

function sortHeaderLabel(th) {
  const clone = th.cloneNode(true);
  clone.querySelectorAll('.sort-arrow').forEach((n) => n.remove());
  return clone.textContent.trim();
}

function applyTableSort(table, key) {
  const state = tableSortStates[key];
  const headers = [...table.querySelectorAll('thead th')];
  headers.forEach((th) => th.querySelectorAll('.sort-arrow').forEach((n) => n.remove()));
  if (!state) return;
  const col = headers.findIndex((th) => sortHeaderLabel(th) === state.label);
  if (col === -1) return;

  const tbody = table.querySelector('tbody');
  tbody.querySelectorAll('.chart-row').forEach((r) => r.remove());
  const rows = [...tbody.querySelectorAll(':scope > tr')];
  const sign = state.dir === 'desc' ? -1 : 1;
  const decorated = rows.map((row, i) => ({ row, i, v: cellSortValue(row.children[col]) }));
  decorated.sort((x, y) => {
    if (x.v === null || y.v === null) return compareSortValues(x.v, y.v) || x.i - y.i;
    return sign * compareSortValues(x.v, y.v) || x.i - y.i;
  });
  for (const d of decorated) tbody.appendChild(d.row);

  const arrow = document.createElement('span');
  arrow.className = 'sort-arrow';
  arrow.textContent = state.dir === 'desc' ? ' ▼' : ' ▲';
  headers[col].appendChild(arrow);
}

function wireTableSort(table, key) {
  if (!table) return;
  table.querySelectorAll('thead th').forEach((th) => {
    const label = sortHeaderLabel(th);
    if (!label) return; // колонки-действия без названия не сортируем
    th.classList.add('sortable');
    th.addEventListener('click', () => {
      const cur = tableSortStates[key];
      const dir = cur && cur.label === label && cur.dir === 'desc' ? 'asc' : 'desc';
      tableSortStates[key] = { label, dir };
      applyTableSort(table, key);
    });
  });
  applyTableSort(table, key);
}

const STORAGE_KEY = 'albion_tracked_items';
let ALL_ITEMS = [];
let selectedInSearch = new Set();
let tracked = loadTracked();
let autoRefreshTimer = null;

const el = {
  search: document.getElementById('search'),
  categoryFilter: document.getElementById('category-filter'),
  tierFilter: document.getElementById('tier-filter'),
  suggestions: document.getElementById('suggestions'),
  addBtn: document.getElementById('add-selected'),
  addFilteredBtn: document.getElementById('add-filtered'),
  refreshBtn: document.getElementById('refresh'),
  autoToggle: document.getElementById('auto-refresh-toggle'),
  cityCaerleon: document.getElementById('city-caerleon'),
  cityBrecilien: document.getElementById('city-brecilien'),
  premiumToggle: document.getElementById('premium-toggle'),
  qualitySelect: document.getElementById('quality-select'),
  enchantSelect: document.getElementById('enchant-select'),
  tableHead: document.getElementById('table-head'),
  tableBody: document.getElementById('table-body'),
  status: document.getElementById('status'),
};

function loadTracked() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : ['T4_WOOD', 'T4_PLANKS', 'T5_ORE', 'T5_METALBAR'];
  } catch {
    return [];
  }
}
function saveTracked() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tracked));
}

async function init() {
  buildHead();
  const res = await fetch('/api/items');
  ALL_ITEMS = await res.json();
  renderTable();
  await refreshPrices();
}

function buildHead() {
  el.tableHead.innerHTML = '<th data-sort="name">Предмет</th>';
  for (const city of activeCities()) {
    const th = document.createElement('th');
    th.textContent = city;
    el.tableHead.appendChild(th);
  }
  const spreadTh = document.createElement('th');
  spreadTh.textContent = 'Спред';
  el.tableHead.appendChild(spreadTh);
  el.tableHead.appendChild(document.createElement('th'));
  wireTableSort(el.tableHead.closest('table'), 'main');
}

function findItem(id) {
  return ALL_ITEMS.find((i) => i.id === id);
}
function itemName(id) {
  const found = findItem(id);
  return found ? found.name : id;
}

function maxEnchantFor(item) {
  if (!item) return 0;
  if (item.category === 'weapon' || item.category === 'armor' || item.category === 'cape') {
    return item.tier >= 4 ? 4 : 0;
  }
  if (item.category === 'raw' || item.category === 'refined') {
    if (item.tier < 4) return 0;
    if (item.id.includes('STONEBLOCK')) return 0;
    if (item.id.includes('_ROCK')) return 3;
    return 4;
  }
  return 0;
}

function currentEnchant() {
  return parseInt(el.enchantSelect.value, 10) || 0;
}

function effectiveQualityFor(item) {
  if (item && (item.category === 'weapon' || item.category === 'armor' || item.category === 'cape')) {
    return parseInt(el.qualitySelect.value, 10) || 1;
  }
  return 1;
}

function effectiveId(baseId) {
  const item = findItem(baseId);
  const enchant = currentEnchant();
  if (!item || enchant === 0) return baseId;
  const maxE = maxEnchantFor(item);
  if (enchant > maxE) return baseId;
  if (item.category === 'weapon' || item.category === 'armor' || item.category === 'cape') {
    return `${baseId}@${enchant}`;
  }
  if (item.category === 'raw' || item.category === 'refined') {
    return `${baseId}_LEVEL${enchant}@${enchant}`;
  }
  return baseId;
}

function iconUrl(baseId, size) {
  const id = effectiveId(baseId);
  const item = findItem(baseId);
  const quality = effectiveQualityFor(item);
  return `https://render.albiononline.com/v1/item/${encodeURIComponent(id)}.png?quality=${quality}&size=${size || 40}`;
}

let lastPrices = {};

async function refreshPrices() {
  if (tracked.length === 0) {
    el.status.textContent = 'Список пуст — добавь предметы через поиск сверху.';
    renderTable();
    return;
  }
  el.status.textContent = 'Загрузка цен...';
  try {
    const groups = new Map();
    for (const baseId of tracked) {
      const item = findItem(baseId);
      const quality = effectiveQualityFor(item);
      const queryId = effectiveId(baseId);
      if (!groups.has(quality)) groups.set(quality, []);
      groups.get(quality).push({ queryId, baseId });
    }

    const byItem = {};
    for (const [quality, entries] of groups) {
      const idToBase = new Map(entries.map((e) => [e.queryId, e.baseId]));
      const ids = entries.map((e) => e.queryId);
      const res = await fetch(`/api/prices?items=${encodeURIComponent(ids.join(','))}&quality=${quality}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      for (const rec of data) {
        const baseId = idToBase.get(rec.item_id) || rec.item_id;
        if (!byItem[baseId]) byItem[baseId] = {};
        byItem[baseId][rec.city] = { sellMin: rec.sell_price_min || null, buyMax: rec.buy_price_max || null };
      }
    }
    lastPrices = byItem;
    const enchant = currentEnchant();
    const enchantNote = enchant > 0 ? `, зачар. ${enchant} (где применимо)` : '';
    el.status.textContent = `Обновлено: ${new Date().toLocaleTimeString('ru-RU')} (сервер: Europe${enchantNote})`;
    renderTable();
  } catch (err) {
    el.status.textContent = `Ошибка загрузки: ${err.message}`;
  }
}

function renderTable() {
  el.tableBody.innerHTML = '';
  for (const itemId of tracked) {
    const row = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.className = 'name-cell';
    nameTd.title = itemId;
    nameTd.innerHTML = `<img class="item-icon" src="${iconUrl(itemId, 40)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" /><span>${itemName(itemId)}</span>`;
    row.appendChild(nameTd);

    const cityData = lastPrices[itemId] || {};
    let bestBuy = { city: null, price: Infinity };
    let bestSell = { city: null, price: -Infinity };

    for (const city of activeCities()) {
      const d = cityData[city];
      if (d) {
        if (d.sellMin && d.sellMin < bestBuy.price) bestBuy = { city, price: d.sellMin };
        if (d.buyMax && d.buyMax > bestSell.price) bestSell = { city, price: d.buyMax };
      }
    }

    for (const city of activeCities()) {
      const td = document.createElement('td');
      const d = cityData[city];
      if (!d || (!d.sellMin && !d.buyMax)) {
        td.className = 'cell-empty';
        td.textContent = '—';
      } else {
        const isBestBuy = city === bestBuy.city;
        const isBestSell = city === bestSell.city;
        td.className = isBestBuy ? 'cell-best-buy' : isBestSell ? 'cell-best-sell' : '';
        td.dataset.sortValue = d.sellMin || '';
        td.innerHTML = `
          <span class="cell-min">${d.sellMin ? d.sellMin.toLocaleString('ru-RU') : '—'}</span> /
          <span class="cell-max">${d.buyMax ? d.buyMax.toLocaleString('ru-RU') : '—'}</span>
        `;
      }
      row.appendChild(td);
    }

    const spreadTd = document.createElement('td');
    if (bestSell.price > -Infinity && bestBuy.price < Infinity) {
      const spread = bestSell.price - bestBuy.price;
      spreadTd.textContent = spread.toLocaleString('ru-RU');
      spreadTd.style.color = spread > 0 ? '#7ee787' : '#999';
    } else {
      spreadTd.textContent = '—';
    }
    row.appendChild(spreadTd);

    const actionTd = document.createElement('td');
    const chartBtn = document.createElement('button');
    chartBtn.className = 'chart-btn';
    chartBtn.textContent = '📊';
    chartBtn.title = 'Ликвидность за период';
    chartBtn.onclick = () => toggleChartRow(itemId, row);
    actionTd.appendChild(chartBtn);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '✕';
    removeBtn.onclick = () => {
      tracked = tracked.filter((t) => t !== itemId);
      saveTracked();
      renderTable();
    };
    actionTd.appendChild(removeBtn);
    row.appendChild(actionTd);

    el.tableBody.appendChild(row);
  }
  applyTableSort(el.tableHead.closest('table'), 'main');
}

const chartHoursByItem = {};

function toggleChartRow(itemId, row) {
  const next = row.nextElementSibling;
  if (next && next.classList.contains('chart-row') && next.dataset.forItem === itemId) {
    next.remove();
    return;
  }
  document.querySelectorAll('.chart-row').forEach((el) => el.remove());

  const colCount = row.children.length;
  const chartRow = document.createElement('tr');
  chartRow.className = 'chart-row';
  chartRow.dataset.forItem = itemId;
  const td = document.createElement('td');
  td.colSpan = colCount;

  const hours = chartHoursByItem[itemId] || 24;
  td.innerHTML = `
    <div class="chart-panel">
      <div class="chart-panel-controls">
        Период:
        <select class="chart-hours">
          <option value="3">3ч</option><option value="8">8ч</option>
          <option value="12">12ч</option><option value="24" selected>24ч</option>
        </select>
        <span class="chart-summary-inline"></span>
      </div>
      <div class="chart-body">Загрузка...</div>
    </div>
  `;
  td.querySelector(`.chart-hours option[value="${hours}"]`).selected = true;
  chartRow.appendChild(td);
  row.after(chartRow);

  const select = td.querySelector('.chart-hours');
  const loadFor = (h) => {
    chartHoursByItem[itemId] = h;
    loadChart(itemId, h, td.querySelector('.chart-body'), td.querySelector('.chart-summary-inline'));
  };
  select.addEventListener('change', () => loadFor(parseInt(select.value, 10)));
  loadFor(hours);
}

async function loadChart(itemId, hours, bodyEl, summaryEl) {
  bodyEl.innerHTML = 'Загрузка...';
  summaryEl.textContent = '';
  try {
    const item = findItem(itemId);
    const quality = effectiveQualityFor(item);
    const queryId = effectiveId(itemId);
    const res = await fetch(`/api/history?item=${encodeURIComponent(queryId)}&hours=${hours}&quality=${quality}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderSparkline(data, hours, bodyEl, summaryEl);
  } catch (err) {
    bodyEl.innerHTML = `<span style="color:#ff6b6b">Ошибка: ${err.message}</span>`;
  }
}

function renderSparkline(data, hours, bodyEl, summaryEl) {
  const buckets = {};
  for (const series of data) {
    for (const point of series.data || []) {
      const key = point.timestamp;
      if (!buckets[key]) buckets[key] = { count: 0, priceSum: 0 };
      buckets[key].count += point.item_count;
      buckets[key].priceSum += point.item_count * point.avg_price;
    }
  }
  const now = Date.now();
  const cutoff = now - hours * 3600 * 1000;
  const points = Object.entries(buckets)
    .map(([ts, v]) => ({ ts, time: new Date(ts).getTime(), count: v.count, avgPrice: v.count ? v.priceSum / v.count : 0 }))
    .filter((p) => p.time >= cutoff)
    .sort((a, b) => a.time - b.time);

  if (points.length === 0) {
    bodyEl.innerHTML = '<div class="chart-empty">Нет сделок за этот период — низкая ликвидность.</div>';
    return;
  }

  const totalCount = points.reduce((s, p) => s + p.count, 0);
  const maxCount = Math.max(...points.map((p) => p.count), 1);
  const avgPriceOverall = points.reduce((s, p) => s + p.avgPrice * p.count, 0) / (totalCount || 1);

  summaryEl.textContent = `Сделок: ${totalCount.toLocaleString('ru-RU')} · Средняя цена: ${Math.round(avgPriceOverall).toLocaleString('ru-RU')}`;

  const wrap = document.createElement('div');
  wrap.className = 'sparkline-wrap';

  for (const p of points) {
    const heightPct = Math.max((p.count / maxCount) * 100, 3);
    const bar = document.createElement('div');
    bar.className = p.count === 0 ? 'spark-bar zero' : 'spark-bar';
    bar.style.height = `${heightPct}%`;

    const time = new Date(p.ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const priceText = p.count > 0 ? `${Math.round(p.avgPrice).toLocaleString('ru-RU')} серебра` : 'нет сделок';
    bar.addEventListener('mouseenter', (e) => showBarTooltip(e, time, p.count, priceText));
    bar.addEventListener('mousemove', (e) => moveBarTooltip(e));
    bar.addEventListener('mouseleave', hideBarTooltip);
    wrap.appendChild(bar);
  }

  bodyEl.innerHTML = '';
  bodyEl.appendChild(wrap);
}

let tooltipEl = null;
function getTooltipEl() {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'spark-tooltip';
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}
function showBarTooltip(e, time, count, priceText) {
  const tip = getTooltipEl();
  tip.innerHTML = `<strong>${time}</strong><br>Цена: ${priceText}<br>Сделок: ${count}`;
  tip.style.display = 'block';
  moveBarTooltip(e);
}
function moveBarTooltip(e) {
  const tip = getTooltipEl();
  const offset = 14;
  let left = e.clientX + offset;
  let top = e.clientY + offset;
  if (left + 160 > window.innerWidth) left = e.clientX - 160 - offset;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}
function hideBarTooltip() {
  if (tooltipEl) tooltipEl.style.display = 'none';
}

function matchesFilters(item) {
  const cat = el.categoryFilter.value;
  const tier = el.tierFilter.value;
  if (cat && item.category !== cat) return false;
  if (tier && String(item.tier) !== tier) return false;
  return true;
}

function renderSuggestions(query) {
  el.suggestions.innerHTML = '';
  const q = query.toLowerCase();
  let matches = ALL_ITEMS.filter(matchesFilters);
  if (q) matches = matches.filter((i) => i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q));
  if (!q && !el.categoryFilter.value && !el.tierFilter.value) return;
  matches = matches.slice(0, 30);

  for (const item of matches) {
    const chip = document.createElement('div');
    chip.className = 'suggestion-item' + (selectedInSearch.has(item.id) ? ' selected' : '');
    const extra = [item.slot, item.material].filter(Boolean).join(', ');
    const label = extra ? `${item.name} (${extra})` : item.name;
    chip.innerHTML = `<img class="item-icon-sm" src="${iconUrl(item.id, 24)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" /><span>${label}</span>`;
    chip.onclick = () => {
      if (selectedInSearch.has(item.id)) selectedInSearch.delete(item.id);
      else selectedInSearch.add(item.id);
      renderSuggestions(query);
    };
    el.suggestions.appendChild(chip);
  }
}

el.search.addEventListener('input', (e) => renderSuggestions(e.target.value));
el.categoryFilter.addEventListener('change', () => renderSuggestions(el.search.value));
el.tierFilter.addEventListener('change', () => renderSuggestions(el.search.value));

el.addFilteredBtn.addEventListener('click', () => {
  const matches = ALL_ITEMS.filter(matchesFilters);
  if (matches.length === 0) return;
  if (matches.length > 100) {
    const ok = confirm(`Это добавит ${matches.length} предметов в таблицу — цены будут грузиться заметно дольше. Продолжить?`);
    if (!ok) return;
  }
  for (const item of matches) if (!tracked.includes(item.id)) tracked.push(item.id);
  saveTracked();
  refreshPrices();
});

el.addBtn.addEventListener('click', () => {
  for (const id of selectedInSearch) if (!tracked.includes(id)) tracked.push(id);
  selectedInSearch.clear();
  el.search.value = '';
  el.suggestions.innerHTML = '';
  saveTracked();
  refreshPrices();
});

el.refreshBtn.addEventListener('click', refreshPrices);
el.qualitySelect.addEventListener('change', refreshPrices);
el.enchantSelect.addEventListener('change', refreshPrices);

el.autoToggle.addEventListener('change', (e) => {
  if (e.target.checked) autoRefreshTimer = setInterval(refreshPrices, 5 * 60 * 1000);
  else clearInterval(autoRefreshTimer);
});

el.cityCaerleon.checked = enabledOptional.has('Caerleon');
el.cityBrecilien.checked = enabledOptional.has('Brecilien');
function toggleOptionalCity(city, checked) {
  if (checked) enabledOptional.add(city);
  else enabledOptional.delete(city);
  localStorage.setItem('albion_optional_cities', JSON.stringify([...enabledOptional]));
  buildHead();
  renderTable();
}
el.premiumToggle.checked = premium;
el.premiumToggle.addEventListener('change', (e) => {
  premium = e.target.checked;
  localStorage.setItem('albion_premium', String(premium));
});
el.cityCaerleon.addEventListener('change', (e) => toggleOptionalCity('Caerleon', e.target.checked));
el.cityBrecilien.addEventListener('change', (e) => toggleOptionalCity('Brecilien', e.target.checked));

// --- Калькулятор рефайна ---
const calcEl = {
  type: document.getElementById('calc-type'),
  tier: document.getElementById('calc-tier'),
  enchant: document.getElementById('calc-enchant'),
  rrr: document.getElementById('calc-rrr'),
  run: document.getElementById('calc-run'),
  result: document.getElementById('calc-result'),
};

async function initCalc() {
  const res = await fetch('/api/refining-meta');
  const meta = await res.json();
  calcEl.type.innerHTML = meta.resourceTypes.map((t) => `<option value="${t.id}">${t.name} (бонус: ${t.bonusCity})</option>`).join('');
  calcEl.tier.innerHTML = [2, 3, 4, 5, 6, 7, 8].map((t) => `<option value="${t}">T${t}</option>`).join('');
  calcEl.tier.value = 5;
  calcEl.rrr.innerHTML = meta.rrrPresets.map((p) => `<option value="${p.id}">${p.label} (${(p.rrr * 100).toFixed(1)}%)</option>`).join('');
  calcEl.rrr.value = 'city_bonus';
  calcEl.run.addEventListener('click', runCalc);
}

async function runCalc() {
  calcEl.result.innerHTML = 'Считаю...';
  try {
    const params = new URLSearchParams({
      type: calcEl.type.value, tier: calcEl.tier.value, enchant: calcEl.enchant.value,
      rrr: calcEl.rrr.value, cities: activeCities().join(','), premium: premiumParam(),
    });
    const res = await fetch(`/api/refining-calc?${params}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderCalcResult(data);
  } catch (err) {
    calcEl.result.innerHTML = `<span style="color:#ff6b6b">Ошибка: ${err.message}</span>`;
  }
}

function renderCalcResult(data) {
  const rows = data.perCity.filter((r) => r.baseCost !== null || r.outputSell !== null).sort((a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity));
  let bestProfit = -Infinity;
  for (const r of rows) if (r.profit !== null && r.profit > bestProfit) bestProfit = r.profit;

  const rowsHtml = rows.map((r) => {
    const isBest = r.profit === bestProfit && r.profit > -Infinity;
    const profitClass = r.profit === null ? '' : r.profit > 0 ? 'calc-profit-pos' : 'calc-profit-neg';
    return `
      <tr class="${isBest ? 'calc-best-row' : ''}">
        <td>${r.city}${r.city === data.bonusCity ? ' ⭐' : ''}</td>
        <td>${r.rawPrice ?? '—'}</td>
        <td>${r.prevPrice ?? '—'}</td>
        <td>${r.baseCost ? Math.round(r.baseCost).toLocaleString('ru-RU') : '—'}</td>
        <td>${r.effectiveCost ? Math.round(r.effectiveCost).toLocaleString('ru-RU') : '—'}</td>
        <td>${r.outputSell ?? '—'}</td>
        <td class="${profitClass}">${r.profit !== null ? Math.round(r.profit).toLocaleString('ru-RU') : '—'}</td>
      </tr>
    `;
  }).join('');

  calcEl.result.innerHTML = `
    <p>
      Рецепт: ${data.ratio.raw} × сырьё T${data.tier}
      ${data.ratio.prevRefined ? `+ ${data.ratio.prevRefined} × материал T${data.tier - 1}` : ''}
      → 1 × ${data.itemId}. RRR: ${(data.rrrPreset.rrr * 100).toFixed(1)}% (${data.rrrPreset.label}).
      Профит считается после налога с продажи (${(data.taxRate * 100).toFixed(0)}%).
      ⭐ — город со спец-бонусом переработки этого ресурса.
    </p>
    <table class="calc-table">
      <thead><tr><th>Город</th><th>Сырьё</th><th>Пред. тир</th><th>Себест. (сырое)</th><th>Себест. (с RRR)</th><th>Продажа</th><th>Профит/ед.</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
  wireTableSort(calcEl.result.querySelector('table'), 'refine-calc');
}

// --- Сканер возможностей ---
const scanBtn = document.getElementById('scan-run');
const scanResult = document.getElementById('scan-result');
scanBtn.addEventListener('click', runScan);

async function runScan() {
  scanBtn.disabled = true;
  scanResult.innerHTML = 'Сканирую весь каталог, это может занять несколько секунд...';
  try {
    const res = await fetch(`/api/opportunities?premium=${premiumParam()}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderScanResult(data);
  } catch (err) {
    scanResult.innerHTML = `<span style="color:#ff6b6b">Ошибка: ${err.message}</span>`;
  } finally {
    scanBtn.disabled = false;
  }
}

function renderScanResult(rows) {
  if (rows.length === 0) {
    scanResult.innerHTML = '<div class="chart-empty">Ничего не нашлось — либо всё отфильтровано по низкой ликвидности, либо AODP недоступен.</div>';
    return;
  }
  const rowsHtml = rows.slice(0, 25).map((r) => {
    const item = findItem(r.itemId) || { id: r.itemId, name: r.itemId };
    const stale = r.freshMinutes !== null && r.freshMinutes > 180;
    const freshText = r.freshMinutes === null ? '—' : r.freshMinutes < 60 ? `${r.freshMinutes} мин назад` : `${Math.round(r.freshMinutes / 60)} ч назад`;
    const alreadyTracked = tracked.includes(item.id);
    const volumeText = r.volume24h === null ? 'не проверено' : `${r.volume24h} сделок/24ч`;
    return `
      <tr>
        <td><img class="item-icon-sm" src="${iconUrl(item.id, 24)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" /> ${item.name}</td>
        <td class="scan-spread-hot">${r.spreadPct.toFixed(1)}%</td>
        <td>${r.bestBuy.city}: ${r.bestBuy.price.toLocaleString('ru-RU')}</td>
        <td>${r.bestSell.city}: ${r.bestSell.price.toLocaleString('ru-RU')}</td>
        <td data-sort-value="${r.volume24h ?? ''}">${volumeText}</td>
        <td class="${stale ? 'scan-stale' : ''}" data-sort-value="${r.freshMinutes ?? ''}">${freshText}${stale ? ' ⚠' : ''}</td>
        <td><button class="scan-add-btn" data-id="${item.id}" ${alreadyTracked ? 'disabled' : ''}>${alreadyTracked ? 'в таблице' : '+ добавить'}</button></td>
      </tr>
    `;
  }).join('');

  scanResult.innerHTML = `
    <p class="calc-note">Спред — после налога с продажи (${rows[0] ? (rows[0].taxRate * 100).toFixed(0) : '8'}%). Объём — только по двум городам сделки; меньше 3 сделок за 24ч уже отфильтровано. Старые котировки понижают позицию в списке. ⚠ — данные старше 3 часов.</p>
    <table class="scan-table">
      <thead><tr><th>Предмет</th><th>Спред</th><th>Купить</th><th>Продать</th><th>Объём 24ч</th><th>Свежесть</th><th></th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
  wireTableSort(scanResult.querySelector('table'), 'scan');
  scanResult.querySelectorAll('.scan-add-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (!tracked.includes(id)) { tracked.push(id); saveTracked(); refreshPrices(); }
      btn.disabled = true;
      btn.textContent = 'в таблице';
    });
  });
}

// --- Сканер Black Market ---
const bmScanBtn = document.getElementById('bm-scan-run');
const bmScanResult = document.getElementById('bm-scan-result');
bmScanBtn.addEventListener('click', runBmScan);

async function runBmScan() {
  bmScanBtn.disabled = true;
  bmScanResult.innerHTML = 'Сканирую оружие и броню, это может занять несколько секунд...';
  try {
    const params = new URLSearchParams({ cities: activeCities().join(',') });
    const res = await fetch(`/api/bm-opportunities?${params}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderBmScanResult(data);
  } catch (err) {
    bmScanResult.innerHTML = `<span style="color:#ff6b6b">Ошибка: ${err.message}</span>`;
  } finally {
    bmScanBtn.disabled = false;
  }
}

function renderBmScanResult(rows) {
  if (rows.length === 0) {
    bmScanResult.innerHTML = '<div class="chart-empty">Ничего не нашлось — либо всё отфильтровано по низкой ликвидности на БМ, либо AODP недоступен.</div>';
    return;
  }
  const rowsHtml = rows.slice(0, 25).map((r) => {
    const item = findItem(r.itemId) || { id: r.itemId, name: r.itemId };
    const stale = r.freshMinutes !== null && r.freshMinutes > 180;
    const freshText = r.freshMinutes === null ? '—' : r.freshMinutes < 60 ? `${r.freshMinutes} мин назад` : `${Math.round(r.freshMinutes / 60)} ч назад`;
    const alreadyTracked = tracked.includes(item.id);
    const volumeText = r.bmVolume24h === null ? 'не проверено' : `${r.bmVolume24h} продаж/24ч`;
    return `
      <tr>
        <td><img class="item-icon-sm" src="${iconUrl(item.id, 24)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" /> ${item.name}</td>
        <td class="scan-spread-hot">+${r.profitPct.toFixed(1)}%</td>
        <td>${r.bestBuy.city}: ${r.bestBuy.price.toLocaleString('ru-RU')}</td>
        <td>БМ: ${r.bmPrice.toLocaleString('ru-RU')}</td>
        <td data-sort-value="${r.bmVolume24h ?? ''}">${volumeText}</td>
        <td class="${stale ? 'scan-stale' : ''}" data-sort-value="${r.freshMinutes ?? ''}">${freshText}${stale ? ' ⚠' : ''}</td>
        <td><button class="scan-add-btn" data-id="${item.id}" ${alreadyTracked ? 'disabled' : ''}>${alreadyTracked ? 'в таблице' : '+ добавить'}</button></td>
      </tr>
    `;
  }).join('');

  bmScanResult.innerHTML = `
    <p class="calc-note">Объём считается на Black Market за 24ч — меньше 3 продаж уже отфильтровано. Цена без комиссии (БМ покупает напрямую).</p>
    <table class="scan-table">
      <thead><tr><th>Предмет</th><th>Профит</th><th>Купить</th><th>Продать на БМ</th><th>Объём БМ 24ч</th><th>Свежесть</th><th></th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
  wireTableSort(bmScanResult.querySelector('table'), 'bm-scan');
  bmScanResult.querySelectorAll('.scan-add-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (!tracked.includes(id)) { tracked.push(id); saveTracked(); refreshPrices(); }
      btn.disabled = true;
      btn.textContent = 'в таблице';
    });
  });
}

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
    <table class="craft-recipe-table">
      <thead><tr><th>Материал</th><th>Нужно всего</th><th>Где дешевле</th><th>Сумма</th></tr></thead>
      <tbody>${recipeRows}</tbody>
    </table>
    <details style="margin-top:10px">
      <summary style="cursor:pointer; font-size:13px; color:#9aa0aa">Цены готового предмета по городам</summary>
      <table class="craft-recipe-table" style="margin-top:6px">
        <thead><tr><th>Город</th><th>Купить</th><th>Продать</th></tr></thead>
        <tbody>${sellRows}</tbody>
      </table>
    </details>
    <div class="craft-summary">
      <div class="craft-summary-row"><span>Себестоимость материала / шт (сырое)</span><span>${Math.round(data.materialCostPerUnit).toLocaleString('ru-RU')}</span></div>
      <div class="craft-summary-row"><span>Себестоимость с учётом RRR (${(data.rrrPreset.rrr * 100).toFixed(1)}%) / шт</span><span>${Math.round(data.effectiveCostPerUnit).toLocaleString('ru-RU')}</span></div>
      <div class="craft-summary-row"><span>Лучшая цена продажи</span><span>${data.bestSell ? `${data.bestSell.city}: ${data.bestSell.price.toLocaleString('ru-RU')}` : 'нет данных'}</span></div>
      <div class="craft-summary-row"><span>После налога с продажи (${(data.taxRate * 100).toFixed(0)}%)</span><span>${data.netSellPrice !== null ? Math.round(data.netSellPrice).toLocaleString('ru-RU') : '—'}</span></div>
      <div class="craft-summary-row"><span>Профит / шт</span><span class="${profitClass}">${data.profitPerUnit !== null ? Math.round(data.profitPerUnit).toLocaleString('ru-RU') : '—'}</span></div>
      <div class="craft-summary-row"><strong>Итого на ${data.quantity.toLocaleString('ru-RU')} шт</strong><strong class="${profitClass}">${data.totalProfit !== null ? Math.round(data.totalProfit).toLocaleString('ru-RU') : '—'}</strong></div>
    </div>
  `;
  const craftTables = craftEl.result.querySelectorAll('table');
  wireTableSort(craftTables[0], 'craft-recipe');
  wireTableSort(craftTables[1], 'craft-sell');
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
    <table class="craft-recipe-table">
      <thead><tr><th>Материал</th><th>Нужно (после RRR)</th><th>Где закупать</th><th>Ср. цена</th><th>Объём/день</th><th>Дней на закупку</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
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
        <td>${Math.round(r.cost).toLocaleString('ru-RU')}</td>
        <td>${r.bestSell.city}: ${r.bestSell.price.toLocaleString('ru-RU')}</td>
        <td class="scan-spread-hot">+${Math.round(r.profit).toLocaleString('ru-RU')} (${r.profitPct.toFixed(1)}%)</td>
        <td>${volumeText}</td>
        <td><button class="scan-add-btn" data-id="${item.id}">в калькулятор</button></td>
      </tr>
    `;
  }).join('');

  craftScanResult.innerHTML = `
    <p class="calc-note">Без зачарования, обычное качество. Профит — после налога с продажи. Объём — по городу продажи за выбранный период, малоликвидное уже отфильтровано. Старые котировки понижают позицию в списке.</p>
    <table class="scan-table">
      <thead><tr><th>Предмет</th><th>Себестоимость/шт</th><th>Продать</th><th>Профит/шт</th><th>Объём</th><th></th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
  wireTableSort(craftScanResult.querySelector('table'), 'craft-scan');
  craftScanResult.querySelectorAll('.scan-add-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = findItem(btn.dataset.id);
      if (item) {
        selectCraftItem(item);
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
        <td>${r.bestSellCity.city}: ${Math.round(r.bestSellCity.avgPrice).toLocaleString('ru-RU')}</td>
        <td class="scan-spread-hot">+${Math.round(r.profit).toLocaleString('ru-RU')} (${r.profitPct.toFixed(1)}%)</td>
        <td>${itemName(r.bottleneckResource)}</td>
        <td class="${long ? 'scan-stale' : ''}" data-sort-value="${r.totalDays}">${r.totalDays.toFixed(1)} дн.${long ? ' ⚠' : ''}</td>
        <td><button class="scan-add-btn" data-id="${item.id}" data-quantity="${r.quantity}">в план партии</button></td>
      </tr>
    `;
  }).join('');

  bulkScanEl.result.innerHTML = `
    <p class="calc-note">Цены — средневзвешенные за период, профит — после налога с продажи. «Дней» — закупка узкого материала + распродажа партии из ${rows[0].quantity.toLocaleString('ru-RU')} шт.</p>
    <table class="scan-table">
      <thead><tr><th>Предмет</th><th>Себестоимость/шт</th><th>Продать</th><th>Профит/шт</th><th>Узкое место</th><th>Дней</th><th></th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
  wireTableSort(bulkScanEl.result.querySelector('table'), 'bulk-scan');
  bulkScanEl.result.querySelectorAll('.scan-add-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = findItem(btn.dataset.id);
      if (!item) return;
      selectCraftItem(item);
      bulkEl.quantity.value = btn.dataset.quantity;
      bulkEl.panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
}


// --- Примерочная ---
const FIT_SLOTS = [
  { key: 'weapon', label: 'Оружие', accepts: ['осн. рука', 'двуручное'] },
  { key: 'offhand', label: 'Левая рука', accepts: ['левая рука'] },
  { key: 'head', label: 'Шлем', accepts: ['шлем'] },
  { key: 'chest', label: 'Торс', accepts: ['торс'] },
  { key: 'shoes', label: 'Обувь', accepts: ['обувь'] },
  { key: 'cape', label: 'Плащ', accepts: ['плащ', 'плащ (фракция)'] },
];
const QUALITY_NAMES = { 1: 'Обычное', 2: 'Хорошее', 3: 'Выдающееся', 4: 'Отличное', 5: 'Шедевр' };
const fitState = {}; // слот -> { family, name, iconId, slot }
let fitFamilies = null; // семейство -> { family, name, iconId, slot }

// Семейство предмета — id без тира (T4_MAIN_SWORD -> MAIN_SWORD): один и тот же предмет на всех тирах.
function buildFitFamilies() {
  fitFamilies = new Map();
  for (const item of ALL_ITEMS) {
    if (item.category !== 'weapon' && item.category !== 'armor' && item.category !== 'cape') continue;
    const family = item.id.replace(/^T\d+_/, '');
    const cur = fitFamilies.get(family);
    if (!cur) {
      fitFamilies.set(family, {
        family, slot: item.slot, iconId: item.id, tier: item.tier,
        name: item.name.replace(/^T\d+\s+/, '').replace(/\s*\([^)]*\)\s*$/, ''),
      });
    } else if (Math.abs(item.tier - 4) < Math.abs(cur.tier - 4)) {
      cur.iconId = item.id; cur.tier = item.tier; // иконка — с тира, ближайшего к T4
    }
  }
}

const fitEl = {
  slots: document.getElementById('fit-slots'),
  target: document.getElementById('fit-target'),
  tolMinus: document.getElementById('fit-tol-minus'),
  tolPlus: document.getElementById('fit-tol-plus'),
  variants: document.getElementById('fit-variants'),
  run: document.getElementById('fit-run'),
  result: document.getElementById('fit-result'),
};

function fitWeaponIsTwoHanded() {
  return fitState.weapon && fitState.weapon.slot === 'двуручное';
}

function renderFitSelected(key) {
  const st = fitState[key];
  const box = document.getElementById(`fit-selected-${key}`);
  box.innerHTML = st
    ? `<img src="${iconUrl(st.iconId, 32)}" alt="" onerror="this.style.visibility='hidden'" /><strong>${st.name}</strong>`
    : '<span class="missing">не выбрано</span>';
}

function updateFitOffhandState() {
  const input = document.getElementById('fit-input-offhand');
  const twoHanded = fitWeaponIsTwoHanded();
  input.disabled = twoHanded;
  input.placeholder = twoHanded ? 'двуручное — не нужна' : 'Найди предмет...';
  if (twoHanded) { delete fitState.offhand; renderFitSelected('offhand'); }
}

function renderFitSuggestions(slotDef, query) {
  const box = document.getElementById(`fit-suggestions-${slotDef.key}`);
  box.innerHTML = '';
  const q = (query || '').trim().toLowerCase();
  if (!q) return;
  if (!fitFamilies) buildFitFamilies();
  const matches = [...fitFamilies.values()]
    .filter((f) => slotDef.accepts.includes(f.slot) && (f.name.toLowerCase().includes(q) || f.family.toLowerCase().includes(q)))
    .slice(0, 12);
  for (const f of matches) {
    const chip = document.createElement('div');
    chip.className = 'suggestion-item';
    chip.innerHTML = `<img class="item-icon-sm" src="${iconUrl(f.iconId, 24)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" /><span>${f.name}${f.slot === 'двуручное' ? ' (двуручное)' : ''}</span>`;
    chip.onclick = () => {
      fitState[slotDef.key] = f;
      document.getElementById(`fit-input-${slotDef.key}`).value = '';
      box.innerHTML = '';
      renderFitSelected(slotDef.key);
      if (slotDef.key === 'weapon') updateFitOffhandState();
    };
    box.appendChild(chip);
  }
}

function initFit() {
  fitEl.slots.innerHTML = FIT_SLOTS.map((s) => `
    <div class="fit-slot">
      <div class="fit-slot-label">${s.label}</div>
      <input id="fit-input-${s.key}" type="text" placeholder="Найди предмет..." autocomplete="off" />
      <div id="fit-suggestions-${s.key}" class="suggestions"></div>
      <div id="fit-selected-${s.key}" class="craft-selected"></div>
    </div>
  `).join('');
  for (const s of FIT_SLOTS) {
    renderFitSelected(s.key);
    document.getElementById(`fit-input-${s.key}`).addEventListener('input', (e) => renderFitSuggestions(s, e.target.value));
  }
  fitEl.run.addEventListener('click', runFit);
}

async function runFit() {
  const need = FIT_SLOTS.filter((s) => s.key !== 'offhand' || !fitWeaponIsTwoHanded());
  const missing = need.filter((s) => !fitState[s.key]).map((s) => s.label);
  if (missing.length) {
    fitEl.result.innerHTML = `<span style="color:#ff6b6b">Выбери предмет: ${missing.join(', ')}</span>`;
    return;
  }
  fitEl.run.disabled = true;
  fitEl.result.innerHTML = 'Подбираю комбинации по текущим ценам, это может занять несколько секунд...';
  try {
    const params = new URLSearchParams({
      targetIP: fitEl.target.value, tolMinus: fitEl.tolMinus.value || '0', tolPlus: fitEl.tolPlus.value || '0',
      variants: fitEl.variants.value, cities: activeCities().join(','),
    });
    for (const s of need) params.set(s.key, fitState[s.key].family);
    const res = await fetch(`/api/fitting-room?${params}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderFitResult(data);
  } catch (err) {
    fitEl.result.innerHTML = `<span style="color:#ff6b6b">Ошибка: ${err.message}</span>`;
  } finally {
    fitEl.run.disabled = false;
  }
}

function fitSlotCell(o) {
  if (!o) return '<td data-sort-value="">—</td>';
  const item = findItem(o.itemId) || { id: o.itemId, name: o.itemId };
  const tag = `T${o.tier}.${o.enchant}`;
  return `<td data-sort-value="${o.price}" title="${item.name}"><img class="item-icon-sm" src="${iconUrl(o.itemId, 24)}" alt="" onerror="this.style.visibility='hidden'" /> ${tag} ${QUALITY_NAMES[o.quality]}<br><small>${o.price.toLocaleString('ru-RU')} · ${o.city}</small></td>`;
}

function renderFitResult(data) {
  if (data.unreachable) {
    fitEl.result.innerHTML = `<div class="chart-empty">Цель ${data.targetIP} IP (с допуском вниз ${data.tolMinus}) недостижима с выбранными предметами — максимум ${Math.round(data.maxAchievableIP)} IP.</div>`;
    return;
  }
  if (data.emptyWindow) {
    fitEl.result.innerHTML = `<div class="chart-empty">В окне ${data.targetIP - data.tolMinus}–${data.targetIP + data.tolPlus} IP нет ни одной комбинации по текущим ценам (IP растёт ступенями) — расширь допуск.</div>`;
    return;
  }
  const rowsHtml = data.variants.map((v) => `
    <tr>
      <td class="scan-spread-hot" data-sort-value="${v.totalPrice}">${Math.round(v.totalPrice).toLocaleString('ru-RU')}</td>
      <td data-sort-value="${v.avgIP}">${v.avgIP.toFixed(1)}</td>
      ${fitSlotCell(v.slots.weapon)}${data.twoHanded ? '<td>—</td>' : fitSlotCell(v.slots.offhand)}
      ${fitSlotCell(v.slots.head)}${fitSlotCell(v.slots.chest)}${fitSlotCell(v.slots.shoes)}${fitSlotCell(v.slots.cape)}
    </tr>
  `).join('');
  fitEl.result.innerHTML = `
    <p class="calc-note">Окно поиска ${data.targetIP - data.tolMinus}–${data.targetIP + data.tolPlus} IP. Максимум с выбранными предметами — ${Math.round(data.maxAchievableIP)} IP. Цена — суммарная покупка по самой дешёвой цене в выбранных городах.</p>
    <table class="scan-table">
      <thead><tr><th>Цена</th><th>IP</th><th>Оружие</th><th>Левая рука</th><th>Шлем</th><th>Торс</th><th>Обувь</th><th>Плащ</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
  wireTableSort(fitEl.result.querySelector('table'), 'fit');
}

// --- Сканер выгодности рефайна ---
const refineScanBtn = document.getElementById('refine-scan-run');
const refineScanHours = document.getElementById('refine-scan-hours');
const refineScanRrr = document.getElementById('refine-scan-rrr');
const refineScanResult = document.getElementById('refine-scan-result');

async function initRefineScan() {
  const res = await fetch('/api/refining-meta');
  const meta = await res.json();
  refineScanRrr.innerHTML = meta.rrrPresets.map((p) => `<option value="${p.id}">${p.label} (${(p.rrr * 100).toFixed(1)}%)</option>`).join('');
  refineScanRrr.value = 'city_bonus';
  refineScanBtn.addEventListener('click', runRefineScan);
}

async function runRefineScan() {
  refineScanBtn.disabled = true;
  refineScanResult.innerHTML = 'Считаю по всем 35 комбинациям ресурс×тир...';
  try {
    const params = new URLSearchParams({ hours: refineScanHours.value, rrr: refineScanRrr.value, cities: activeCities().join(','), premium: premiumParam() });
    const res = await fetch(`/api/refining-opportunities?${params}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderRefineScanResult(data);
  } catch (err) {
    refineScanResult.innerHTML = `<span style="color:#ff6b6b">Ошибка: ${err.message}</span>`;
  } finally {
    refineScanBtn.disabled = false;
  }
}

function renderRefineScanResult(rows) {
  if (rows.length === 0) {
    refineScanResult.innerHTML = '<div class="chart-empty">Ничего не нашлось — либо всё отфильтровано по низкой ликвидности, либо AODP недоступен.</div>';
    return;
  }
  const rowsHtml = rows.map((r) => {
    const item = findItem(r.itemId) || { id: r.itemId, name: r.itemId };
    const volumeText = r.volume === null ? 'не проверено' : `${r.volume} сделок`;
    return `
      <tr>
        <td><img class="item-icon-sm" src="${iconUrl(item.id, 24)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" /> ${item.name}</td>
        <td>${Math.round(r.cost).toLocaleString('ru-RU')}</td>
        <td>${r.bestSell.city}: ${r.bestSell.price.toLocaleString('ru-RU')}</td>
        <td class="scan-spread-hot">+${Math.round(r.profit).toLocaleString('ru-RU')} (${r.profitPct.toFixed(1)}%)</td>
        <td>${volumeText}</td>
      </tr>
    `;
  }).join('');
  refineScanResult.innerHTML = `
    <table class="scan-table">
      <thead><tr><th>Материал</th><th>Себестоимость/шт</th><th>Продать</th><th>Профит/шт</th><th>Объём</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
  wireTableSort(refineScanResult.querySelector('table'), 'refine-scan');
}

init();
initCalc();
initCraft();
initRefineScan();
initFit();
