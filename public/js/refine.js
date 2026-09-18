// Страница «Рефайн»: сканер выгодности и калькулятор себестоимости.

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
    <div class="table-scroll"><table class="scan-table">
      <thead><tr><th>Материал</th><th>Себестоимость/шт</th><th>Продать</th><th>Профит/шт</th><th>Объём</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>
  `;
  wireTableSort(refineScanResult.querySelector('table'), 'refine-scan');
}

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
    <div class="table-scroll"><table class="calc-table">
      <thead><tr><th>Город</th><th>Сырьё</th><th>Пред. тир</th><th>Себест. (сырое)</th><th>Себест. (с RRR)</th><th>Продажа</th><th>Профит/ед.</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>
  `;
  wireTableSort(calcEl.result.querySelector('table'), 'refine-calc');
}

initCalc();
initRefineScan();
