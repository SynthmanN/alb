// Стек фракционных плащей в калькуляторе: позиции из плана трат очков (зелёные строки) переносятся сюда одной кнопкой. Каждая позиция считается
// тем же /api/craft-calc, что и обычный крафт. Позиции бывают «в расчёте» (зелёные) и серые: по умолчанию зелёные все — калькулятор показывает
// общий вид (общий профит и сводный список закупки по всем зелёным). Клик по позиции оставляет зелёной только её — калькулятор показывает её
// обычным полным видом; дальше клики по серым добавляют их в расчёт, по зелёным — убирают (клик по единственной зелёной возвращает «все»).
// Герб и сердце можно купить за серебро на рынке вместо очков — переключатель у позиции. Стек хранится в браузере (localStorage).
const STACK_KEY = 'albion_craft_stack';
const stackResults = new Map();      // uid → ответ /api/craft-calc (или { error })
let stackToken = 0;                  // номер последнего пересчёта — устаревшие ответы отбрасываются
let stackUidCounter = 0;
const stackPanel = document.getElementById('craft-stack-panel');
const STACK_ITEM_FIELDS = ['craft-enchant', 'craft-quality', 'craft-quantity', 'craft-enchant-after'];   // поля одной позиции: в общем виде недоступны

const stackNum = (n, d = 0) => (n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: d }));
const stackActiveItem = () => (craftStack && craftStack.activeUid ? craftStack.items.find((i) => i.uid === craftStack.activeUid) || null : null);
const stackSelected = () => (craftStack ? craftStack.items.filter((i) => i.on) : []);
const stackPartsSilver = (item) => (item ? [item.crestSilver ? 'crest' : null, item.heartSilver ? 'heart' : null].filter(Boolean) : []);
const stackSpec = (item) => ({ itemId: item.itemId, enchant: item.enchant, quality: item.quality, quantity: item.quantity, after: item.after, partsSilver: stackPartsSilver(item) });
const stackOk = (uid) => { const d = stackResults.get(uid); return d && !d.error ? d : null; };

function stackSave() {
  try {
    if (!craftStack || !craftFaction) localStorage.removeItem(STACK_KEY);
    else localStorage.setItem(STACK_KEY, JSON.stringify({ faction: craftFaction, items: craftStack.items }));
  } catch (e) { /* хранилище недоступно — стек живёт до перезагрузки */ }
}

// Вход в режим стека: items — позиции {itemId, enchant, quality, quantity, after, crestSilver, heartSilver, on}; заменяет прежний стек
function enterCraftStack(faction, items) {
  const list = items.filter((i) => findItem(i.itemId) && i.quantity > 0).map((i) => ({ ...i, on: i.on !== false, uid: `s${++stackUidCounter}` }));
  if (list.length === 0) return;
  if (!list.some((i) => i.on)) list.forEach((i) => { i.on = true; });
  stackResults.clear();
  craftFaction = { id: faction.id, name: faction.name, points: faction.points };
  craftStack = { items: list, activeUid: null, aggregate: false };
  renderFactionBadge();
  applyStackSelection(true);
}

// Выход: стек и его сохранение очищаются (фракционный режим калькулятора выключает вызывающий код)
function exitCraftStack() {
  craftStack = null;
  stackResults.clear();
  stackToken++;
  stackSave();
  setStackItemFields(false);
  if (stackPanel) { stackPanel.hidden = true; stackPanel.innerHTML = ''; }
}

// В общем виде поля одной позиции (предмет, зачарование, качество, количество) не редактируются — они у каждой позиции свои
function setStackItemFields(aggregate) {
  for (const id of STACK_ITEM_FIELDS) { const el = document.getElementById(id); if (el) el.disabled = aggregate; }
  if (craftEl.selected) craftEl.selected.style.display = aggregate ? 'none' : '';
}

// Приводит калькулятор в соответствие с выбором зелёных позиций: одна — обычный полный вид, несколько — общий вид
function applyStackSelection(fresh = false) {
  let on = stackSelected();
  if (on.length === 0) { craftStack.items.forEach((i) => { i.on = true; }); on = stackSelected(); }
  stackSave();
  if (on.length === 1) {
    const item = on[0];
    const changed = fresh || craftStack.aggregate || craftStack.activeUid !== item.uid;
    craftStack.aggregate = false;
    craftStack.activeUid = item.uid;
    setStackItemFields(false);
    renderStackPanel();
    if (changed) openStackItem(item);
    else stackRefreshOthers();
  } else {
    craftStack.aggregate = true;
    craftStack.activeUid = null;
    craftEl.controls.style.display = 'grid';                       // общие настройки (возврат, рынок, окна) нужны и в общем виде
    document.getElementById('craft-extra').style.display = 'block';
    setStackItemFields(true);
    renderStackPanel();
    renderAggregate();
    stackRefreshAll();
  }
}

// Одна позиция — в обычном виде калькулятора: поля заполняются её параметрами и идёт полный расчёт
function openStackItem(item) {
  stackSelecting = true;
  selectCraftItem(findItem(item.itemId), true);
  stackSelecting = false;
  craftEl.enchant.value = String(item.enchant);
  craftEl.quality.value = String(item.quality);
  craftEl.quantity.value = String(item.quantity);
  document.getElementById('craft-enchant-after').checked = !!item.after;
  lastCraftData = null;
  refreshSelectedIcon();
  runCraftCalc(false);
}

// Клик по карточке: из «все зелёные» — оставить только её; дальше — добавить/убрать; единственную зелёную клик возвращает к «все»
function pickStackItem(uid) {
  const items = craftStack.items;
  const item = items.find((i) => i.uid === uid);
  if (!item || items.length < 2) return;
  const on = stackSelected();
  if (on.length === items.length) items.forEach((i) => { i.on = i.uid === uid; });
  else if (item.on) { if (on.length === 1) items.forEach((i) => { i.on = true; }); else item.on = false; }
  else item.on = true;
  applyStackSelection();
}

// Поля калькулятора — это поля открытой (единственной зелёной) позиции: правка тира, зачарования, качества, количества попадает в стек
function stackSyncFromControls() {
  const item = stackActiveItem();
  if (!item || !craftSelectedItem) return;
  item.itemId = craftSelectedItem.id;
  item.enchant = Number(craftEl.enchant.value) || 0;
  item.quality = Number(craftEl.quality.value) || 1;
  item.quantity = Math.max(parseInt(craftEl.quantity.value, 10) || 1, 1);
  item.after = document.getElementById('craft-enchant-after').checked;
  stackSave();
}

// Ответ по открытой позиции: сохраняем и пересчитываем остальные (общие настройки калькулятора могли измениться)
function stackOnActiveResult(data) {
  const item = stackActiveItem();
  if (!item) return;
  stackResults.set(item.uid, data);
  renderStackPanel();
  stackRefreshOthers();
}

// Пересчёт позиций фоном: excludeUid — открытая позиция (её считает сам калькулятор); в общем виде считаются все
let stackRefreshTimer = null;
function stackRefreshOthers() { stackRefresh(craftStack && craftStack.activeUid); }
function stackRefreshAll() { stackRefresh(null); }
function stackRefresh(excludeUid) {
  clearTimeout(stackRefreshTimer);
  stackRefreshTimer = setTimeout(async () => {
    if (!craftStack) return;
    const token = ++stackToken;
    await Promise.all(craftStack.items.filter((i) => i.uid !== excludeUid).map(async (item) => {
      try {
        const data = await fetchJson(`/api/craft-calc?${craftParamsFor(stackSpec(item))}`);
        if (token === stackToken && craftStack) stackResults.set(item.uid, data.error ? { error: data.error } : data);
      } catch (err) {
        if (token === stackToken && craftStack) stackResults.set(item.uid, { error: err.message });
      }
      if (token === stackToken && craftStack) afterStackResults();
    }));
  }, 250);
}
function afterStackResults() {
  renderStackLines();
  renderStackSummary();
  if (craftStack.aggregate) {
    const first = stackSelected().map((i) => stackOk(i.uid)).find(Boolean);
    if (first) lastCraftData = first;            // автопересчёт калькулятора включается, когда есть хоть один результат
    renderAggregate();
  }
}

function removeStackItem(uid) {
  if (!craftStack) return;
  const idx = craftStack.items.findIndex((i) => i.uid === uid);
  if (idx < 0) return;
  const wasOpen = craftStack.activeUid === uid;
  craftStack.items.splice(idx, 1);
  stackResults.delete(uid);
  if (craftStack.items.length === 0) {
    craftFaction = null;
    exitCraftStack();
    renderFactionBadge();
    craftEl.result.innerHTML = '';
    lastCraftData = null;
    return;
  }
  renderFactionBadge();
  if (wasOpen) craftStack.activeUid = null;                      // открытую позицию убрали — калькулятор откроет следующую зелёную
  applyStackSelection();
}

function stackLine(item) {
  const d = stackResults.get(item.uid);
  if (!d) return '<small class="stack-wait">считаю…</small>';
  if (d.error) return `<small class="scan-stale">${d.error}</small>`;
  const points = d.faction ? d.faction.pointsPerCape * item.quantity : null;
  const profitCls = d.totalProfit > 0 ? 'profit-pos' : d.totalProfit < 0 ? 'profit-neg' : '';
  const warn = (d.recipe && d.recipe.some((r) => r.manual)) || d.manualSale ? ' <span class="fp-warn" title="В расчёте есть вписанные вручную цены — недостоверные">⚠</span>' : '';
  return `вложения <b>${d.hasAllMaterialPrices === false ? '—' : stackNum(d.totalCost)}</b> · профит <b class="${profitCls}">${d.totalProfit === null ? 'нет цены продажи' : stackNum(d.totalProfit)}</b> · очков ${stackNum(points)}${warn}`;
}

function renderStackLines() {
  if (!stackPanel || !craftStack) return;
  for (const item of craftStack.items) {
    const el = stackPanel.querySelector(`.stack-card[data-uid="${item.uid}"] .stack-line`);
    if (el) el.innerHTML = stackLine(item);
  }
}

function renderStackPanel() {
  if (!stackPanel || !craftStack) return;
  stackPanel.hidden = false;
  const cards = craftStack.items.map((item) => {
    const base = findItem(item.itemId) || { id: item.itemId, name: item.itemId };
    return `<div class="stack-card ${item.on ? 'is-on' : 'is-off'}" data-uid="${item.uid}">
      <button type="button" class="stack-pick" title="${item.on ? 'В расчёте (зелёная). Клик — оставить только её или убрать из расчёта' : 'Не в расчёте (серая). Клик — добавить в расчёт'}"><img class="item-icon-sm" src="${iconUrl(base.id, 64, item.enchant, item.quality)}" alt="" onerror="this.style.visibility='hidden'" />
        <span>${base.name}${enchantTag(item.enchant)}<br><small class="scan-item-sub">T${base.tier} · .${item.enchant} · ${QUALITY_NAMES[item.quality]}${item.after ? ' · чары после крафта' : ''}</small></span></button>
      <label class="stack-qty-label">шт <input class="stack-qty" type="number" min="1" step="1" value="${item.quantity}" /></label>
      <label class="stack-check" title="Купить герб на рынке за серебро вместо очков"><input type="checkbox" class="stack-crest" ${item.crestSilver ? 'checked' : ''} /> герб за серебро</label>
      <label class="stack-check" title="Купить сердце на рынке за серебро вместо очков"><input type="checkbox" class="stack-heart" ${item.heartSilver ? 'checked' : ''} /> сердце за серебро</label>
      <button type="button" class="stack-remove" title="Убрать позицию из калькулятора">✕</button>
      <span class="stack-line">${stackLine(item)}</span></div>`;
  }).join('');
  const all = craftStack.items.every((i) => i.on);
  stackPanel.innerHTML = `<div class="faction-plan stack-shell">
    <h4>Стек плащей · ${craftFaction ? craftFaction.name : ''} <small>${all ? 'в расчёте все позиции — клик по позиции откроет только её' : 'зелёные — в расчёте, серые — нет; клик добавляет/убирает'}</small>
      ${all || craftStack.items.length < 2 ? '' : '<button type="button" id="stack-all" class="stack-all">Все в расчёт</button>'}</h4>
    <div id="stack-summary" class="craft-summary"></div>
    <div class="stack-cards">${cards}</div></div>`;
  renderStackSummary();
  bindStackPanel();
}

// Сводка по зелёным позициям: очки, вложения, профит
function stackTotals() {
  const on = stackSelected();
  const t = { items: on.length, capes: on.reduce((s, i) => s + i.quantity, 0), cost: 0, profit: 0, points: 0, patient: 0, patientAll: true, noPrice: 0, pending: 0, errors: 0 };
  for (const item of on) {
    const raw = stackResults.get(item.uid);
    if (!raw) { t.pending++; continue; }
    if (raw.error) { t.errors++; continue; }
    if (raw.hasAllMaterialPrices === false || raw.totalProfit === null) { t.noPrice++; continue; }
    t.cost += raw.totalCost;
    t.profit += raw.totalProfit;
    if (raw.faction) t.points += raw.faction.pointsPerCape * item.quantity;
    if (raw.patientSell && raw.patientSell.profitPerUnit !== null && raw.patientSell.profitPerUnit !== undefined) t.patient += raw.patientSell.profitPerUnit * item.quantity;
    else t.patientAll = false;
  }
  return t;
}

function renderStackSummary() {
  const box = document.getElementById('stack-summary');
  if (!box || !craftStack) return;
  const t = stackTotals();
  const avail = craftFaction ? craftFaction.points : 0;
  const over = t.points > avail;
  box.innerHTML = `
    <div class="craft-summary-row"><span>В расчёте: позиций / плащей</span><span>${t.items} из ${craftStack.items.length} / ${stackNum(t.capes)}</span></div>
    <div class="craft-summary-row"><span>Очков нужно из ${stackNum(avail)}</span><span class="${over ? 'profit-neg' : ''}">${stackNum(t.points)}${over ? ` · не хватает ${stackNum(t.points - avail)}` : ` · остаток ${stackNum(avail - t.points)}`}</span></div>
    <div class="craft-summary-row"><span>Вложения серебром</span><span>${stackNum(t.cost)}</span></div>
    <div class="craft-summary-row"><strong>Профит по зелёным позициям</strong><strong class="${t.profit >= 0 ? 'profit-pos' : 'profit-neg'}">${stackNum(t.profit)}</strong></div>
    ${t.noPrice || t.pending || t.errors ? `<div class="craft-summary-row"><span class="scan-stale">${t.pending ? `Считается позиций: ${t.pending}. ` : ''}${t.noPrice ? `Без цены материалов или продажи (не в итогах): ${t.noPrice}. ` : ''}${t.errors ? `С ошибкой: ${t.errors}` : ''}</span><span></span></div>` : ''}`;
}

// Общий вид: сводные показатели и один список закупки по всем зелёным позициям. Каждая позиция считается отдельно (как в обычном крафте),
// здесь результаты складываются: количества материалов — суммой, города — вместе.
function stackPurchaseRows() {
  const map = new Map();
  for (const item of stackSelected()) {
    const data = stackOk(item.uid);
    if (!data) continue;
    for (const row of acquisitionRowsData(data)) {
      const entry = map.get(row.id) || { id: row.id, name: itemLabel(row.id), needed: 0, cost: 0, unknown: false, cities: new Map() };
      entry.needed += row.needed;
      const plan = row.srv && row.srv.plan && row.srv.plan.cities.length && row.srv.plan.cities.reduce((s, c) => s + c.qty, 0) === row.needed ? row.srv.plan : null;
      const addCity = (city, qty, price) => {
        const cur = entry.cities.get(city) || { qty: 0, cost: 0 };
        cur.qty += qty;
        cur.cost += qty * price;
        entry.cities.set(city, cur);
        entry.cost += qty * price;
      };
      if (plan) plan.cities.forEach((c) => addCity(c.city, c.qty, c.avgPrice));
      else {
        const price = row.srv && row.srv.unitPrice ? row.srv.unitPrice : row.fallbackPrice;
        if (price === null || price === undefined) entry.unknown = true;
        else addCity(row.fallbackCity || '—', row.needed, price);
      }
      map.set(row.id, entry);
    }
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost);
}

function renderAggregate() {
  if (!craftStack || !craftStack.aggregate) return;
  const t = stackTotals();
  const avail = craftFaction ? craftFaction.points : 0;
  const rows = stackPurchaseRows();
  const total = rows.reduce((s, r) => s + r.cost, 0);
  const cls = (n) => (n > 0 ? 'profit-pos' : n < 0 ? 'profit-neg' : '');
  const body = rows.map((r) => `<tr>
      <td class="copyable" data-copy-id="${r.id}" title="Клик — скопировать название для поиска в аукционе"><img class="item-icon-sm" src="${iconUrl(r.id, 40)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" /> ${r.name}</td>
      <td>${stackNum(r.needed)}</td>
      <td class="plan-cities">${[...r.cities.entries()].map(([city, c]) => `${city}: ${stackNum(c.qty)} шт по ${stackNum(c.cost / c.qty, c.cost / c.qty < 100 ? 1 : 0)}`).join('<br>') || '—'}${r.unknown ? '<br><small class="scan-stale">часть без цены</small>' : ''}</td>
      <td data-sort-value="${r.cost}">${r.unknown && !r.cost ? '—' : stackNum(r.cost)}</td></tr>`).join('');
  craftEl.result.innerHTML = `
    <div class="craft-scoreboard stack-scoreboard">
      <div class="sb-cell sb-cost"><span class="sb-label">Нужно денег на все зелёные позиции</span><b class="sb-value">${stackNum(t.cost)}</b><small>${t.items} поз. · ${stackNum(t.capes)} плащей</small></div>
      <div class="sb-cell"><span class="sb-label">Маржа всего · сразу (Buy Order)</span><b class="sb-value ${cls(t.profit)}">${stackNum(t.profit)}</b><small>${t.cost > 0 ? `${stackNum((t.profit / t.cost) * 100, 0)}% к вложениям` : ''}</small></div>
      <div class="sb-cell"><span class="sb-label">Маржа всего · терпеливо (Sell Order)</span><b class="sb-value ${t.patientAll ? cls(t.patient) : ''}">${t.patientAll && t.items ? stackNum(t.patient) : '—'}</b><small>${t.patientAll ? 'по плану продажи каждой позиции' : 'нет плана продажи у части позиций'}</small></div>
      <div class="sb-cell faction-tile"><span class="sb-label">Фракционные очки · ${craftFaction ? craftFaction.name : ''}</span><b class="sb-value ${t.points > avail ? 'profit-neg' : ''}">${stackNum(t.points)}</b><small>из ${stackNum(avail)}${t.points > avail ? ` · не хватает ${stackNum(t.points - avail)}` : ` · остаток ${stackNum(avail - t.points)}`}${t.points > 0 ? ` · ${stackNum(t.profit / t.points, 1)} профита на очко` : ''}</small></div>
    </div>
    ${t.noPrice || t.pending || t.errors ? `<p class="calc-note">${t.pending ? `Считается позиций: ${t.pending}. ` : ''}${t.noPrice ? `Без цены материалов или продажи (в итоги не входят): ${t.noPrice}. ` : ''}${t.errors ? `С ошибкой: ${t.errors}.` : ''}</p>` : ''}
    <h4 class="plan-title">Закупить для всего стека <small>сумма по зелёным позициям; каждая считается отдельно — клик по позиции покажет её подробный план закупки</small></h4>
    ${rows.length ? `<div class="table-scroll"><table class="craft-recipe-table" id="stack-purchase-table">
      <thead><tr><th>Что покупаем</th><th>Нужно, шт</th><th>Города закупки</th><th>Сумма</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr class="materials-total"><td colspan="3">Итого на закупку</td><td>${stackNum(total)}</td></tr></tfoot></table></div>
    <p class="calc-note">Складываются количества и цены по отдельности посчитанных позиций: если одинаковый материал нужен в нескольких позициях, общий объём мог бы поднять цену чуть выше. Герб и сердце за очки в закупку не входят.</p>` : '<div class="chart-empty">Считаю позиции…</div>'}`;
}

function bindStackPanel() {
  const all = document.getElementById('stack-all');
  if (all) all.addEventListener('click', () => { craftStack.items.forEach((i) => { i.on = true; }); applyStackSelection(); });
  stackPanel.querySelectorAll('.stack-card').forEach((card) => {
    const uid = card.dataset.uid;
    const item = craftStack.items.find((i) => i.uid === uid);
    card.querySelector('.stack-pick').addEventListener('click', () => pickStackItem(uid));
    card.querySelector('.stack-remove').addEventListener('click', () => removeStackItem(uid));
    let timer = null;
    const changed = () => {
      stackSave();
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!craftStack) return;
        if (uid === craftStack.activeUid) {                          // открытая позиция — поля калькулятора отражают карточку
          craftEl.quantity.value = String(item.quantity);
          runCraftCalc(true);
        } else {
          stackResults.delete(uid);
          renderStackLines();
          refreshOne(item);
        }
      }, 400);
    };
    card.querySelector('.stack-qty').addEventListener('input', (e) => { item.quantity = Math.max(parseInt(e.target.value, 10) || 1, 1); changed(); });
    card.querySelector('.stack-crest').addEventListener('change', (e) => { item.crestSilver = e.target.checked; changed(); });
    card.querySelector('.stack-heart').addEventListener('change', (e) => { item.heartSilver = e.target.checked; changed(); });
  });
}

async function refreshOne(item) {
  const token = stackToken;
  try {
    const data = await fetchJson(`/api/craft-calc?${craftParamsFor(stackSpec(item))}`);
    if (token === stackToken && craftStack) stackResults.set(item.uid, data.error ? { error: data.error } : data);
  } catch (err) {
    if (token === stackToken && craftStack) stackResults.set(item.uid, { error: err.message });
  }
  if (craftStack) afterStackResults();
}

// Восстановление стека после перезагрузки страницы
function stackRestore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STACK_KEY) || 'null');
    if (!saved || !saved.faction || !Array.isArray(saved.items) || saved.items.length === 0) return;
    enterCraftStack(saved.faction, saved.items);
  } catch (e) { /* повреждённое сохранение — пропускаем */ }
}
Promise.all([itemsReady, craftReady]).then(stackRestore);
