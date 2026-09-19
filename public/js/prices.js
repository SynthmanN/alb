// Страница «Цены»: поиск и добавление предметов, главная таблица цен по городам, график ликвидности.

let selectedInSearch = new Set();
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
  qualitySelect: document.getElementById('quality-select'),
  enchantSelect: document.getElementById('enchant-select'),
  tableHead: document.getElementById('table-head'),
  tableBody: document.getElementById('table-body'),
  status: document.getElementById('status'),
};

async function init() {
  buildHead();
  await itemsReady;
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
  labelTableCells(el.tableHead.closest('table'));
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

el.addFilteredBtn.addEventListener('click', async () => {
  const matches = ALL_ITEMS.filter(matchesFilters);
  if (matches.length === 0) return;
  if (matches.length > 100) {
    const ok = await confirmDialog(`Это добавит ${matches.length} предметов в таблицу — цены будут грузиться заметно дольше. Продолжить?`);
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

// Города Caerleon/Brecilien меняют набор колонок — перерисовываем таблицу из уже загруженных цен.
document.addEventListener('settingschange', () => {
  buildHead();
  renderTable();
});

init();
