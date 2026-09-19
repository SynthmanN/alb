// Общий код всех страниц: города и премиум, сортировка таблиц, список предметов, иконки, шапка.

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
  syncMobileSortBar(key);
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

// На узком экране строка таблицы превращается в карточку "подпись: значение" (см. style.css) —
// подпись берётся из data-label, который проставляем по заголовку колонки.
function labelTableCells(table) {
  if (!table) return;
  const labels = [...table.querySelectorAll('thead th')].map((th) => sortHeaderLabel(th));
  table.querySelectorAll('tbody > tr:not(.chart-row)').forEach((tr) => {
    [...tr.children].forEach((td, i) => {
      if (labels[i] && !td.hasAttribute('data-label')) td.setAttribute('data-label', labels[i]);
    });
  });
}

// На телефоне заголовки таблицы скрыты (строки — карточки), поэтому клик по <th> недоступен.
// Вместо него над таблицей появляется панель "Сортировка: [колонка] [▼/▲]" (видна только на узком экране).
function buildMobileSortBar(table, key) {
  const labels = [...table.querySelectorAll('thead th')].map((th) => sortHeaderLabel(th)).filter(Boolean);
  if (labels.length === 0) return;
  const anchor = table.closest('.table-scroll') || table;
  let bar = anchor.previousElementSibling;
  if (!(bar && bar.classList.contains('mobile-sort') && bar.dataset.tableKey === key)) {
    bar = document.createElement('div');
    bar.className = 'mobile-sort';
    bar.dataset.tableKey = key;
    anchor.parentNode.insertBefore(bar, anchor);
  }
  bar.innerHTML = `
    <label>Сортировка
      <select class="mobile-sort-col"><option value="">без сортировки</option>${labels.map((l) => `<option value="${l}">${l}</option>`).join('')}</select>
    </label>
    <button type="button" class="mobile-sort-dir" title="Направление сортировки">▼</button>
  `;
  const select = bar.querySelector('select');
  const dirBtn = bar.querySelector('button');
  select.addEventListener('change', () => {
    if (select.value) tableSortStates[key] = { label: select.value, dir: (tableSortStates[key] && tableSortStates[key].dir) || 'desc' };
    else delete tableSortStates[key];
    applyTableSort(table, key);
  });
  dirBtn.addEventListener('click', () => {
    const cur = tableSortStates[key];
    if (!cur) return;
    cur.dir = cur.dir === 'desc' ? 'asc' : 'desc';
    applyTableSort(table, key);
  });
}

function syncMobileSortBar(key) {
  document.querySelectorAll(`.mobile-sort[data-table-key="${key}"]`).forEach((bar) => {
    const state = tableSortStates[key];
    bar.querySelector('select').value = state ? state.label : '';
    bar.querySelector('button').textContent = state && state.dir === 'asc' ? '▲' : '▼';
  });
}

// Подсветка лучшей находки сканера: строка с максимальным скором получает бейдж «★ лучшее».
// rows — данные в том же порядке, что и строки tbody (до сортировки); score должен быть числом.
function highlightBestRow(table, rows) {
  if (!table || !rows || rows.length === 0) return;
  let bestIdx = -1;
  let bestScore = -Infinity;
  rows.forEach((r, i) => {
    if (typeof r.score === 'number' && Number.isFinite(r.score) && r.score > bestScore) { bestScore = r.score; bestIdx = i; }
  });
  const tr = bestIdx === -1 ? null : table.querySelectorAll('tbody > tr')[bestIdx];
  if (!tr) return;
  tr.classList.add('top-find');
  const first = tr.querySelector('td');
  if (first) first.insertAdjacentHTML('beforeend', ' <span class="top-badge" title="Лучшая находка по скору (профит × ликвидность)">★ лучшее</span>');
}

function wireTableSort(table, key) {
  if (!table) return;
  labelTableCells(table);
  buildMobileSortBar(table, key);
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
let tracked = loadTracked();

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

// Качество/зачарование "главной таблицы" — есть только на странице цен; на остальных страницах иконки обычные.
function currentEnchant() {
  const sel = document.getElementById('enchant-select');
  return sel ? parseInt(sel.value, 10) || 0 : 0;
}

function effectiveQualityFor(item) {
  if (item && (item.category === 'weapon' || item.category === 'armor' || item.category === 'cape')) {
    const sel = document.getElementById('quality-select');
    return sel ? parseInt(sel.value, 10) || 1 : 1;
  }
  return 1;
}

function effectiveId(baseId, enchantOverride) {
  const item = findItem(baseId);
  const enchant = enchantOverride !== undefined ? enchantOverride : currentEnchant();
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

// enchantOverride — иконка конкретного зачарования (сканеры показывают .0–.4 как разные позиции)
function iconUrl(baseId, size, enchantOverride) {
  const id = effectiveId(baseId, enchantOverride);
  const item = findItem(baseId);
  const quality = effectiveQualityFor(item);
  return `https://render.albiononline.com/v1/item/${encodeURIComponent(id)}.png?quality=${quality}&size=${size || 40}`;
}

// --- Общая шапка: навигация и панель настроек ---
const SITE_PAGES = [
  { href: 'index.html', label: '💰 Цены' },
  { href: 'scanners.html', label: '📈 Флиппинг' },
  { href: 'craft.html', label: '🛠 Крафт' },
  { href: 'refine.html', label: '⚗️ Рефайн' },
  { href: 'fitting-room.html', label: '👗 Примерочная' },
  { href: 'masteries.html', label: '🎖 Мастерки' },
];

// Метка уровня зачарования рядом с названием: T4 Меч .2
function enchantTag(enchant) {
  return enchant ? ` <span class="ench-tag">.${enchant}</span>` : '';
}

const QUALITY_NAMES = { 1: 'Обычное', 2: 'Хорошее', 3: 'Выдающееся', 4: 'Отличное', 5: 'Шедевр' };

// Стилизованные замены нативным alert()/confirm(): не выбиваются из общего стиля и не блокируют страницу.
function showToast(message, kind = 'info') {
  let box = document.getElementById('toast-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast-box';
    document.body.appendChild(box);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  toast.textContent = message;
  box.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// Возвращает Promise<boolean>: true — «Продолжить», false — «Отмена» (или Esc / клик мимо окна).
function confirmDialog(message, { okText = 'Продолжить', cancelText = 'Отмена' } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true">
        <p></p>
        <div class="dialog-buttons"><button type="button" class="dialog-cancel"></button><button type="button" class="dialog-ok"></button></div>
      </div>`;
    overlay.querySelector('p').textContent = message;
    overlay.querySelector('.dialog-ok').textContent = okText;
    overlay.querySelector('.dialog-cancel').textContent = cancelText;
    const close = (result) => { document.removeEventListener('keydown', onKey); overlay.remove(); resolve(result); };
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    overlay.querySelector('.dialog-ok').addEventListener('click', () => close(true));
    overlay.querySelector('.dialog-cancel').addEventListener('click', () => close(false));
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    overlay.querySelector('.dialog-ok').focus();
  });
}

// Список предметов нужен почти всем страницам — грузим один раз, страницы ждут itemsReady.
const itemsReady = fetch('/api/items').then((r) => r.json()).then((items) => { ALL_ITEMS = items; });

function renderSiteChrome() {
  const holder = document.getElementById('site-chrome');
  if (!holder) return;
  const current = location.pathname.split('/').pop() || 'index.html';
  holder.innerHTML = `
    <nav class="site-nav">
      <a class="site-title" href="index.html">Albion Market Table</a>
      <button class="nav-toggle" id="nav-toggle" type="button" aria-label="Меню">☰</button>
      <div class="nav-links" id="nav-links">
        ${SITE_PAGES.map((p) => `<a href="${p.href}" class="${p.href === current ? 'active' : ''}">${p.label}</a>`).join('')}
      </div>
    </nav>
    <div class="settings-bar">
      <span class="city-toggles">
        <label><input type="checkbox" id="city-caerleon" /> Caerleon</label>
        <label><input type="checkbox" id="city-brecilien" /> Brecilien</label>
      </span>
      <label class="premium-toggle" title="Налог с продажи: 4% с премиумом, 8% без">
        <input type="checkbox" id="premium-toggle" />
        Премиум (налог 4% вместо 8%)
      </label>
    </div>
  `;
  document.getElementById('nav-toggle').addEventListener('click', () => {
    document.getElementById('nav-links').classList.toggle('open');
  });

  // Настройки живут в localStorage, поэтому переживают переход между страницами; страницы,
  // которым важна смена (главная таблица), слушают событие settingschange.
  const caerleon = document.getElementById('city-caerleon');
  const brecilien = document.getElementById('city-brecilien');
  const premiumBox = document.getElementById('premium-toggle');
  caerleon.checked = enabledOptional.has('Caerleon');
  brecilien.checked = enabledOptional.has('Brecilien');
  premiumBox.checked = premium;
  const toggleOptionalCity = (city, checked) => {
    if (checked) enabledOptional.add(city);
    else enabledOptional.delete(city);
    localStorage.setItem('albion_optional_cities', JSON.stringify([...enabledOptional]));
    document.dispatchEvent(new CustomEvent('settingschange'));
  };
  caerleon.addEventListener('change', (e) => toggleOptionalCity('Caerleon', e.target.checked));
  brecilien.addEventListener('change', (e) => toggleOptionalCity('Brecilien', e.target.checked));
  premiumBox.addEventListener('change', (e) => {
    premium = e.target.checked;
    localStorage.setItem('albion_premium', String(premium));
    document.dispatchEvent(new CustomEvent('settingschange'));
  });
}
renderSiteChrome();
