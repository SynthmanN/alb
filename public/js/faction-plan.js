// План трат фракционных очков в калькуляторе. Сервер отдаёт позиции фракционных плащей (только с данными продаж + добавленные вручную) и рыночные цены
// деталей; весь расчёт плана — здесь, поэтому любая вписанная цена сразу перерисовывает список: зелёным — плащи, которые стоит крафтить (с количеством),
// серым — остальные (нет данных или крафт менее выгоден). Вписанные цены сохраняются на сервере (общие, помечены как недостоверные).
const FP_CREST = { 4: 400, 5: 2250, 6: 3000, 7: 7500, 8: 15000 };
const FP_HEART = 3000;
const FP_HEADS = [["name", "Плащ"], ["sale", "Цена продажи"], ["cost", "Себестоимость (без герба и сердца)"], ["vol", "Оборот/день · потолок"], ["profit", "Профит/шт"], ["points", "Очков"], ["perPoint", "Профит на очко"], ["qty", "В плане"], ["planPoints", "Потрачено очков"], ["planProfit", "Профит по плану"]];
const fpEl = { panel: document.getElementById('faction-plan-panel') };
const fp = { data: null, faction: null, points: 0, mode: 'mixed', extras: [], own: new Map(), saved: new Map(), limits: new Map(), sort: { key: 'planProfit', dir: 'desc' } };

const fpNum = (n, d = 0) => (n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: d }));
const fpAge = (minutes) => (minutes === null || minutes === undefined ? '' : minutes < 90 ? `${Math.round(minutes)} мин` : minutes < 2880 ? `${(minutes / 60).toFixed(0)} ч` : `${(minutes / 1440).toFixed(1)} дн.`);
const fpRowKey = (r) => `${r.tier}|${r.enchant}|${r.quality}`;

// Открывает план в калькуляторе (вызывается из скана при включённом подрежиме «План трат очков»)
async function openFactionPlan(factionId, points) {
  fp.faction = factionId;
  fp.points = points;
  fp.extras = [];
  fp.own.clear();
  await loadFactionPlan();
  fpEl.panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function loadFactionPlan() {
  fpEl.panel.hidden = false;
  fpEl.panel.innerHTML = '<div class="faction-plan"><p class="calc-note">Собираю позиции плана…</p></div>';
  try {
    const params = new URLSearchParams({
      faction: fp.faction, days: readCustomizable(document.getElementById('craft-days')), materialHours: readCustomizable(document.getElementById('craft-material-hours')),
      ...gearRrrParams(craftEl.gearRrr, craftEl.gearRrrCustom), cities: activeCities().join(','), premium: premiumParam(),
    });
    if (fp.extras.length) params.set('extra', fp.extras.join(','));
    fp.data = await fetchJson(`/api/faction-plan?${params}`);
    if (fp.data.error) throw new Error(fp.data.error);
    renderFactionPlan();
  } catch (err) {
    fpEl.panel.innerHTML = `<div class="faction-plan"><span style="color:#ff6b6b">Ошибка: ${err.message}</span></div>`;
  }
}

// Значение с учётом вписанного: own — то, что ввёл пользователь в этой сессии; иначе цена сервера (в т.ч. ранее вписанная, с пометкой manual)
const fpVal = (key, serverPrice) => (fp.own.has(key) ? fp.own.get(key) : serverPrice);
// Цена закупки материала: вписанная — рыночная, к ней добавляется комиссия 2.5% за свой Buy Order (у цен сервера она уже учтена)
const fpMat = (key, serverPrice) => (fp.own.has(key) ? fp.own.get(key) * (1 + fp.data.setupFeeRate) : serverPrice);

// Расчёт одной позиции
function fpCompute(r) {
  const d = fp.data;
  const capeDirect = fpMat(`mat:${r.capeDirect.id}`, r.capeDirect.price);
  const cape0 = fpMat(`mat:${r.cape0.id}`, r.cape0.price);
  const runes = r.runes.map((x) => ({ ...x, price: fpMat(`mat:${x.id}`, x.price) }));
  const runesOk = runes.length > 0 && runes.every((x) => x.price !== null && x.price !== undefined);
  const after = r.enchant > 0 && r.maxAfter && runesOk && cape0 !== null && cape0 !== undefined ? cape0 + runes.reduce((s, x) => s + x.count * x.price, 0) : null;
  let cost = null;
  let path = null;
  if (r.enchant === 0) { cost = capeDirect ?? null; path = 'прямой'; }
  else if (capeDirect === null || capeDirect === undefined) { cost = after; path = after === null ? null : 'после крафта'; }
  else if (after !== null && after <= capeDirect * 0.95) { cost = after; path = 'после крафта (руны, души, реликвии дешевле на 5%+)'; }
  else { cost = capeDirect; path = 'прямой (плащ нужного зачарования)'; }
  const grossSale = fpVal(`sale:${fpRowKey(r)}`, r.sale ? r.sale.avgPrice : null);
  const net = grossSale === null || grossSale === undefined ? null : grossSale * (1 - d.taxRate - d.setupFeeRate);
  const crestKey = `part:${r.crestId}`;
  const heartKey = `part:${r.heartId}`;
  const crestPrice = fpVal(crestKey, r.crest ? r.crest.price : null);
  const heartPrice = fpVal(heartKey, r.heart ? r.heart.price : null);
  const buy = (p) => (p === null || p === undefined ? null : p * (1 + d.setupFeeRate));      // купить деталь за серебро — свой Buy Order, комиссия 2.5%
  const vol = r.sale && r.sale.dailyVolume !== null ? r.sale.dailyVolume : null;
  const limitOwn = fp.limits.get(fpRowKey(r));
  const cap = limitOwn !== undefined ? limitOwn : vol !== null ? Math.max(Math.floor(vol * d.days), 1) : null;   // null — потолок неизвестен
  const pointsAll = FP_HEART + FP_CREST[r.tier];
  const profitAll = net !== null && cost !== null ? net - cost : null;
  const partsNet = crestPrice !== null && crestPrice !== undefined && heartPrice !== null && heartPrice !== undefined ? (crestPrice + heartPrice) * (1 - d.taxRate - d.setupFeeRate) : null;
  const variants = [];
  if (profitAll !== null) {
    variants.push({ id: 'all', label: 'всё за очки', points: pointsAll, profit: profitAll, silverParts: 0 });
    if (fp.mode === 'mixed') {
      if (buy(heartPrice) !== null) variants.push({ id: 'crest', label: 'герб за очки, сердце за серебро', points: FP_CREST[r.tier], profit: profitAll - buy(heartPrice), silverParts: buy(heartPrice), buyHeart: 1 });
      if (buy(crestPrice) !== null) variants.push({ id: 'heart', label: 'сердце за очки, герб за серебро', points: FP_HEART, profit: profitAll - buy(crestPrice), silverParts: buy(crestPrice), buyCrest: 1 });
    }
  }
  const missing = [];
  if (cost === null) {
    if (r.enchant === 0 || capeDirect === null) missing.push({ key: `mat:${r.capeDirect.id}`, label: r.capeDirect.label, hint: 'цена обычного плаща' });
    if (r.enchant > 0 && r.maxAfter) {
      if (cape0 === null || cape0 === undefined) missing.push({ key: `mat:${r.cape0.id}`, label: r.cape0.label, hint: 'плащ .0 (для пути «после крафта»)' });
      for (const x of runes) if (x.price === null || x.price === undefined) missing.push({ key: `mat:${x.id}`, label: x.label, hint: 'руна/душа/реликвия' });
    }
  }
  if (grossSale === null || grossSale === undefined) missing.push({ key: `sale:${fpRowKey(r)}`, label: 'цена продажи плаща', hint: 'своя цена продажи', sale: true });
  if (crestPrice === null || crestPrice === undefined) missing.push({ key: crestKey, label: `герб T${r.tier} (рыночная цена)`, hint: 'нужна для сравнения с продажей деталей и для варианта «за серебро»', part: true, id: r.crestId });
  if (heartPrice === null || heartPrice === undefined) missing.push({ key: heartKey, label: 'сердце (рыночная цена)', hint: 'одно на любой тир', part: true, id: r.heartId });
  return { r, cost, path, grossSale, net, profitAll, partsNet, cap, variants, missing, pointsAll, crestPrice, heartPrice, vol };
}

// План: жадно по эффективности «профит на очко» среди вариантов; на позицию — не больше потолка (оборот × окно, либо вписанный лимит)
function fpBuildPlan(computed) {
  let left = fp.points;
  const state = new Map(computed.map((c) => [fpRowKey(c.r), { c, units: [] }]));   // units: массив вариантов по штукам
  let lastEff = null;
  const canAdd = (s) => s.c.cap === null || s.units.length < s.c.cap;
  const pointsOnly = fp.mode === 'points';
  for (;;) {
    let best = null;
    for (const s of state.values()) {
      const c = s.c;
      if (!c.variants.length) continue;
      // новая штука в каком-либо варианте (в режиме «всё за очки» — только он; и только если крафт выгоднее продажи деталей)
      if (canAdd(s)) {
        for (const v of c.variants) {
          if (pointsOnly && v.id !== 'all') continue;
          if (v.profit <= 0 || v.points > left) continue;
          if (v.id === 'all' && c.partsNet !== null && v.profit < c.partsNet) continue;
          const eff = v.profit / v.points;
          if (!best || eff > best.eff) best = { s, kind: 'new', v, eff, dPoints: v.points, dProfit: v.profit };
        }
      }
      // апгрейд штуки: одна деталь за серебро → за очки
      s.units.forEach((u, idx) => {
        if (u.id === 'all') return;
        const all = c.variants.find((x) => x.id === 'all');
        if (!all || (c.partsNet !== null && all.profit < c.partsNet)) return;
        const dPoints = all.points - u.points;
        const dProfit = all.profit - u.profit;
        if (dPoints > left || dPoints <= 0 || dProfit <= 0) return;
        const eff = dProfit / dPoints;
        if (!best || eff > best.eff) best = { s, kind: 'up', idx, v: all, eff, dPoints, dProfit };
      });
    }
    if (!best) break;
    if (best.kind === 'new') best.s.units.push(best.v); else best.s.units[best.idx] = best.v;
    left -= best.dPoints;
    lastEff = best.eff;
  }
  return { state, left, lastEff };
}

function closeFactionPlan() { fpEl.panel.hidden = true; fp.data = null; }
function fpRender() { renderFactionPlan(); }
function renderFactionPlan() {
  const d = fp.data;
  if (!d) return;
  const computed = d.rows.map(fpCompute);
  const plan = fpBuildPlan(computed);
  const rowsWithPlan = computed.map((c) => {
    const s = plan.state.get(fpRowKey(c.r));
    const units = s.units;
    const byVariant = {};
    for (const u of units) byVariant[u.id] = (byVariant[u.id] || 0) + 1;
    return { c, units, byVariant, qty: units.length, points: units.reduce((sum, u) => sum + u.points, 0), profit: units.reduce((sum, u) => sum + u.profit, 0) };
  });
  // Сортировка: строки в плане (зелёные) всегда наверху, внутри групп — по выбранной колонке; по умолчанию — профит по плану по убыванию,
  // серые при равенстве — по профиту на штуку
  const sortValue = {
    name: (x) => x.c.r.tier * 100 + x.c.r.enchant * 10 + x.c.r.quality,
    sale: (x) => x.c.grossSale, cost: (x) => x.c.cost, vol: (x) => x.c.vol, profit: (x) => x.c.profitAll, points: (x) => x.c.pointsAll,
    perPoint: (x) => (x.c.profitAll === null ? null : x.c.profitAll / x.c.pointsAll), qty: (x) => x.qty, planPoints: (x) => x.points, planProfit: (x) => x.profit,
  }[fp.sort.key];
  const dirSign = fp.sort.dir === 'asc' ? 1 : -1;
  const cmp = (a, b, sign) => {
    if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;      // пустые значения — всегда внизу
    if (b === null || b === undefined) return -1;
    return sign * (a - b);
  };
  rowsWithPlan.sort((a, b) => (b.qty > 0) - (a.qty > 0) || cmp(sortValue(a), sortValue(b), dirSign) || cmp(a.c.profitAll, b.c.profitAll, -1));
  fp.planned = rowsWithPlan.filter((x) => x.qty > 0);
  const spent = fp.points - plan.left;
  const totalProfit = rowsWithPlan.reduce((s, x) => s + x.profit, 0);
  const capes = rowsWithPlan.reduce((s, x) => s + x.qty, 0);
  const buyHearts = rowsWithPlan.reduce((s, x) => s + (x.byVariant.crest || 0), 0);
  const buyCrests = {};
  for (const x of rowsWithPlan) if (x.byVariant.heart) buyCrests[x.c.r.tier] = (buyCrests[x.c.r.tier] || 0) + x.byVariant.heart;

    const input = (key, serverVal, ph, cls = '') => `<input class="fp-input ${cls} ${fp.own.has(key) ? 'is-manual' : ''}" type="number" min="0" step="1" data-fp="${key}" value="${fp.own.has(key) ? fp.own.get(key) : ''}" placeholder="${ph ?? ''}" title="Серым — цена из кувшина. Впиши свою: список пересчитается сразу, цена сохранится (общая, помечена недостоверной, живёт ${d.manualTtlDays} дн., пока AODP не даст данные)" />`;
  const rows = rowsWithPlan.map(({ c, qty, byVariant, points, profit }) => {
    const r = c.r;
    const on = qty > 0;
    const it = findItem(r.itemId) || { id: r.itemId, name: r.itemId };
    const manualBadge = r.sale && r.sale.manual ? ' <small class="fp-warn" title="Цена продажи вписана вручную — недостоверная">⚠ вписано</small>' : '';
    const partsManual = (r.crest && r.crest.manual) || (r.heart && r.heart.manual) ? ' <small class="fp-warn" title="Цена герба/сердца вписана вручную — недостоверная">⚠ вписано</small>' : '';
    const age = r.sale && r.sale.ageDays !== null && r.sale.ageDays !== undefined ? `<br><small class="${r.sale.ageDays >= 2 ? 'scan-stale' : ''}">${r.sale.manual ? 'вписано ' : 'сделки '}${r.sale.ageDays.toFixed(1)} дн. назад</small>` : '';
    const variantText = on ? Object.entries(byVariant).map(([id, n]) => `${n}× ${c.variants.find((v) => v.id === id).label}`).join('<br>') : '';
    const missingHtml = c.missing.length ? `<tr class="fp-missing-row"><td colspan="10"><span class="fp-missing-title">Не хватает данных:</span> ${c.missing.map((m) => `<label class="fp-chip">${m.label} ${input(m.key, null, 'цена', m.sale ? 'fp-sale' : '')}<small>${m.hint}</small></label>`).join('')}</td></tr>` : '';
    return `<tr class="${on ? 'fp-on' : 'fp-off'}" data-row="${fpRowKey(r)}">
      <td><span class="scan-item"><img class="item-icon-sm" src="${iconUrl(it.id, 64, r.enchant, r.quality)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" /><span>${it.name}${enchantTag(r.enchant)}<br><small class="scan-item-sub">T${r.tier} · .${r.enchant} · ${QUALITY_NAMES[r.quality]}${r.source === 'extra' ? ' · добавлено' : ''}</small></span></span>${r.source === 'extra' ? ` <button type="button" class="fp-remove" data-remove="${r.tier}:${r.enchant}:${r.quality}" title="Убрать из списка">×</button>` : ''}</td>
      <td>${input(`sale:${fpRowKey(r)}`, r.sale ? r.sale.avgPrice : null, r.sale ? fpNum(r.sale.avgPrice) : 'цена продажи')}${manualBadge}${age}</td>
      <td data-sort-value="${c.cost ?? ''}">${c.cost === null ? '<small class="scan-stale">нет цены</small>' : fpNum(c.cost)}${c.path ? `<br><small title="Путь: ${c.path}">${c.path.split(' (')[0]}</small>` : ''}</td>
      <td>${c.vol === null ? '<small class="scan-stale" title="Истории нет — потолок штук неизвестен">⚠ неизвестен</small><br>' : fpNum(c.vol, 1)}<input class="fp-input fp-limit" type="number" min="1" step="1" data-fp-limit="${fpRowKey(r)}" value="${fp.limits.has(fpRowKey(r)) ? fp.limits.get(fpRowKey(r)) : ''}" placeholder="${c.vol !== null ? `≤ ${c.cap}` : 'лимит штук'}" title="Потолок штук: по умолчанию оборот × окно истории; можно вписать свой" /></td>
      <td class="${c.profitAll > 0 ? 'profit-pos' : ''}">${c.profitAll === null ? '—' : fpNum(c.profitAll)}${partsManual}</td>
      <td>${fpNum(c.pointsAll)}</td>
      <td data-sort-value="${c.profitAll !== null ? c.profitAll / c.pointsAll : ''}">${c.profitAll === null ? '—' : fpNum(c.profitAll / c.pointsAll, 1)}${c.partsNet !== null ? `<br><small title="Сколько дала бы продажа герба и сердца вместо крафта">детали: ${fpNum(c.partsNet)}</small>` : ''}</td>
      <td class="fp-qty">${on ? `<b>${fpNum(qty)} шт</b><br><small>${variantText}</small>` : '—'}</td>
      <td>${on ? fpNum(points) : '—'}</td>
      <td>${on ? `<b class="profit-pos">+${fpNum(profit)}</b>` : '—'}</td></tr>${missingHtml}`;
  }).join('');

  const HEADS_DEF = FP_HEADS;
  const heads = HEADS_DEF.map(([key, label]) => `<th class="sortable" data-sort-key="${key}" title="Сортировка по колонке (по убыванию, повторный клик — по возрастанию). Строки в плане всегда сверху">${label}${fp.sort.key === key ? `<span class="sort-arrow">${fp.sort.dir === 'desc' ? ' ▼' : ' ▲'}</span>` : ''}</th>`).join('');
  const buyList = [buyHearts ? `${fpNum(buyHearts)} сердец` : null, ...Object.entries(buyCrests).map(([t, n]) => `${fpNum(n)} гербов T${t}`)].filter(Boolean);
  fpEl.panel.innerHTML = `<div class="faction-plan fp-shell">
    <div class="fp-head">
      <h4>План трат фракционных очков · ${d.faction.name}</h4>
      <label class="craft-field">Очков<input id="fp-points" data-grouped value="${fpNum(fp.points)}" /></label>
      <label class="craft-field" title="«Оптимально» — очки идут туда, где сберегают больше серебра (остальные детали докупаются за серебро по рыночной цене); «Всё за очки» — и герб, и сердце за очки">Детали
        <select id="fp-mode"><option value="mixed" ${fp.mode === 'mixed' ? 'selected' : ''}>оптимально (часть за серебро)</option><option value="points" ${fp.mode === 'points' ? 'selected' : ''}>всё за очки</option></select>
      </label>
      <span class="fp-add"><button type="button" id="fp-add-toggle" title="Добавить позицию: тир, зачарование, качество">＋ позиция</button>
        <span id="fp-add-form" hidden>
          <select id="fp-add-tier">${d.tiers.map((t) => `<option value="${t}">T${t}</option>`).join('')}</select>
          <select id="fp-add-ench">${[0, 1, 2, 3, 4].map((e) => `<option value="${e}">.${e}</option>`).join('')}</select>
          <select id="fp-add-q">${[1, 2, 3, 4, 5].map((q) => `<option value="${q}" ${q === 4 ? 'selected' : ''}>${QUALITY_NAMES[q]}</option>`).join('')}</select>
          <button type="button" id="fp-add-ok">Добавить</button></span></span>
      <button type="button" id="fp-close" class="fp-close" title="Закрыть план">×</button>
    </div>
    <div class="craft-summary">
      <div class="craft-summary-row"><span>Плащей в плане</span><span>${fpNum(capes)}</span></div>
      <div class="craft-summary-row"><span>Потрачено очков из ${fpNum(fp.points)}</span><span>${fpNum(spent)} · остаток ${fpNum(plan.left)}</span></div>
      <div class="craft-summary-row"><strong>Профит по плану</strong><strong class="profit-pos">${fpNum(totalProfit)}</strong></div>
      ${plan.lastEff !== null ? `<div class="craft-summary-row"><span title="Профит на очко у последней потраченной порции очков — по нему видно, окупается ли следующее очко">Цена очка в серебре (последняя порция)</span><span>≈ ${fpNum(plan.lastEff, 1)}</span></div>` : ''}
      ${buyList.length ? `<div class="craft-summary-row"><span>Докупить на рынке за серебро</span><span>${buyList.join(', ')}</span></div>` : ''}
    </div>
    ${fp.planned.length ? `<div class="fp-send"><button type="button" id="fp-send" title="Все зелёные позиции переносятся в калькулятор одним стеком: считаются как в обычном крафте, у каждой можно поменять количество и удалить">Крафтить план: перенести ${fp.planned.length} поз. в калькулятор</button></div>` : ''}
    <p class="calc-note">Зелёные — плащи в плане (сколько крафтить), серые — нет данных или крафт менее выгоден. Впиши свою цену в любую позицию — список пересчитается сразу. Вписанные цены герба, сердца, плаща и продажи сохраняются на сервере как недостоверные (⚠) и заменяют отсутствующие данные AODP до 10 дней.</p>
    <div class="mobile-sort"><label>Сортировка<select id="fp-sort-col">${HEADS_DEF.map(([key, label]) => `<option value="${label}" ${fp.sort.key === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label><button type="button" id="fp-sort-dir" title="Направление сортировки">${fp.sort.dir === 'desc' ? '▼' : '▲'}</button></div>
    <div class="table-scroll"><table class="craft-recipe-table fp-table" id="fp-table"><thead><tr>${heads}</tr></thead><tbody>${rows}</tbody></table></div>
  </div>`;
  bindFactionPlan();
}

let fpTimer = null;
const HEADS_KEY_BY_LABEL = Object.fromEntries(FP_HEADS.map(([key, label]) => [label, key]));
function bindFactionPlan() {
  const root = fpEl.panel;
  root.querySelectorAll('input.fp-input[data-fp]').forEach((inp) => inp.addEventListener('input', () => {
    const key = inp.dataset.fp;
    const v = parseFloat(inp.value);
    if (Number.isFinite(v) && v >= 0 && inp.value !== '') fp.own.set(key, v); else fp.own.delete(key);
    fpPersist(key);
    const caret = inp.selectionStart;
    clearTimeout(fpTimer);
    fpTimer = setTimeout(() => {
      fpRender();
      const again = fpEl.panel.querySelector(`input[data-fp="${CSS.escape(key)}"]`);
      if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch (e) { /* number */ } }
    }, 350);
  }));
  root.querySelectorAll('input[data-fp-limit]').forEach((inp) => inp.addEventListener('input', () => {
    const v = parseInt(inp.value, 10);
    if (Number.isFinite(v) && v > 0) fp.limits.set(inp.dataset.fpLimit, v); else fp.limits.delete(inp.dataset.fpLimit);
    clearTimeout(fpTimer);
    fpTimer = setTimeout(() => { fpRender(); const a = fpEl.panel.querySelector(`input[data-fp-limit="${inp.dataset.fpLimit}"]`); if (a) a.focus(); }, 350);
  }));
  const pts = document.getElementById('fp-points');
  makeGroupedInput(pts);
  pts.addEventListener('input', () => {
    fp.points = readGroupedNumber(pts) || 0;
    clearTimeout(fpTimer);
    fpTimer = setTimeout(() => { fpRender(); const a = document.getElementById('fp-points'); if (a) { a.focus(); a.setSelectionRange(a.value.length, a.value.length); } }, 350);
  });
  root.querySelectorAll('th[data-sort-key]').forEach((th) => th.addEventListener('click', () => {
    const key = th.dataset.sortKey;
    fp.sort = { key, dir: fp.sort.key === key && fp.sort.dir === 'desc' ? 'asc' : 'desc' };
    fpRender();
  }));
  document.getElementById('fp-sort-col').addEventListener('change', (e) => { fp.sort = { key: HEADS_KEY_BY_LABEL[e.target.value], dir: 'desc' }; fpRender(); });
  document.getElementById('fp-sort-dir').addEventListener('click', () => { fp.sort = { key: fp.sort.key, dir: fp.sort.dir === 'desc' ? 'asc' : 'desc' }; fpRender(); });
  // на телефоне строки — карточки «подпись: значение»
  const labels = [...root.querySelectorAll('th[data-sort-key]')].map((th) => th.textContent.replace(/[▼▲]/g, '').trim());
  root.querySelectorAll('tr[data-row]').forEach((tr) => [...tr.children].forEach((td, i) => { if (labels[i] && i > 0) td.setAttribute('data-label', labels[i]); }));
  const send = document.getElementById('fp-send');
  if (send) send.addEventListener('click', sendPlanToCalc);
  document.getElementById('fp-mode').addEventListener('change', (e) => { fp.mode = e.target.value; fpRender(); });
  document.getElementById('fp-close').addEventListener('click', () => { fpEl.panel.hidden = true; fp.data = null; });
  document.getElementById('fp-add-toggle').addEventListener('click', () => { const f = document.getElementById('fp-add-form'); f.hidden = !f.hidden; });
  document.getElementById('fp-add-ok').addEventListener('click', () => {
    const t = document.getElementById('fp-add-tier').value;
    const e = document.getElementById('fp-add-ench').value;
    const q = document.getElementById('fp-add-q').value;
    const key = `${t}:${e}:${q}`;
    if (!fp.extras.includes(key)) fp.extras.push(key);
    loadFactionPlan();
  });
  root.querySelectorAll('button[data-remove]').forEach((b) => b.addEventListener('click', () => { fp.extras = fp.extras.filter((x) => x !== b.dataset.remove); loadFactionPlan(); }));
}

// Сохранение вписанной цены на сервере (общая, недостоверная): дебаунс по ключу
const fpPersistTimers = new Map();
function fpPersist(key) {
  clearTimeout(fpPersistTimers.get(key));
  fpPersistTimers.set(key, setTimeout(() => {
    const price = fp.own.has(key) ? fp.own.get(key) : 0;
    const d = fp.data;
    if (!d) return;
    let id = null;
    let quality = 1;
    if (key.startsWith('mat:') || key.startsWith('part:')) id = key.slice(key.indexOf(':') + 1);
    else if (key.startsWith('sale:')) {
      const row = d.rows.find((r) => fpRowKey(r) === key.slice(5));
      if (row) { id = row.finishedId; quality = row.quality; }
    }
    if (!id) return;
    if (key.startsWith('sale:')) { const row = d.rows.find((r) => fpRowKey(r) === key.slice(5)); if (row && row.sale && !row.sale.manual) return; }   // есть данные AODP — вписанная цена продажи нужна только этой сессии
    fetch('/api/manual-price', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, quality, price }) }).catch(() => {});
  }, 600));
}

// «Крафтить план»: зелёные позиции уходят в калькулятор одним стеком. Позиция с разными способами добычи деталей (часть штук — герб и сердце за очки,
// часть — одна деталь за серебро) разбивается на отдельные строки стека; способ (прямой плащ или чары после крафта) переносится как в плане.
function sendPlanToCalc() {
  const d = fp.data;
  if (!d || !fp.planned || fp.planned.length === 0) return;
  const items = [];
  for (const x of fp.planned) {
    for (const [variant, n] of Object.entries(x.byVariant)) {
      items.push({
        itemId: x.c.r.itemId, enchant: x.c.r.enchant, quality: x.c.r.quality, quantity: n, salePrice: x.c.grossSale,     // цена продажи из плана (или вписанная) — стек считает профит по ней же
        after: x.c.r.enchant > 0 && !!x.c.path && x.c.path.startsWith('после'),
        crestSilver: variant === 'heart', heartSilver: variant === 'crest',
      });
    }
  }
  enterCraftStack({ id: fp.faction, name: d.faction.name, points: fp.points }, items);
  const panel = document.getElementById('craft-stack-panel');
  if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
