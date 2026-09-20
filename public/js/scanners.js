// Страница «Флиппинг»: сканер возможностей и сканер Чёрного Рынка.

// --- Сканер возможностей ---
const scanBtn = document.getElementById('scan-run');
const scanResult = document.getElementById('scan-result');
scanBtn.addEventListener('click', runScan);

async function runScan() {
  scanBtn.disabled = true;
  scanResult.innerHTML = 'Сканирую весь каталог, это может занять несколько секунд...';
  try {
    const minProfit = document.getElementById('scan-min-profit').value || '0';
    const res = await fetch(`/api/opportunities?premium=${premiumParam()}&minProfit=${encodeURIComponent(minProfit)}`);
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
        <td><img class="item-icon-sm" src="${iconUrl(item.id, 24, r.enchant || 0)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" /> ${item.name}${enchantTag(r.enchant)}</td>
        <td class="scan-spread-hot">${r.spreadPct.toFixed(1)}%</td>
        <td>${r.bestBuy.city}: ${r.bestBuy.price.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}</td>
        <td>${r.bestSell.city}: ${r.bestSell.price.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}</td>
        <td data-sort-value="${r.volume24h ?? ''}">${volumeText}</td>
        <td class="${stale ? 'scan-stale' : ''}" data-sort-value="${r.freshMinutes ?? ''}">${freshText}${stale ? ' ⚠' : ''}</td>
        <td><button class="scan-add-btn" data-id="${item.id}" ${alreadyTracked ? 'disabled' : ''}>${alreadyTracked ? 'в таблице' : '+ добавить'}</button></td>
      </tr>
    `;
  }).join('');

  scanResult.innerHTML = `
    <p class="calc-note">Спред — после налога с продажи (${rows[0] ? (rows[0].taxRate * 100).toFixed(0) : '8'}%). Объём — только по двум городам сделки; меньше 3 сделок за 24ч уже отфильтровано. Старые котировки понижают позицию в списке. ⚠ — данные старше 3 часов.</p>
    <div class="table-scroll"><table class="scan-table">
      <thead><tr><th>Предмет</th><th>Спред</th><th>Купить</th><th>Продать</th><th>Объём 24ч</th><th>Свежесть</th><th></th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>
  `;
  wireTableSort(scanResult.querySelector('table'), 'scan');
  highlightBestRow(scanResult.querySelector('table'), rows.slice(0, 25));
  scanResult.querySelectorAll('.scan-add-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (!tracked.includes(id)) { tracked.push(id); saveTracked(); }
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
    const params = new URLSearchParams({ cities: activeCities().join(','), premium: premiumParam() });
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
        <td><img class="item-icon-sm" src="${iconUrl(item.id, 24, r.enchant || 0)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" /> ${item.name}${enchantTag(r.enchant)}</td>
        <td class="scan-spread-hot">+${r.profitPct.toFixed(1)}%</td>
        <td>${r.bestBuy.city}: ${r.bestBuy.price.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}</td>
        <td>БМ: ${r.bmPrice.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}</td>
        <td data-sort-value="${r.bmVolume24h ?? ''}">${volumeText}</td>
        <td class="${stale ? 'scan-stale' : ''}" data-sort-value="${r.freshMinutes ?? ''}">${freshText}${stale ? ' ⚠' : ''}</td>
        <td><button class="scan-add-btn" data-id="${item.id}" ${alreadyTracked ? 'disabled' : ''}>${alreadyTracked ? 'в таблице' : '+ добавить'}</button></td>
      </tr>
    `;
  }).join('');

  bmScanResult.innerHTML = `
    <p class="calc-note">Объём считается на Black Market за 24ч — меньше 3 продаж уже отфильтровано. Профит — после налога с продажи и сбора за размещение на БМ (${rows[0] ? (rows[0].bmTaxRate * 100).toFixed(1) : '10.5'}%).</p>
    <div class="table-scroll"><table class="scan-table">
      <thead><tr><th>Предмет</th><th>Профит</th><th>Купить</th><th>Продать на БМ</th><th>Объём БМ 24ч</th><th>Свежесть</th><th></th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>
  `;
  wireTableSort(bmScanResult.querySelector('table'), 'bm-scan');
  highlightBestRow(bmScanResult.querySelector('table'), rows.slice(0, 25));
  bmScanResult.querySelectorAll('.scan-add-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (!tracked.includes(id)) { tracked.push(id); saveTracked(); }
      btn.disabled = true;
      btn.textContent = 'в таблице';
    });
  });
}

// --- Сканер зачарования ---
const enchantScanBtn = document.getElementById('enchant-scan-run');
const enchantScanHours = document.getElementById('enchant-scan-hours');
const enchantScanResult = document.getElementById('enchant-scan-result');
enchantScanBtn.addEventListener('click', runEnchantScan);

async function runEnchantScan() {
  enchantScanBtn.disabled = true;
  enchantScanResult.innerHTML = 'Считаю цепочки «купить → зачаровать → продать» по всему гиру, это может занять несколько секунд...';
  try {
    const params = new URLSearchParams({ hours: readCustomizable(enchantScanHours), cities: activeCities().join(','), premium: premiumParam() });
    const res = await fetch(`/api/enchant-opportunities?${params}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderEnchantScanResult(data);
  } catch (err) {
    enchantScanResult.innerHTML = `<span style="color:#ff6b6b">Ошибка: ${err.message}</span>`;
  } finally {
    enchantScanBtn.disabled = false;
  }
}

function renderEnchantScanResult(rows) {
  if (rows.length === 0) {
    enchantScanResult.innerHTML = '<div class="chart-empty">Ничего не нашлось — либо зачарование сейчас не окупается, либо всё отфильтровано по ликвидности целевого уровня.</div>';
    return;
  }
  const fmt = (n) => Math.round(n).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
  const rowsHtml = rows.map((r) => {
    const item = findItem(r.itemId) || { id: r.itemId, name: r.itemId };
    const stale = r.freshMinutes !== null && r.freshMinutes > 180;
    const freshText = r.freshMinutes === null ? '—' : r.freshMinutes < 60 ? `${r.freshMinutes} мин назад` : `${Math.round(r.freshMinutes / 60)} ч назад`;
    const volumeText = r.volume === null ? 'не проверено' : `${r.volume} сделок`;
    return `
      <tr>
        <td><img class="item-icon-sm" src="${iconUrl(item.id, 24)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" /> ${item.name}</td>
        <td data-sort-value="${r.toLevel}">.${r.fromLevel} → .${r.toLevel}</td>
        <td data-sort-value="${r.quality}">${QUALITY_NAMES[r.quality] || '—'}</td>
        <td>${r.buy.city}: ${fmt(r.buy.price)}</td>
        <td data-sort-value="${r.materialCost}">${r.materialCount} × ${itemName(r.materialId)} = ${fmt(r.materialCost)}</td>
        <td>${r.bestSell.city}: ${fmt(r.bestSell.price)}</td>
        <td class="scan-spread-hot">+${fmt(r.profit)} (${r.profitPct.toFixed(1)}%)</td>
        <td data-sort-value="${r.volume ?? ''}">${volumeText}</td>
        <td class="${stale ? 'scan-stale' : ''}" data-sort-value="${r.freshMinutes ?? ''}">${freshText}${stale ? ' ⚠' : ''}</td>
      </tr>`;
  }).join('');
  enchantScanResult.innerHTML = `
    <p class="calc-note">Профит — после налога с продажи (${(rows[0].taxRate * 100).toFixed(0)}%). Себестоимость = вещь уровнем ниже + материалы зачарования.</p>
    <div class="table-scroll"><table class="scan-table">
      <thead><tr><th>Предмет</th><th>Шаг</th><th>Качество</th><th>Купить</th><th>Материалы</th><th>Продать</th><th>Профит</th><th>Объём</th><th>Свежесть</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>
  `;
  wireTableSort(enchantScanResult.querySelector('table'), 'enchant-scan');
  highlightBestRow(enchantScanResult.querySelector('table'), rows);
}

