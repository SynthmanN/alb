// Страница «Рефайн»: скан выгодности переработки (кувшин) и калькулятор себестоимости.

// --- Скан рефайна (кувшин): партия и минимум дней вместо «доли рынка» ---
const refineScan = {
  mode: document.getElementById('refine-scan-mode'),
  capital: document.getElementById('refine-scan-capital'),
  minDays: document.getElementById('refine-scan-min-days'),
  minDaily: document.getElementById('refine-scan-min-daily'),
  days: document.getElementById('refine-scan-days'),
  royalBonus: document.getElementById('refine-scan-royal-bonus'),
  focus: document.getElementById('refine-scan-focus'),
  run: document.getElementById('refine-scan-run'),
  result: document.getElementById('refine-scan-result'),
};
refineScan.run.addEventListener('click', runRefineScan);

const scanNum = (n, digits = 0) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('ru-RU', { maximumFractionDigits: digits }));
const scanDays = (d) => (d === null || d === undefined ? '—' : d < 1 ? `${(d * 24).toFixed(1)} ч` : `${d.toFixed(1)} дн.`);
function scanAge(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 1) return 'только что';
  return minutes < 60 ? `${Math.round(minutes)} мин назад` : `${(minutes / 60).toFixed(1)} ч назад`;
}
const RESOURCE_TYPE_RU = { WOOD: 'Дерево', ORE: 'Руда', FIBER: 'Волокно', HIDE: 'Шкура', ROCK: 'Камень' };

async function runRefineScan() {
  refineScan.run.disabled = true;
  refineScan.result.innerHTML = 'Считаю по данным кувшина: 5 типов × 7 тиров...';
  try {
    const params = new URLSearchParams({
      mode: refineScan.mode.value, capital: readGroupedNumber(refineScan.capital) || '500000', minDays: refineScan.minDays.value || '1',
      minDaily: refineScan.minDaily.value || '0', days: readCustomizable(refineScan.days),
      royalBonus: String(refineScan.royalBonus.checked), focus: String(refineScan.focus.checked),
      cities: activeCities().join(','), premium: premiumParam(),
    });
    const res = await fetch(`/api/refine-scan?${params}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderRefineScan(data);
  } catch (err) {
    refineScan.result.innerHTML = `<span style="color:#ff6b6b">Ошибка: ${err.message}</span>`;
  } finally {
    refineScan.run.disabled = false;
  }
}

function renderRefineScan(data) {
  const patient = data.mode === 'patient';
  const jugNote = data.jug && data.jug.lastPricePass
    ? `Кувшин: цены обновлены ${scanAge((Date.now() - data.jug.lastPricePass) / 60000)}.`
    : 'Кувшин ещё пуст — фоновый краулер только начал работу, подожди пару минут.';
  if (data.results.length === 0) {
    refineScan.result.innerHTML = `<div class="chart-empty">Ничего не нашлось — нет прибыльной переработки с таким оборотом. Попробуй снизить «Оборот от» или сменить режим. ${jugNote}</div>`;
    return;
  }
  const rows = data.results.map((r) => {
    const stale = r.freshMinutes !== null && r.freshMinutes > 180;
    const confClass = r.confidence < 0.5 ? 'scan-stale' : r.confidence >= 0.8 ? 'scan-spread-hot' : '';
    return `
      <tr>
        <td><img class="item-icon-sm" src="${iconUrl(r.itemId, 24)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" /> ${itemName(r.itemId)}${r.cityBonus ? ' <span class="city-bonus" title="Город закупки даёт спец-бонус этому типу ресурса">★ бонус</span>' : ''}</td>
        <td>${scanNum(r.cost)}</td>
        <td>${scanNum(r.avgSellPrice)}<br><small>${r.sellCities.join(', ')}</small></td>
        <td data-sort-value="${r.dailyVolume}">${scanNum(r.dailyVolume, 0)}</td>
        <td data-sort-value="${r.quantity}" title="Позиция на ${scanNum(data.capital)} серебра: штук = капитал ÷ себестоимость (${scanNum(r.positionCost)} серебра)">${scanNum(r.quantity)}</td>
        <td class="scan-spread-hot" data-sort-value="${r.profitPerUnit}">+${scanNum(r.profitPerUnit)} (${r.profitPct.toFixed(0)}%)</td>
        <td data-sort-value="${r.batchProfit}">${scanNum(r.batchProfit)}</td>
        <td data-sort-value="${r.effectiveDays}" title="закупка ${scanDays(r.daysToAcquire)} + продажа ${scanDays(r.daysToSell)}${r.cappedByMinDays ? `; по рынку быстрее минимума — считаем ${data.minDays} дн.` : ''}">${scanDays(r.effectiveDays)}${r.cappedByMinDays ? ' <small>(минимум)</small>' : ''}</td>
        <td data-sort-value="${r.dailyProfit}">${scanNum(r.dailyProfit)}</td>
        <td class="${confClass}" data-sort-value="${r.confidence}" title="Цифры стоят на ${r.tradeHours} разных часах торговли (n / (n + 20))">${Math.round(r.confidence * 100)}%<br><small>${r.tradeHours} ч</small></td>
        <td class="${stale ? 'scan-stale' : ''}" data-sort-value="${r.freshMinutes ?? ''}">${scanAge(r.freshMinutes)}${stale ? ' ⚠' : ''}</td>
        <td><button class="scan-add-btn" data-type="${r.type}" data-tier="${r.tier}">в калькулятор</button></td>
      </tr>`;
  }).join('');
  const sellNote = patient
    ? `закупка по средней цене сделок за ${data.days} дн., продажа своим Sell Order только в прибыльных городах (налог ${(data.taxRate * 100).toFixed(0)}% + сбор ${(data.setupFeeRate * 100).toFixed(1)}%)`
    : `закупка по текущим ценам, продажа в Buy Order лучшего города (налог ${(data.taxRate * 100).toFixed(0)}%)`;
  refineScan.result.innerHTML = `
    <p class="calc-note">Просмотрено комбинаций: ${data.scanned}. ${patient ? 'Терпеливый режим' : 'Мгновенный режим'}: ${sellNote}. Капитал на позицию ${scanNum(data.capital)} серебра (штук = капитал ÷ себестоимость), минимум ${data.minDays} дн. на цикл: профит в день = профит с позиции ÷ max(дни цикла, минимум). Возврат: ${data.rrrOptions.royalBonus ? 'бонус города' : 'без бонуса города'}, ${data.rrrOptions.focus ? 'с Фокусом' : 'без Фокуса'}. ${jugNote}</p>
    <div class="table-scroll"><table class="scan-table">
      <thead><tr><th>Материал</th><th>Себестоимость</th><th>${patient ? 'Ср. цена продажи' : 'Buy Order'}</th><th>Оборот/день (рынок)</th><th>Штук</th><th>Профит/шт</th><th>Профит с позиции</th><th>Дней цикла</th><th>Профит/день</th><th>Доверие</th><th>Свежесть</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  wireTableSort(refineScan.result.querySelector('table'), 'refine-scan');
  highlightBestRow(refineScan.result.querySelector('table'), data.results);
  // «в калькулятор»: тип и тир переносятся в калькулятор ниже и считаются на месте (без перезагрузки страницы)
  refineScan.result.querySelectorAll('.scan-add-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      calcEl.type.value = btn.dataset.type;
      calcEl.tier.value = btn.dataset.tier;
      calcEl.royalBonus.checked = refineScan.royalBonus.checked;
      calcEl.focus.checked = refineScan.focus.checked;
      calcEl.result.scrollIntoView({ behavior: 'smooth', block: 'center' });
      runCalc();
    });
  });
}

// --- Калькулятор рефайна ---
const calcEl = {
  type: document.getElementById('calc-type'),
  tier: document.getElementById('calc-tier'),
  enchant: document.getElementById('calc-enchant'),
  royalBonus: document.getElementById('calc-royal-bonus'),
  focus: document.getElementById('calc-focus'),
  run: document.getElementById('calc-run'),
  result: document.getElementById('calc-result'),
};

async function initCalc() {
  const res = await fetch('/api/refining-meta');
  const meta = await res.json();
  calcEl.type.innerHTML = meta.resourceTypes.map((t) => `<option value="${t.id}">${t.name} (бонус: ${t.bonusCity})</option>`).join('');
  calcEl.tier.innerHTML = [2, 3, 4, 5, 6, 7, 8].map((t) => `<option value="${t}">T${t}</option>`).join('');
  calcEl.tier.value = 5;
  calcEl.run.addEventListener('click', runCalc);
  // Переход из общего сканера («в калькулятор» у строки сырья): ?type=ORE&tier=5 — подставляем и сразу считаем.
  const query = new URLSearchParams(window.location.search);
  const type = query.get('type');
  const tier = query.get('tier');
  if (type && meta.resourceTypes.some((t) => t.id === type) && [2, 3, 4, 5, 6, 7, 8].includes(Number(tier))) {
    calcEl.type.value = type;
    calcEl.tier.value = tier;
    runCalc();
  }
}

async function runCalc() {
  calcEl.result.innerHTML = 'Считаю...';
  try {
    const params = new URLSearchParams({
      type: calcEl.type.value, tier: calcEl.tier.value, enchant: calcEl.enchant.value,
      royalBonus: String(calcEl.royalBonus.checked), focus: String(calcEl.focus.checked), cities: activeCities().join(','), premium: premiumParam(),
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
        <td>${r.rrr !== undefined ? `${(r.rrr * 100).toFixed(1)}%` : '—'}</td>
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
      → 1 × ${data.itemId}. Возврат (RRR) считается в каждом городе отдельно: ${data.rrrLabel}.
      Профит считается после налога с продажи (${(data.taxRate * 100).toFixed(0)}%).
      ⭐ — город со спец-бонусом переработки этого ресурса.
    </p>
    <div class="table-scroll"><table class="calc-table">
      <thead><tr><th>Город</th><th>Сырьё</th><th>Пред. тир</th><th>Себест. (сырое)</th><th>Возврат</th><th>Себест. (с RRR)</th><th>Продажа</th><th>Профит/ед.</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>
  `;
  wireTableSort(calcEl.result.querySelector('table'), 'refine-calc');
}

initCalc();
