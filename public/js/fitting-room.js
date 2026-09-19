// Страница «Примерочная»: подбор самой дешёвой экипировки под целевой IP.

// --- Примерочная ---
const FIT_SLOTS = [
  { key: 'weapon', label: 'Оружие', accepts: ['осн. рука', 'двуручное'] },
  { key: 'offhand', label: 'Левая рука', accepts: ['левая рука'] },
  { key: 'head', label: 'Шлем', accepts: ['шлем'] },
  { key: 'chest', label: 'Торс', accepts: ['торс'] },
  { key: 'shoes', label: 'Обувь', accepts: ['обувь'] },
  { key: 'cape', label: 'Плащ', accepts: ['плащ', 'плащ (фракция)', 'плащ (охотник)'] },
];
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
    <div class="table-scroll"><table class="scan-table">
      <thead><tr><th>Цена</th><th>IP</th><th>Оружие</th><th>Левая рука</th><th>Шлем</th><th>Торс</th><th>Обувь</th><th>Плащ</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>
  `;
  wireTableSort(fitEl.result.querySelector('table'), 'fit');
}

initFit();
