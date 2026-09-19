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
  royalBonus: document.getElementById('craft-royal-bonus'),
  focus: document.getElementById('craft-focus'),
  quantity: document.getElementById('craft-quantity'),
  run: document.getElementById('craft-run'),
  result: document.getElementById('craft-result'),
};

let craftSelectedItem = null;
let lastCraftData = null;          // последний результат калькулятора — для пересчёта плана продажи без запроса к серверу
const manualSalePlan = new Map();  // город -> штук, введённых вручную в плане продажи (сбрасывается при новом расчёте)
const saleCityToggles = new Map(); // город -> true/false: включён/выключен в плане чекбоксом (пусто — автоплан)
let saleStrategy = 'even';         // стратегия распределения партии: 'even' — равный срок продажи, 'profit' — баланс маржи и скорости
const PROFIT_STRATEGY_HORIZON = 1.5; // «в пределах разумного»: при стратегии «профит» город может держать партию до 1.5× срока равномерного плана

async function initCraft() {
  const res = await fetch('/api/refining-meta');
  const meta = await res.json();

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
      quantity: craftEl.quantity.value || '1', royalBonus: String(craftEl.royalBonus.checked), focus: String(craftEl.focus.checked), cities: activeCities().join(','),
      premium: premiumParam(),
    });
    params.set('marketShare', readCustomizable(document.getElementById('craft-market-share')));
    params.set('priceTolerance', document.getElementById('craft-price-tolerance').value || '2');
    params.set('days', readCustomizable(document.getElementById('craft-days')));
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
    manualSalePlan.clear();
    saleCityToggles.clear();
    lastCraftData = data;
    renderCraftResult(data);
  } catch (err) {
    craftEl.result.innerHTML = `<span style="color:#ff6b6b">Ошибка: ${err.message}</span>`;
  }
}

function renderCraftResult(data) {
  // Всё, что закупается (сырьё рецепта и материалы зачарования), — в одной таблице материалов; шаги зачарования
  // отдельно описаны в блоке «Зачарование после крафта». Количество материалов зачарования масштабируется на партию.
  // Количество к закупке — уже с учётом возврата (RRR): остаток после крафта не нужен; невозвращаемое (герб, жетоны, базовый плащ) — по рецепту.
  const materialRowsData = data.recipe.map((r) => ({ ...r, needed: r.neededToBuy ?? r.count * data.quantity, byRecipe: r.count * data.quantity, enchStep: null }));
  if (data.enchantAfterCraft) {
    for (const st of data.enchantAfterCraft.steps) {
      materialRowsData.push({
        resourceName: st.materialName, resource: st.materialId, enchanted: false, enchStep: st.level,
        needed: st.count * data.quantity, byRecipe: st.count * data.quantity, returnable: false,
        cheapestCity: st.cheapestCity, cheapestPrice: st.cheapestPrice, cityPrices: st.cityPrices,
      });
    }
  }
  const materialsTotal = materialRowsData.reduce((sum, r) => sum + (r.cheapestPrice === null ? 0 : r.cheapestPrice * r.needed), 0);
  const recipeRows = materialRowsData.map((r) => {
    const needed = r.needed;
    const baseName = r.resourceName || r.resource;
    const name = r.enchanted ? `${baseName} <span class="ench-tag">зачар. ${data.enchant}</span>`
      : r.enchStep ? `${baseName} <span class="ench-tag">.${r.enchStep - 1} → .${r.enchStep}</span>` : baseName;
    const missing = r.cheapestPrice === null;
    const subtotal = missing ? null : r.cheapestPrice * needed;
    return `
      <tr>
        <td>${name}${r.returnable === false && !r.enchStep ? ' <span class="no-return" title="Этот материал при крафте не возвращается — RRR на него не действует">без возврата</span>' : r.rrr > 0 ? `<br><small title="Ставка возврата в городе покупки для этого материала">возврат ${(r.rrr * 100).toFixed(1)}%</small>` : ''}</td>
        <td>${needed.toLocaleString('ru-RU')}${r.byRecipe !== undefined && r.byRecipe !== needed ? `<br><small>по рецепту ${r.byRecipe.toLocaleString('ru-RU')}</small>` : ''}</td>
        <td class="${missing ? 'missing' : ''}" data-sort-value="${r.cheapestPrice ?? ''}">${missing ? 'нет цены' : cityPricesCell(r.cheapestCity, r.cheapestPrice, r.cityPrices)}</td>
        <td class="${missing ? 'missing' : ''}">${missing ? '—' : subtotal.toLocaleString('ru-RU')}</td>
        <td data-sort-value="${acquireDaysFor(data, r.resource) ?? ''}">${acquireDaysFor(data, r.resource) !== null ? fmtDays(acquireDaysFor(data, r.resource)) : '—'}${data.acquire && data.acquire.bottleneckResource === r.resource ? ' 🐢' : ''}${acquirePlanHtml(data, r.resource)}</td>
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
      <tfoot><tr class="materials-total"><td colspan="3">Итого материалы к закупке (с учётом возврата)</td><td>${fmtNum(materialsTotal)}</td><td></td></tr></tfoot>
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
      <div class="craft-summary-row"><span title="${data.rrrPreset.label}; у каждого материала своя ставка (см. таблицу материалов)">Себестоимость с учётом RRR (в среднем ${(data.rrrPreset.rrr * 100).toFixed(1)}%) / шт</span><span>${Math.round(data.effectiveCostPerUnit).toLocaleString('ru-RU')}</span></div>
      <div class="craft-summary-row"><span>Продажа в Buy Order: лучшая цена (мгновенно, в чужой ордер на покупку)</span><span>${data.bestSell ? `${data.bestSell.city}: ${data.bestSell.price.toLocaleString('ru-RU')}` : 'нет данных'}</span></div>
      <div class="craft-summary-row"><span>После налога с продажи (${(data.taxRate * 100).toFixed(0)}%)</span><span>${data.netSellPrice !== null ? Math.round(data.netSellPrice).toLocaleString('ru-RU') : '—'}</span></div>
      <div class="craft-summary-row"><span>Профит / шт</span><span class="${profitClass}">${data.profitPerUnit !== null ? Math.round(data.profitPerUnit).toLocaleString('ru-RU') : '—'}</span></div>
      <div class="craft-summary-row"><strong>Итого на ${data.quantity.toLocaleString('ru-RU')} шт</strong><strong class="${profitClass}">${data.totalProfit !== null ? Math.round(data.totalProfit).toLocaleString('ru-RU') : '—'}</strong></div>
    </div>
    ${tierComparisonHtml(data)}
    ${baseChoiceHtml(data)}
    ${enchantAfterHtml(data)}
    ${patientSellHtml(data)}
    ${teleportHtml(data)}
  `;
  craftEl.result.querySelectorAll('tr.tier-row').forEach((tr) => tr.addEventListener('click', () => switchCraftTier(tr.dataset.itemId)));
  bindSalePlanEditing();
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

// Ручное редактирование плана продажи: ввод количества в любом городе пересчитывает срок, цикл и профит в реальном времени.
function bindSalePlanEditing() {
  let timer = null;
  craftEl.result.querySelectorAll('input.plan-qty').forEach((inp) => {
    inp.addEventListener('input', () => {
      // значение запоминаем сразу (иначе быстрый ввод в два города потеряет первый), а перерисовку откладываем
      manualSalePlan.set(inp.dataset.city, Math.max(Math.floor(Number(inp.value) || 0), 0));
      if (saleCityToggles.size > 0) saleCityToggles.set(inp.dataset.city, true); // вписанное количество включает город в план
      const city = inp.dataset.city;
      const caret = inp.selectionStart;
      clearTimeout(timer);
      timer = setTimeout(() => {
        renderCraftResult(lastCraftData);
        const again = craftEl.result.querySelector(`input.plan-qty[data-city="${city}"]`);
        if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch (e) { /* number input */ } }
      }, 250);
    });
  });
  craftEl.result.querySelectorAll('input.plan-toggle').forEach((box) => {
    box.addEventListener('change', () => {
      // первое включение/выключение фиксирует набор городов автоплана, дальше набор ведёт пользователь
      if (saleCityToggles.size === 0) {
        const auto = lastCraftData.patientSell && lastCraftData.patientSell.plan ? lastCraftData.patientSell.plan.cities.map((c) => c.city) : [];
        for (const c of lastCraftData.patientSell.byCity) saleCityToggles.set(c.city, auto.includes(c.city));
      }
      saleCityToggles.set(box.dataset.city, box.checked);
      if (!box.checked) manualSalePlan.delete(box.dataset.city);
      renderCraftResult(lastCraftData);
    });
  });
  const strategy = craftEl.result.querySelector('#sale-strategy');
  if (strategy) strategy.addEventListener('change', () => { saleStrategy = strategy.value; renderCraftResult(lastCraftData); });
  const reset = craftEl.result.querySelector('.plan-reset');
  if (reset) reset.addEventListener('click', () => { manualSalePlan.clear(); saleCityToggles.clear(); renderCraftResult(lastCraftData); });
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

// План закупки материала по городам (ценовой допуск динамический): где сколько покупать по терпеливым ордерам.
function acquirePlanHtml(data, resource) {
  const row = data.acquire && data.acquire.byResource.find((a) => a.resource === resource);
  const plan = row && row.plan;
  if (!plan || plan.cities.length === 0) return '';
  const cities = plan.cities.map((c) => `<li>${c.city}: ${fmtNum(c.qty)} шт по ${fmtNum(c.avgPrice)} <small>(допуск ${(c.tolerance * 100).toFixed(0)}%, ${fmtDays(c.days)})</small></li>`).join('');
  const skipped = plan.excluded.length ? `<li class="plan-skipped">вне плана: ${plan.excluded.map((e) => `${e.city} (${e.reason})`).join('; ')}</li>` : '';
  return `<details class="acquire-plan"><summary>план закупки${plan.cities.length > 1 ? ` (${plan.cities.length} гор., +${plan.overpayPct.toFixed(1)}% к лучшей цене)` : ''}</summary><ul>${cities}${skipped}</ul></details>`;
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

// Раздача остатка партии свободным городам. 'even' — пропорционально обороту (срок продажи у всех одинаковый);
// 'profit' — жадно: города с лучшей маржой берут партию первыми, но не больше своей «разумной вместимости»
// (оборот × доля рынка × 1.5 срока равномерного плана), остаток сверх вместимости делится по обороту.
function distributeQty(free, remaining, marketShare, strategy) {
  const out = new Map();
  if (free.length === 0) return out;
  const spread = (list, amount) => {
    const volume = list.reduce((sum, c) => sum + c.avgDailyVolume, 0);
    let assigned = 0;
    list.forEach((c) => { const q = Math.floor((amount * c.avgDailyVolume) / volume); out.set(c.city, (out.get(c.city) || 0) + q); assigned += q; });
    const top = list.reduce((a, b) => (b.avgDailyVolume > a.avgDailyVolume ? b : a));
    out.set(top.city, (out.get(top.city) || 0) + amount - assigned); // остаток округления — самому ликвидному
  };
  if (strategy !== 'profit') { spread(free, remaining); return out; }
  const evenDays = remaining / (free.reduce((sum, c) => sum + c.avgDailyVolume, 0) * marketShare);
  let left = remaining;
  [...free].sort((a, b) => b.profitPerUnit - a.profitPerUnit).forEach((c) => {
    const capacity = Math.floor(c.avgDailyVolume * marketShare * evenDays * PROFIT_STRATEGY_HORIZON);
    const q = Math.min(capacity, left);
    out.set(c.city, q);
    left -= q;
  });
  if (left > 0) spread(free, left);
  return out;
}

// Итоговый план продажи: города включаются чекбоксом («В плане»), партия делится между включёнными по стратегии;
// поверх этого можно вписать своё количество в любой город (он фиксируется, остальные делят остаток). Всё считается на лету
// и питает и таблицу по городам, и сводку сверху — чтобы любая правка плана меняла цену, профит и сроки везде сразу.
function salePlanState(p, data) {
  if (!p.byCity || p.byCity.length === 0) return null;
  const minPrice = p.threshold ? p.threshold.value : null;
  const marketShare = p.marketShare ?? 1;
  const serverPlan = p.plan && p.plan.cities.length ? p.plan : null;
  const auto = serverPlan
    ? { rows: new Map(serverPlan.cities.map((c) => [c.city, { qty: c.qty, days: c.days, tolerance: c.tolerance }])), days: serverPlan.totalDays }
    : salePlanByCity(p.byCity, data.quantity, marketShare, minPrice);

  const anyToggle = saleCityToggles.size > 0;
  const enabledOf = (c) => (saleCityToggles.has(c.city) ? saleCityToggles.get(c.city) : auto.rows.has(c.city));
  const enabled = p.byCity.filter((c) => c.avgDailyVolume > 0 && enabledOf(c));
  let baseQty = new Map();
  if (anyToggle || saleStrategy === 'profit') {
    const fixed = enabled.filter((c) => manualSalePlan.has(c.city));
    const free = enabled.filter((c) => !manualSalePlan.has(c.city));
    const remaining = Math.max(data.quantity - fixed.reduce((sum, c) => sum + manualSalePlan.get(c.city), 0), 0);
    baseQty = distributeQty(free, remaining, marketShare, saleStrategy);
  } else {
    baseQty = new Map([...auto.rows].map(([city, r]) => [city, r.qty]));
  }
  const rowsData = p.byCity.map((c) => {
    const a = auto.rows.get(c.city);
    const isEnabled = enabledOf(c) && (c.avgDailyVolume > 0 || manualSalePlan.has(c.city));
    const manual = manualSalePlan.has(c.city) && isEnabled;
    const qty = !isEnabled ? 0 : manual ? manualSalePlan.get(c.city) : (baseQty.get(c.city) || 0);
    const days = qty > 0 && c.avgDailyVolume > 0 ? qty / (c.avgDailyVolume * marketShare) : 0;
    return { c, qty, days, manual, tolerance: a ? a.tolerance : null, inPlan: !!a, enabled: isEnabled };
  });
  const totalQty = rowsData.reduce((sum, r) => sum + r.qty, 0);
  const planDays = rowsData.reduce((m, r) => Math.max(m, r.days), 0);       // города продают параллельно — срок по самому медленному
  const avgPrice = totalQty > 0 ? rowsData.reduce((sum, r) => sum + r.c.avgSellPrice * r.qty, 0) / totalQty : null;
  const netPrice = avgPrice === null ? null : avgPrice * (1 - data.taxRate - (data.setupFeeRate || 0));
  const profitUnit = netPrice === null ? null : netPrice - data.effectiveCostPerUnit;
  const anyManual = rowsData.some((r) => r.manual) || anyToggle;
  const noVolume = rowsData.some((r) => r.qty > 0 && !(r.c.avgDailyVolume > 0));
  return { minPrice, marketShare, serverPlan, auto, anyManual, rowsData, totalQty, planDays, avgPrice, netPrice, profitUnit, noVolume };
}

function byCityHtml(p, data, st) {
  if (!st) return '';
  const { minPrice, marketShare, serverPlan, auto, anyManual, rowsData, totalQty, planDays, avgPrice, netPrice, profitUnit, noVolume } = st;

  const rows = rowsData.map(({ c, qty, days, manual, tolerance, inPlan, enabled: isOn }) => {
    const dim = (minPrice !== null && c.avgSellPrice < minPrice && !manual) || !isOn;
    const cls = c.profitPerUnit > 0 ? 'profit-pos' : 'profit-neg';
    return `<tr class="${dim ? 'below-threshold' : ''}"><td class="plan-check"><input type="checkbox" class="plan-toggle" data-city="${c.city}" ${isOn ? 'checked' : ''} ${c.avgDailyVolume > 0 ? '' : 'disabled'} title="${c.avgDailyVolume > 0 ? 'Включить/выключить город в плане продажи — партия пересчитается' : 'В этом городе нет сделок за период'}" /></td><td>${c.city}</td><td>${fmtNum(c.avgSellPrice)}</td><td>${fmtNum(c.avgDailyVolume, 1)}</td><td class="${cls}">${fmtNum(c.profitPerUnit)}</td>
      <td data-sort-value="${qty}"><input class="plan-qty ${manual ? 'is-manual' : ''}" type="number" min="0" step="1" value="${qty}" data-city="${c.city}" title="Сколько штук планируешь продать в этом городе (введи своё — остальное пересчитается)" /></td>
      <td data-sort-value="${days}">${qty > 0 ? fmtDays(days) : '—'}${inPlan && tolerance && !manual ? ` <small>(допуск ${(tolerance * 100).toFixed(0)}%)</small>` : ''}</td>
      <td data-sort-value="${c.profitPerUnit * qty}" class="${cls}">${qty > 0 ? fmtNum(c.profitPerUnit * qty) : '—'}</td></tr>`;
  }).join('');

  const sumOk = totalQty === data.quantity;
  const acquireDays = data.acquire && data.acquire.days !== null ? data.acquire.days : null;
  return `
    <details open class="by-city">
      <summary>План продажи через Sell Order по городам${minPrice !== null ? ` (серые — ниже порога ${fmtNum(minPrice)}, в автоплан не входят)` : ''}</summary>
      <label class="craft-field" title="«Равномерно по времени» — партия делится пропорционально обороту, во всех городах она распродаётся за один срок. «Максимизировать профит» — города с лучшей маржой берут партию первыми, но не больше разумной вместимости (до 1.5× срока равномерного плана)">Распределение партии
        <select id="sale-strategy">
          <option value="even" ${saleStrategy === 'even' ? 'selected' : ''}>Равномерно по времени (по умолчанию)</option>
          <option value="profit" ${saleStrategy === 'profit' ? 'selected' : ''}>Баланс маржи и скорости — максимизировать профит</option>
        </select>
      </label>
      <div class="table-scroll"><table class="craft-recipe-table">
        <thead><tr><th>В плане</th><th>Город</th><th>Средняя цена</th><th>Сделок в день</th><th>Профит / шт</th><th>Везти сюда, шт</th><th>Дней здесь</th><th>Профит с города</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="plan-summary">
        <div>Распределено: <strong class="${sumOk ? '' : 'scan-stale'}">${fmtNum(totalQty)} из ${fmtNum(data.quantity)} шт</strong>${sumOk ? '' : ' ⚠ (сумма плана не равна партии)'}
          ${anyManual ? '<button type="button" class="plan-reset">Сбросить к автоплану</button>' : ''}</div>
        <div>Срок распродажи по плану: <strong>${totalQty > 0 ? fmtDays(planDays) : '—'}</strong>${acquireDays !== null && totalQty > 0 ? ` · весь цикл (закупка ${fmtDays(acquireDays)} + продажа): <strong>${fmtDays(acquireDays + planDays)}</strong>` : ''}</div>
        <div>Средняя цена: <strong>${avgPrice !== null ? fmtNum(avgPrice) : '—'}</strong> · после налога ${netPrice !== null ? fmtNum(netPrice) : '—'} · профит / шт: <strong class="${profitUnit !== null && profitUnit > 0 ? 'profit-pos' : 'profit-neg'}">${profitUnit !== null ? fmtNum(profitUnit) : '—'}</strong> · итого: <strong class="${profitUnit !== null && profitUnit > 0 ? 'profit-pos' : 'profit-neg'}">${profitUnit !== null ? fmtNum(profitUnit * totalQty) : '—'}</strong></div>
        ${noVolume ? '<div class="scan-stale">⚠ В одном из городов нет сделок за период — срок продажи там посчитать нельзя.</div>' : ''}
      </div>
      <p class="calc-note">Партия делится между городами пропорционально дневному обороту; при доле рынка ${(marketShare * 100).toFixed(0)}% автоплан занимает ${fmtDays(auto.days)}.${serverPlan ? ` В автоплан вошли города с ценой не хуже лучшей больше чем на допуск (у ликвидных он динамически больше).${serverPlan.excluded.length ? ` Вне автоплана: ${serverPlan.excluded.map((e) => `${e.city} — ${e.reason}`).join('; ')}.` : ''}` : ''} Включай и выключай города галочкой «В плане» или впиши своё количество — всё пересчитается сразу.</p>
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
// Обычный предмет .0: что выгоднее — скрафтить самому или купить готовый (то же сравнение, что в «зачаровать после крафта»,
// но для предмета без зачарования — там оно тоже должно быть, иначе галочка меняла бы расчёт .0-предмета).
function baseChoiceHtml(data) {
  const b = data.baseChoice;
  if (!b) return '';
  const buy = b.baseBuy ? `${b.baseBuy.city}: ${fmtNum(b.baseBuy.price)}` : 'нет предложений';
  return `
    <div class="craft-summary base-choice">
      <div class="craft-summary-row"><strong>Базовый предмет (.0): выгоднее ${b.baseSource === 'buy' ? 'купить готовый' : 'скрафтить'}</strong><span>${fmtNum(b.baseCostPerUnit)} / шт</span></div>
      <div class="craft-summary-row"><span>Себестоимость крафта / шт</span><span>${b.baseCraftCostPerUnit !== null ? fmtNum(b.baseCraftCostPerUnit) : 'нет цен на материалы'}</span></div>
      <div class="craft-summary-row"><span>Цена покупки готового (Sell Order)</span><span>${buy}</span></div>
    </div>`;
}

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
      ${t.unweighted && t.unweighted.length ? `<div class="craft-summary-row"><span class="scan-stale">⚠ Нет данных о весе, перевозка НЕ учтена: ${t.unweighted.join(', ')}</span><span></span></div>` : ''}
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
function cycleRowsHtml(data, planDays) {
  const a = data.acquire;
  if (!a || a.days === null) return '';
  const cycleDays = planDays !== undefined && planDays !== null ? a.days + planDays : a.cycleDays;
  const bottleneck = a.byResource.find((r) => r.resource === a.bottleneckResource);
  return `
      <div class="craft-summary-row"><span>Дней на закупку сырья (узкое место: ${bottleneck ? bottleneck.resourceName : '—'}, по доле рынка ${(data.marketShare * 100).toFixed(0)}%)</span><span>${fmtDays(a.days)}</span></div>
      <div class="craft-summary-row"><strong>Весь цикл: закупка + продажа</strong><strong>${cycleDays !== null ? fmtDays(cycleDays) : '—'}</strong></div>`;
}

// Продажа через Sell Order: свой ордер на продажу по средней цене истории; объём и дни на распродажу защищают
// от «прибыли» на предмете, который не продаётся.
function patientSellHtml(data) {
  const p = data.patientSell;
  if (!p) {
    return '<div class="craft-summary patient-sell"><div class="craft-summary-row"><span>Продажа через Sell Order</span><span>нет истории сделок за период</span></div></div>';
  }
  // Сводка сверху питается тем же планом, что и таблица по городам: правка плана пересчитывает всё сразу.
  const st = salePlanState(p, data);
  const live = st && st.totalQty > 0 ? st : null;
  const avgPrice = live ? live.avgPrice : p.avgSellPrice;
  const netPrice = live ? live.netPrice : p.netSellPrice;
  const profitUnit = live ? live.profitUnit : p.profitPerUnit;
  const sellDays = live ? live.planDays : p.daysToSellBatch;
  const soldQty = live ? live.totalQty : data.quantity;
  const cls = profitUnit > 0 ? 'profit-pos' : 'profit-neg';
  const totalProfit = profitUnit * soldQty;
  const slow = sellDays !== null && sellDays > 30;
  return `
    <div class="craft-summary patient-sell" id="craft-patient-section">
      <div class="craft-summary-row"><strong>Продажа через Sell Order (свой ордер, история за ${p.days} дн.)</strong><span></span></div>
      <div class="craft-summary-row"><span>Средняя цена сделок за период${live ? ' (по плану продажи)' : ''}</span><span>${fmtNum(avgPrice)}</span></div>
      <div class="craft-summary-row"><span>Лучший город по цене</span><span>${p.bestCity.city}: ${fmtNum(p.bestCity.avgPrice)}</span></div>
      <div class="craft-summary-row"><span>Спрос: сделок в день (по выбранным городам)</span><span>${fmtNum(p.avgDailyVolume, 1)}</span></div>
      <div class="craft-summary-row"><span>Дней на распродажу ${fmtNum(soldQty)} шт (по доле рынка ${(p.marketShare * 100).toFixed(0)}%: тебе достаётся ~${fmtNum(p.avgDailyVolume * p.marketShare, 1)} из ${fmtNum(p.avgDailyVolume, 1)} сделок в день)</span><span class="${slow ? 'scan-stale' : ''}">${fmtDays(sellDays)}${slow ? ' ⚠' : ''}</span></div>
      ${cycleRowsHtml(data, live ? live.planDays : undefined)}
      ${sellPlanHtml(data)}
      <div class="craft-summary-row"><span>После налога с продажи (${(data.taxRate * 100).toFixed(0)}%)</span><span>${fmtNum(netPrice)}</span></div>
      <div class="craft-summary-row"><span>Профит / шт</span><span class="${cls}">${fmtNum(profitUnit)}</span></div>
      <div class="craft-summary-row"><strong>Итого на ${fmtNum(soldQty)} шт</strong><strong class="${cls}">${fmtNum(totalProfit)}</strong></div>
      ${thresholdHtml(p)}
      ${byCityHtml(p, data, st)}
      ${qualityComparisonHtml(data)}
    </div>`;
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
      strategy: lazyEl.strategy.value, days: readCustomizable(lazyEl.history), royalBonus: String(craftEl.royalBonus.checked), focus: String(craftEl.focus.checked),
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

// --- Скан маржи и ликвидности (объединённый: гир, партии, рефайн — по данным кувшина) ---
const marginEl = {
  mode: document.getElementById('margin-mode'),
  includeMaterials: document.getElementById('margin-include-materials'),
  includeAwakened: document.getElementById('margin-include-awakened'),
  royalBonus: document.getElementById('margin-royal-bonus'),
  focus: document.getElementById('margin-focus'),
  category: document.getElementById('margin-category'),
  enchantMode: document.getElementById('margin-enchant-mode'),
  liquidity: document.getElementById('margin-liquidity'),
  quantity: document.getElementById('margin-quantity'),
  quantityField: document.getElementById('margin-quantity-field'),
  minDaily: document.getElementById('margin-min-daily'),
  days: document.getElementById('margin-days'),
  run: document.getElementById('margin-run'),
  result: document.getElementById('margin-result'),
};
marginEl.run.addEventListener('click', runMarginScan);
// В мгновенном режиме партии и «ликвидности по городам» нет — лишние поля не показываем.
function syncMarginMode() {
  const patient = marginEl.mode.value === 'patient';
  marginEl.quantityField.hidden = !patient;
  marginEl.liquidity.closest('label').hidden = !patient;
}
marginEl.mode.addEventListener('change', syncMarginMode);
syncMarginMode();

async function runMarginScan() {
  marginEl.run.disabled = true;
  marginEl.result.innerHTML = 'Считаю по данным кувшина: весь гир × зачарование × качество, это может занять несколько секунд...';
  try {
    const params = new URLSearchParams({
      mode: marginEl.mode.value, includeMaterials: String(marginEl.includeMaterials.checked), includeAwakened: String(marginEl.includeAwakened.checked),
      category: marginEl.category.value, enchantMode: marginEl.enchantMode.value, liquidity: marginEl.liquidity.value,
      quantity: marginEl.quantity.value || '1000', minDaily: marginEl.minDaily.value || '0', days: readCustomizable(marginEl.days), royalBonus: String(marginEl.royalBonus.checked), focus: String(marginEl.focus.checked),
      marketShare: readCustomizable(document.getElementById('margin-market-share')),
      cities: activeCities().join(','), premium: premiumParam(),
    });
    const res = await fetch(`/api/unified-scan?${params}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderMarginScan(data);
  } catch (err) {
    marginEl.result.innerHTML = `<span style="color:#ff6b6b">Ошибка: ${err.message}</span>`;
  } finally {
    marginEl.run.disabled = false;
  }
}

// Цвет индекса доверия: меньше 50% — цифра шаткая (мало часов торговли), от 80% — надёжная.
function confidenceClass(confidence) {
  return confidence < 0.5 ? 'scan-stale' : confidence >= 0.8 ? 'scan-spread-hot' : '';
}

// Возраст данных кувшина человеческим языком: «3 мин назад», «2 ч назад».
function fmtAgeMinutes(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${Math.round(minutes)} мин назад`;
  return `${(minutes / 60).toFixed(1)} ч назад`;
}

function renderMarginScan(data) {
  const patient = data.mode === 'patient';
  const jugNote = data.jug && data.jug.lastPricePass
    ? `Кувшин: цены обновлены ${fmtAgeMinutes((Date.now() - data.jug.lastPricePass) / 60000)}, история — ${fmtAgeMinutes(data.jug.lastHistoryPass ? (Date.now() - data.jug.lastHistoryPass) / 60000 : null)}.`
    : 'Кувшин ещё пуст — фоновый краулер только начал работу, подожди пару минут.';
  if (data.results.length === 0) {
    marginEl.result.innerHTML = `<div class="chart-empty">Ничего не нашлось — нет прибыльных комбинаций с таким оборотом. Попробуй снизить «Оборот от» или сменить режим. ${jugNote}</div>`;
    return;
  }
  const rows = data.results.map((r) => {
    const material = r.kind === 'material';
    const item = findItem(r.itemId) || { id: r.itemId, name: r.itemId };
    const stale = r.freshMinutes !== null && r.freshMinutes > 180;
    const long = patient && r.totalDays !== null && r.totalDays > 30;
    const premiumDays = r.premiumDays === null ? '—' : r.premiumDays < 1000 ? fmtNum(r.premiumDays, 0) : '>1000';
    const action = material
      ? `<button class="scan-add-btn" data-kind="material" data-type="${r.type}" data-tier="${r.tier}">в калькулятор</button>`
      : `<button class="scan-add-btn" data-kind="gear" data-id="${item.id}" data-enchant="${r.enchant}" data-quality="${r.quality}" data-quantity="${r.quantity || ''}">в калькулятор</button>`;
    return `
      <tr>
        <td><img class="item-icon-sm" src="${iconUrl(item.id, 24, r.enchant)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" /> ${item.name}${enchantTag(r.enchant)}${material ? ' <small>(рефайн)</small>' : ''}</td>
        <td data-sort-value="${r.quality}">${material ? '—' : QUALITY_NAMES[r.quality]}</td>
        <td>${fmtNum(r.cost)}</td>
        <td>${fmtNum(r.avgSellPrice)}${patient ? '' : `<br><small>${r.sellCities[0]}</small>`}</td>
        <td data-sort-value="${r.dailyVolume}">${fmtNum(r.dailyVolume, 1)}${patient && data.liquidity !== 'best' ? ` <small>(${r.sellCities.length} гор.)</small>` : ''}<br><small>тебе ~${fmtNum(r.yourDailyVolume, 1)}</small></td>
        <td class="scan-spread-hot" data-sort-value="${r.profitPerUnit}">+${fmtNum(r.profitPerUnit)} (${r.profitPct.toFixed(0)}%)</td>
        <td data-sort-value="${r.dailyProfit}">${fmtNum(r.dailyProfit)}</td>
        ${patient ? `<td class="${long ? 'scan-stale' : ''}" data-sort-value="${r.totalDays}" title="закупка узкого материала ${fmtDays(r.daysToAcquire)} + распродажа ${fmtDays(r.daysToSell)}">${fmtDays(r.totalDays)}${long ? ' ⚠' : ''}</td>` : ''}
        <td data-sort-value="${r.premiumDays ?? ''}" title="28 000 000 ÷ дневной профит — только шкала масштаба">${premiumDays}</td>
        <td class="${confidenceClass(r.confidence)}" data-sort-value="${r.confidence}" title="Цифры стоят на ${r.tradeHours} разных часах торговли за период (индекс доверия = n / (n + 20))">${Math.round(r.confidence * 100)}%<br><small>${r.tradeHours} ч</small></td>
        <td class="${stale ? 'scan-stale' : ''}" data-sort-value="${r.freshMinutes ?? ''}">${fmtAgeMinutes(r.freshMinutes)}${stale ? ' ⚠' : ''}</td>
        <td>${action}</td>
      </tr>`;
  }).join('');
  const sellNote = patient
    ? `свой Sell Order по средней цене сделок за ${data.days} дн. только в прибыльных городах (налог ${(data.taxRate * 100).toFixed(0)}% + сбор за размещение ${(data.setupFeeRate * 100).toFixed(1)}%), оборот — ${data.liquidity === 'best' ? 'лучший город' : 'сумма по выбранным городам'}; «Дней» — закупка узкого материала + распродажа партии из ${fmtNum(data.quantity)} шт`
    : `продажа в текущий Buy Order лучшего города (налог ${(data.taxRate * 100).toFixed(0)}%, без сбора за размещение), оборот — сделки за ${data.days} дн. в этом городе`;
  marginEl.result.innerHTML = `
    <p class="calc-note">Просмотрено комбинаций: ${fmtNum(data.scanned)}. ${data.mode === 'patient' ? 'Терпеливый режим' : 'Мгновенный режим'}: ${sellNote}. Доля рынка ${(data.marketShare * 100).toFixed(0)}% — профит в день и «дней на премиум» по твоей доле, а не по всему обороту. Список отсортирован по дневному профиту с поправкой на свежесть котировок${patient ? ' и длину цикла' : ''}. Способ зачарования: ${data.enchantMode === 'after' ? 'после крафта рунами' : 'крафт из зачарованного сырья'}; проверенный диапазон зачарования: ${data.enchantRange}${data.includeAwakened ? '' : ' (.4 не искали — включи галочку «Искать и .4»)'}. Возврат ресурсов: ${data.rrrOptions.royalBonus ? 'бонус города' : 'без бонуса города'}, ${data.rrrOptions.focus ? 'с Фокусом' : 'без Фокуса'}. ${jugNote}</p>
    <div class="table-scroll"><table class="scan-table">
      <thead><tr><th>Предмет</th><th>Качество</th><th>Себестоимость</th><th>${patient ? 'Ср. цена продажи' : 'Buy Order'}</th><th>Оборот/день (рынок)</th><th>Профит/шт</th><th>Профит/день (твоя доля)</th>${patient ? '<th>Дней (закупка+продажа)</th>' : ''}<th>Дней на премиум</th><th>Доверие</th><th>Свежесть</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  wireTableSort(marginEl.result.querySelector('table'), 'margin-scan');
  highlightBestRow(marginEl.result.querySelector('table'), data.results);
  marginEl.result.querySelectorAll('.scan-add-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.kind === 'material') {
        // Сырьё считается калькулятором рефайна на своей странице: тип и тир переносятся в адрес и считаются сразу.
        window.location.href = `refine.html?type=${encodeURIComponent(btn.dataset.type)}&tier=${encodeURIComponent(btn.dataset.tier)}`;
        return;
      }
      const item = findItem(btn.dataset.id);
      if (!item) return;
      selectCraftItem(item);
      craftEl.enchant.value = btn.dataset.enchant;
      craftEl.quality.value = btn.dataset.quality;
      if (btn.dataset.quantity) craftEl.quantity.value = btn.dataset.quantity;
      document.getElementById('craft-enchant-after').checked = data.enchantMode === 'after' && btn.dataset.enchant !== '0';
      document.getElementById('craft-controls').scrollIntoView({ behavior: 'smooth', block: 'center' });
      runCraftCalc();
    });
  });
}

initCraft();
