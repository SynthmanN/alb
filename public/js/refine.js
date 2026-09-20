// Страница «Рефайн»: калькулятор переработки (сверху) и скан выгодных переработок (кувшин). Модель одна на обоих (см. server.js, «Рефайн»):
// сырьё и полуфабрикат пред. тира — в самых дешёвых ликвидных городах, переработка — в городе с бонусом (одна ставка возврата),
// продажа — в городе с лучшей чистой ценой; всё своими ордерами. Скан считает одну штуку, количество вводится в калькуляторе.

const fmt = (n, digits = 0) => (n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: digits }));
const fmtDaysAgo = (minutes) => {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 1) return 'только что';
  return minutes < 60 ? `${Math.round(minutes)} мин назад` : `${(minutes / 60).toFixed(1)} ч назад`;
};
const REFINED = { WOOD: 'PLANKS', ORE: 'METALBAR', FIBER: 'CLOTH', HIDE: 'LEATHER', ROCK: 'STONEBLOCK' };
const TIERS = [2, 3, 4, 5, 6, 7, 8];
const refinedId = (type, tier, enchant = 0) => `T${tier}_${REFINED[type]}${enchant ? `_LEVEL${enchant}@${enchant}` : ''}`;
// Максимум зачарования: T2–T3 нет, камень (блоки) не зачаровывается вообще
const maxEnchant = (type, tier) => (tier < 4 || type === 'ROCK' ? 0 : 4);
const enchantOfId = (id) => { const m = String(id).match(/_LEVEL(\d)@\d$/); return m ? Number(m[1]) : 0; };

let refineMeta = null;
let rrrPresets = [];

// --- Ставка возврата: список пресетов + «Своя ставка…» (как в калькуляторе крафта) ---
function fillRrrSelect(select, custom, onChange) {
  select.innerHTML = rrrPresets.map((p) => `<option value="${p.id}">${p.label} — ${(p.rrr * 100).toFixed(1)}%</option>`).join('') + '<option value="custom">Своя ставка…</option>';
  select.value = 'city_bonus';
  select.addEventListener('change', () => { custom.hidden = select.value !== 'custom'; if (!custom.hidden) custom.focus(); onChange(); });
  custom.addEventListener('input', onChange);
}
function rrrParams(select, custom) {
  const own = select.value === 'custom' ? parseFloat(custom.value) : NaN;
  return Number.isFinite(own) ? { refineRrr: 'city_bonus', refineRrrCustom: String(own) } : { refineRrr: select.value === 'custom' ? 'city_bonus' : select.value };
}
function rrrRate(select, custom) {
  const own = select.value === 'custom' ? parseFloat(custom.value) : NaN;
  if (Number.isFinite(own)) return Math.min(Math.max(own, 0), 95) / 100;
  const preset = rrrPresets.find((p) => p.id === select.value) || rrrPresets.find((p) => p.id === 'city_bonus');
  return preset ? preset.rrr : 0;
}

// ============================ Калькулятор ============================
const calcEl = {
  picker: document.getElementById('refine-picker'),
  rrr: document.getElementById('calc-rrr'),
  rrrCustom: document.getElementById('calc-rrr-custom'),
  hours: document.getElementById('calc-hours'),
  quantity: document.getElementById('calc-quantity'),
  result: document.getElementById('calc-result'),
};
let sel = { type: 'ORE', tier: 5, enchant: 0 };
let calcData = null;
const ownBuyPrice = new Map();     // id компонента -> своя цена закупки (за штуку, с комиссией)
const ownSellNet = new Map();      // город -> своя чистая цена продажи (после налога и комиссии)

// --- Пикер полуфабриката: у каждого тира — иконка .0 и рядом кнопки-иконки зачарований .1–.4; тиры без зачарования — в одном свёрнутом блоке ---
function pickerButton(type, tier, enchant, label) {
  const id = refinedId(type, tier, enchant);
  const active = sel.type === type && sel.tier === tier && sel.enchant === enchant;
  return `<button type="button" class="pk-btn ${active ? 'active' : ''} ${enchant ? 'pk-ench' : ''}" data-type="${type}" data-tier="${tier}" data-enchant="${enchant}" title="${itemName(refinedId(type, tier, 0))}${enchant ? ` .${enchant}` : ''}">
    <img src="${iconUrl(id, 64)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" /><span>${label}</span></button>`;
}
function renderPicker() {
  const types = ['WOOD', 'ORE', 'FIBER', 'HIDE'];
  const typeName = (t) => (refineMeta.resourceTypes.find((x) => x.id === t) || {}).name || t;
  const columns = types.map((type) => `
    <div class="pk-col"><h4>${typeName(type)} <small>⭐ ${(refineMeta.resourceTypes.find((x) => x.id === type) || {}).bonusCity || ''}</small></h4>
      ${[4, 5, 6, 7, 8].map((tier) => `<div class="pk-row">${pickerButton(type, tier, 0, `T${tier}`)}${[1, 2, 3, 4].map((e) => pickerButton(type, tier, e, `.${e}`)).join('')}</div>`).join('')}
    </div>`).join('');
  // без зачарования: T2–T3 всех типов и камень целиком
  const plain = ['WOOD', 'ORE', 'FIBER', 'HIDE', 'ROCK'].map((type) => `
    <div class="pk-col"><h4>${typeName(type)}</h4><div class="pk-row">${(type === 'ROCK' ? TIERS : [2, 3]).map((tier) => pickerButton(type, tier, 0, `T${tier}`)).join('')}</div></div>`).join('');
  const plainOpen = sel.enchant === 0 && (sel.type === 'ROCK' || sel.tier < 4);
  calcEl.picker.innerHTML = `<div class="pk-grid">${columns}</div>
    <details class="pk-plain" ${plainOpen ? 'open' : ''}><summary>Без зачарования: T2–T3 и камень</summary><div class="pk-grid">${plain}</div></details>`;
  calcEl.picker.querySelectorAll('.pk-btn').forEach((btn) => btn.addEventListener('click', () => {
    sel = { type: btn.dataset.type, tier: Number(btn.dataset.tier), enchant: Number(btn.dataset.enchant) };
    ownBuyPrice.clear();
    ownSellNet.clear();
    renderPicker();
    runCalc();
  }));
}

async function runCalc() {
  calcEl.result.innerHTML = 'Считаю...';
  try {
    const params = new URLSearchParams({
      type: sel.type, tier: String(sel.tier), enchant: String(sel.enchant), hours: readCustomizable(calcEl.hours),
      ...rrrParams(calcEl.rrr, calcEl.rrrCustom), cities: activeCities().join(','), premium: premiumParam(),
    });
    const data = await fetchJson(`/api/refining-calc?${params}`);
    if (data.error) throw new Error(data.error);
    if (!Array.isArray(data.components)) throw new Error('ответ сервера устарел (нет состава переработки) — сервер не обновлён, перезапусти его после обновления кода');
    calcData = data;
    renderCalc();
  } catch (err) {
    calcData = null;
    calcEl.result.innerHTML = `<span style="color:#ff6b6b">Ошибка: ${err.message}</span>`;
  }
}

// Копируемое название с иконкой
const nameCell = (id, label) => `<span class="copyable" data-copy-id="${id}" title="Клик — скопировать название для поиска в аукционе"><img class="item-icon-sm" src="${iconUrl(id, 64)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" /> ${label || itemName(id.replace(/_LEVEL\d@\d$/, ''))}${enchantOfId(id) ? ` <span class="ench-tag">.${enchantOfId(id)}</span>` : ''}</span>`;

function renderCalc() {
  const d = calcData;
  if (!d) return;
  const qty = Math.max(parseInt(calcEl.quantity.value, 10) || 1, 1);
  const rate = rrrRate(calcEl.rrr, calcEl.rrrCustom);                     // ставка — на месте, без запроса
  const unitOf = (c) => (ownBuyPrice.has(c.id) ? ownBuyPrice.get(c.id) : c.buy ? c.buy.price : null);
  const complete = d.components.every((c) => unitOf(c) !== null);
  const nominal = complete ? d.components.reduce((s, c) => s + c.count * unitOf(c), 0) : null;
  const cost = nominal === null ? null : nominal * (1 - rate);           // себестоимость штуки готового полуфабриката после переработки

  // Продажа по городам: «Цена» — уже чистая (после налога и Setup Fee), её можно править по городу
  const sell = d.sellByCity.map((r) => {
    const own = ownSellNet.has(r.city) ? ownSellNet.get(r.city) : null;
    const net = own !== null ? own : r.netSell;
    return { ...r, net, own: own !== null, profit: net !== null && cost !== null ? net - cost : null };
  });
  let bestProfit = -Infinity;
  for (const r of sell) if (r.profit !== null && r.profit > bestProfit) bestProfit = r.profit;
  const bestRow = sell.find((r) => r.profit === bestProfit);

  const needed = (c) => Math.ceil(qty * c.count * (1 - rate));
  const purchaseTotal = complete ? d.components.reduce((s, c) => s + needed(c) * unitOf(c), 0) : null;

  const sellRows = sell.map((r) => {
    const isBest = r === bestRow && r.profit !== null;
    const cls = r.profit === null ? '' : r.profit > 0 ? 'calc-profit-pos' : 'calc-profit-neg';
    return `<tr class="${isBest ? 'calc-best-row' : ''}">
      <td>${r.city}${isBest ? ' <small>лучшая</small>' : ''}</td>
      <td data-sort-value="${r.net ?? ''}">${r.noData && !r.own ? '<small class="scan-stale">нет данных</small><br>' : ''}<input class="own-sell ${r.own ? 'is-manual' : ''}" type="number" min="0" step="1" data-city="${r.city}" value="${ownSellNet.has(r.city) ? ownSellNet.get(r.city) : (r.net === null ? '' : Math.round(r.net * 100) / 100)}" placeholder="своя цена" title="Чистая цена продажи в этом городе — после налога ${(d.taxRate * 100).toFixed(0)}% и Setup Fee ${(d.setupFeeRate * 100).toFixed(1)}%. Впиши свою — пересчитается на месте" /></td>
      <td data-sort-value="${r.dailyVolume}">${r.noData ? '—' : fmt(r.dailyVolume, 1)}</td>
      <td class="${cls}" data-sort-value="${r.profit ?? ''}">${r.profit === null ? '—' : fmtMoney(r.profit)}</td>
      <td class="${cls}" data-sort-value="${r.profit === null ? '' : r.profit * qty}">${r.profit === null ? '—' : fmt(r.profit * qty)}</td>
    </tr>`;
  }).join('');

  const purchaseRows = d.components.map((c) => {
    const unit = unitOf(c);
    const own = ownBuyPrice.has(c.id);
    const cities = c.buy ? c.buy.cities.map((x) => `<li class="${x.reliable ? '' : 'city-out'}">${x.city}: ${fmt(x.price, x.price < 100 ? 1 : 0)} <small>(${fmt(x.dailyVolume, 0)}/день${x.reliable ? '' : ', тонкий рынок — цену не задаёт'})</small></li>`).join('') : '';
    return `<tr>
      <td>${nameCell(c.id)}<br><small>${c.role === 'raw' ? 'сырьё' : 'полуфабрикат пред. тира'}: ${c.count} на штуку</small></td>
      <td data-sort-value="${needed(c)}">${fmt(needed(c))}<br><small>без возврата ${fmt(qty * c.count)}</small></td>
      <td>${c.buy ? `<details class="city-prices"><summary>${c.buy.city}: ${fmt(c.buy.price, c.buy.price < 100 ? 1 : 0)}</summary><ul>${cities}</ul></details>` : '<span class="missing">нет цен</span>'}</td>
      <td><input class="own-buy ${own ? 'is-manual' : ''}" type="number" min="0" step="0.01" data-id="${c.id}" value="${own ? ownBuyPrice.get(c.id) : ''}" placeholder="${unit === null ? '' : Math.round(unit * 100) / 100}" title="Своя цена закупки за штуку (с комиссией) — пересчитает всё на месте" /></td>
      <td data-sort-value="${unit === null ? '' : needed(c) * unit}">${unit === null ? '—' : fmt(needed(c) * unit)}</td>
    </tr>`;
  }).join('');

  const profitCls = bestProfit > 0 ? 'calc-profit-pos' : 'calc-profit-neg';
  calcEl.result.innerHTML = `
    <div class="refine-head">
      ${nameCell(d.itemId, itemName(refinedId(d.type, d.tier, 0)))}
      <p class="calc-note">Рефайнить в <b>${d.refineCity}</b> ⭐ — город со спец-бонусом ресурса; ставка возврата <b>${(rate * 100).toFixed(1)}%</b>.
        Рецепт: ${d.ratio.raw} × сырьё T${d.tier}${d.ratio.prevRefined ? ` + ${d.ratio.prevRefined} × полуфабрикат T${d.tier - 1}` : ''} → 1 шт. Цены — средние за ${d.hours} ч + Setup Fee 2.5% на закупке.</p>
    </div>
    <div class="craft-scoreboard refine-score">
      <div class="sb-cell sb-cost"><span class="sb-label">Себестоимость / шт после переработки</span><b class="sb-value">${cost === null ? '—' : fmtMoney(cost)}</b><small>${fmt(qty)} шт: ${purchaseTotal === null ? '—' : fmt(purchaseTotal)}</small></div>
      <div class="sb-cell"><span class="sb-label">Лучший город продажи</span><b class="sb-value">${bestRow ? bestRow.city : '—'}</b><small>чистая цена ${bestRow ? fmtMoney(bestRow.net) : '—'}</small></div>
      <div class="sb-cell"><span class="sb-label">Профит / шт · партия ${fmt(qty)} шт</span><b class="sb-value ${profitCls}">${bestRow ? fmtMoney(bestProfit) : '—'}</b><small>${bestRow ? `партии: ${fmt(bestProfit * qty)}` : 'нет продажи'}</small></div>
    </div>
    <h4 class="plan-title">Продажа <small>цена — чистая (после налога и Setup Fee), её можно править по городу</small></h4>
    <div class="table-scroll"><table class="craft-recipe-table" id="refine-sell-table">
      <thead><tr><th>Город продажи</th><th>Цена</th><th>Оборот/день</th><th>Профит/шт</th><th>Профит партии (${fmt(qty)} шт)</th></tr></thead>
      <tbody>${sellRows}</tbody>
    </table></div>
    <h4 class="plan-title">Закупка <small>сколько купить на ${fmt(qty)} шт с учётом возврата ${(rate * 100).toFixed(1)}%</small></h4>
    <div class="table-scroll"><table class="craft-recipe-table" id="refine-buy-table">
      <thead><tr><th>Что покупаем</th><th>Нужно, шт</th><th>Город закупки</th><th>Цена / шт</th><th>Подытог</th></tr></thead>
      <tbody>${purchaseRows}</tbody>
      <tfoot><tr class="materials-total"><td colspan="4">Общая сумма закупки</td><td>${purchaseTotal === null ? '—' : fmt(purchaseTotal)}</td></tr></tfoot>
    </table></div>
    ${ownBuyPrice.size || ownSellNet.size ? '<p><button type="button" id="refine-own-reset">Сбросить свои цены</button></p>' : ''}`;
  wireTableSort(calcEl.result.querySelector('#refine-sell-table'), 'refine-sell');
  bindCalcInputs();
}

// Правка своей цены: значение запоминаем сразу, перерисовку откладываем, фокус возвращаем на то же поле
let ownTimer = null;
function bindCalcInputs() {
  const commit = (inp, selector, apply) => inp.addEventListener('input', () => {
    apply();
    const caret = inp.selectionStart;
    clearTimeout(ownTimer);
    ownTimer = setTimeout(() => {
      renderCalc();
      const again = calcEl.result.querySelector(selector);
      if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch (e) { /* number input */ } }
    }, 350);
  });
  calcEl.result.querySelectorAll('input.own-buy').forEach((inp) => commit(inp, `input.own-buy[data-id="${inp.dataset.id}"]`, () => {
    const v = parseFloat(inp.value);
    if (Number.isFinite(v) && v >= 0) ownBuyPrice.set(inp.dataset.id, v); else ownBuyPrice.delete(inp.dataset.id);
  }));
  calcEl.result.querySelectorAll('input.own-sell').forEach((inp) => commit(inp, `input.own-sell[data-city="${inp.dataset.city}"]`, () => {
    const v = parseFloat(inp.value);
    if (Number.isFinite(v) && v >= 0 && inp.value !== '') ownSellNet.set(inp.dataset.city, v); else ownSellNet.delete(inp.dataset.city);
  }));
  const reset = calcEl.result.querySelector('#refine-own-reset');
  if (reset) reset.addEventListener('click', () => { ownBuyPrice.clear(); ownSellNet.clear(); renderCalc(); });
}

// Клик по названию/иконке — копирует игровое название для поиска в аукционе (+ подсказка про фильтр зачарования)
document.addEventListener('click', (e) => {
  const el = e.target.closest('.copyable[data-copy-id]');
  if (!el || e.target.closest('input, button, a, summary')) return;
  const id = el.dataset.copyId;
  const e2 = enchantOfId(id);
  copyAuctionName(id, e2 > 0 ? [`зачарование ${e2}`] : []);
});

// ============================ Скан ============================
const scanEl = {
  type: document.getElementById('refine-scan-type'),
  tier: document.getElementById('refine-scan-tier'),
  rrr: document.getElementById('refine-scan-rrr'),
  rrrCustom: document.getElementById('refine-scan-rrr-custom'),
  hours: document.getElementById('refine-scan-hours'),
  minDaily: document.getElementById('refine-scan-min-daily'),
  enchanted: document.getElementById('refine-scan-enchanted'),
  run: document.getElementById('refine-scan-run'),
  result: document.getElementById('refine-scan-result'),
};
scanEl.run.addEventListener('click', runScan);

async function runScan() {
  scanEl.run.disabled = true;
  scanEl.result.innerHTML = 'Считаю по данным кувшина: все типы × все тиры...';
  try {
    const params = new URLSearchParams({
      hours: readCustomizable(scanEl.hours), minDaily: scanEl.minDaily.value || '0', enchanted: String(scanEl.enchanted.checked),
      ...rrrParams(scanEl.rrr, scanEl.rrrCustom), cities: activeCities().join(','), premium: premiumParam(),
    });
    if (scanEl.type.value) params.set('type', scanEl.type.value);
    if (scanEl.tier.value) params.set('tier', scanEl.tier.value);
    const data = await fetchJson(`/api/refine-scan?${params}`);
    if (data.error) throw new Error(data.error);
    if (!Array.isArray(data.results)) throw new Error('ответ сервера устарел — сервер не обновлён, перезапусти его после обновления кода');
    renderScan(data);
  } catch (err) {
    scanEl.result.innerHTML = `<span style="color:#ff6b6b">Ошибка: ${err.message}</span>`;
  } finally {
    scanEl.run.disabled = false;
  }
}

function renderScan(data) {
  const jugNote = data.jug && data.jug.lastPricePass ? `Кувшин: цены обновлены ${fmtDaysAgo((Date.now() - data.jug.lastPricePass) / 60000)}.` : 'Кувшин ещё пуст — фоновый краулер только начал работу, подожди пару минут.';
  if (data.results.length === 0) {
    scanEl.result.innerHTML = `<div class="chart-empty">Ничего не нашлось — нет прибыльной переработки с таким оборотом. Попробуй снизить «Оборот от» или расширить окно истории. ${jugNote}</div>`;
    return;
  }
  const rows = data.results.map((r) => {
    const stale = r.freshMinutes !== null && r.freshMinutes > 180;
    const confClass = r.confidence < 0.5 ? 'scan-stale' : r.confidence >= 0.8 ? 'scan-spread-hot' : '';
    return `<tr>
      <td>${nameCell(r.itemId, `T${r.tier} ${itemName(refinedId(r.type, r.tier, 0)).replace(/^T\d\s+/, '')}`)}</td>
      <td data-sort-value="${r.cost}">${fmtMoney(r.cost)}<br><small title="сырьё и пред. тир — самые дешёвые ликвидные города">${r.rawCity}${r.prevCity ? ` + ${r.prevCity}` : ''}</small></td>
      <td data-sort-value="${r.netSell}">${fmtMoney(r.netSell)}<br><small>${r.sellCity}</small></td>
      <td class="scan-spread-hot" data-sort-value="${r.profitPerUnit}">+${fmtMoney(r.profitPerUnit)} (${r.profitPct.toFixed(0)}%)</td>
      <td data-sort-value="${r.dailyVolume}" title="Оборот продукта в городе продажи; по всем городам: ${fmt(r.totalDailyVolume, 0)}">${fmt(r.dailyVolume, 0)}</td>
      <td data-sort-value="${r.rankScore}">${fmt(r.rankScore, 0)}</td>
      <td>${r.refineCity} ⭐</td>
      <td class="${confClass}" data-sort-value="${r.confidence}" title="Цифры стоят на ${r.tradeHours} разных часах торговли (слабое звено — продукт или его сырьё): n / (n + 20)">${Math.round(r.confidence * 100)}%<br><small>${r.tradeHours} ч</small></td>
      <td class="${stale ? 'scan-stale' : ''}" data-sort-value="${r.freshMinutes ?? ''}">${fmtDaysAgo(r.freshMinutes)}${stale ? ' ⚠' : ''}</td>
      <td><button class="scan-add-btn" data-type="${r.type}" data-tier="${r.tier}" data-enchant="${r.enchant}">в калькулятор</button></td>
    </tr>`;
  }).join('');
  scanEl.result.innerHTML = `
    <p class="calc-note">Просмотрено комбинаций: ${fmt(data.scanned)}; в списке — ${fmt(data.results.length)}. Возврат ${(data.refineRate * 100).toFixed(1)}%, окно ${data.hours} ч, налог ${(data.taxRate * 100).toFixed(0)}% + Setup Fee ${(data.setupFeeRate * 100).toFixed(1)}%. ${jugNote}</p>
    <div class="table-scroll"><table class="scan-table">
      <thead><tr><th>Полуфабрикат</th><th>Себестоимость/шт<br><small>где закупать</small></th><th>Чистая цена продажи<br><small>где продавать</small></th><th>Профит/шт</th><th>Оборот/день</th><th title="профит % × log₂(2 + оборот)">Рейтинг</th><th>Где перерабатывать</th><th>Доверие</th><th>Свежесть</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  wireTableSort(scanEl.result.querySelector('table'), 'refine-scan');
  scanEl.result.querySelectorAll('.scan-add-btn').forEach((btn) => btn.addEventListener('click', () => {
    sel = { type: btn.dataset.type, tier: Number(btn.dataset.tier), enchant: Number(btn.dataset.enchant) };   // зачарование переносится вместе с типом и тиром
    ownBuyPrice.clear();
    ownSellNet.clear();
    renderPicker();
    document.getElementById('refine-picker').scrollIntoView({ behavior: 'smooth', block: 'start' });
    runCalc();
  }));
}

// ============================ Запуск ============================
async function initRefine() {
  const [meta] = await Promise.all([fetch('/api/refining-meta').then((r) => r.json()), itemsReady]);
  refineMeta = meta;
  rrrPresets = meta.rrrPresets || [];
  fillRrrSelect(calcEl.rrr, calcEl.rrrCustom, () => { if (calcData) renderCalc(); });         // ставка — на месте
  fillRrrSelect(scanEl.rrr, scanEl.rrrCustom, () => {});
  calcEl.quantity.addEventListener('input', () => { if (calcData) renderCalc(); });            // количество — множитель, на месте
  calcEl.hours.addEventListener('change', runCalc);                                            // окно меняет цены — нужен новый расчёт
  if (calcEl.hours._customInput) calcEl.hours._customInput.addEventListener('change', runCalc);
  scanEl.type.innerHTML = '<option value="">Все типы</option>' + meta.resourceTypes.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
  // Переход с ?type=&tier=&enchant= сразу подставляет и считает; посторонние параметры игнорируются
  const q = new URLSearchParams(window.location.search);
  const type = q.get('type');
  const tier = Number(q.get('tier'));
  const enchant = Number(q.get('enchant')) || 0;
  if (meta.resourceTypes.some((t) => t.id === type) && TIERS.includes(tier) && enchant <= maxEnchant(type, tier)) sel = { type, tier, enchant };
  renderPicker();
  runCalc();
}
initRefine();
