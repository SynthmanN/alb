// Стек фракционных плащей в калькуляторе: позиции из плана трат очков (зелёные строки) переносятся сюда одной кнопкой. Каждая позиция считается
// тем же /api/craft-calc, что и обычный крафт (открытая позиция — полным видом калькулятора, остальные — фоном), сверху — общая сводка:
// очки, вложения, профит и суммарный список закупки. Герб и сердце можно купить за серебро на рынке вместо очков — переключатель у позиции.
// Стек хранится в браузере (localStorage): после перезагрузки страницы он на месте.
const STACK_KEY = 'albion_craft_stack';
const stackResults = new Map();      // uid → ответ /api/craft-calc (или { error })
let stackToken = 0;                  // номер последнего фонового пересчёта — устаревшие ответы отбрасываются
let stackUidCounter = 0;
const stackPanel = document.getElementById('craft-stack-panel');

const stackNum = (n, d = 0) => (n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: d }));
const stackActiveItem = () => (craftStack ? craftStack.items.find((i) => i.uid === craftStack.activeUid) || null : null);
const stackPartsSilver = (item) => (item ? [item.crestSilver ? 'crest' : null, item.heartSilver ? 'heart' : null].filter(Boolean) : []);
const stackSpec = (item) => ({ itemId: item.itemId, enchant: item.enchant, quality: item.quality, quantity: item.quantity, after: item.after, partsSilver: stackPartsSilver(item) });

function stackSave() {
  try {
    if (!craftStack || !craftFaction) localStorage.removeItem(STACK_KEY);
    else localStorage.setItem(STACK_KEY, JSON.stringify({ faction: craftFaction, items: craftStack.items, activeUid: craftStack.activeUid }));
  } catch (e) { /* хранилище недоступно — стек живёт до перезагрузки */ }
}

// Вход в режим стека: items — позиции {itemId, enchant, quality, quantity, after, crestSilver, heartSilver}; заменяет прежний стек
function enterCraftStack(faction, items, activeIndex = 0) {
  const list = items.filter((i) => findItem(i.itemId) && i.quantity > 0).map((i) => ({ ...i, uid: `s${++stackUidCounter}` }));
  if (list.length === 0) return;
  stackResults.clear();
  craftFaction = { id: faction.id, name: faction.name, points: faction.points };
  craftStack = { items: list, activeUid: null };
  renderFactionBadge();
  stackSave();
  activateStackItem(list[Math.min(Math.max(activeIndex, 0), list.length - 1)].uid);
}

// Выход: стек и его сохранение очищаются (фракционный режим калькулятора выключает вызывающий код)
function exitCraftStack() {
  craftStack = null;
  stackResults.clear();
  stackToken++;
  stackSave();
  if (stackPanel) { stackPanel.hidden = true; stackPanel.innerHTML = ''; }
}

// Открывает позицию в обычном виде калькулятора: поля заполняются её параметрами и идёт полный расчёт
function activateStackItem(uid) {
  const item = craftStack.items.find((i) => i.uid === uid);
  if (!item) return;
  craftStack.activeUid = uid;
  stackSelecting = true;
  selectCraftItem(findItem(item.itemId), true);
  stackSelecting = false;
  craftEl.enchant.value = String(item.enchant);
  craftEl.quality.value = String(item.quality);
  craftEl.quantity.value = String(item.quantity);
  document.getElementById('craft-enchant-after').checked = !!item.after;
  lastCraftData = null;
  refreshSelectedIcon();
  renderStackPanel();
  runCraftCalc(false);
}

// Поля калькулятора — это поля открытой позиции: правка предмета (тир), зачарования, качества, количества попадает в стек
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

let stackRefreshTimer = null;
function stackRefreshOthers() {
  clearTimeout(stackRefreshTimer);
  stackRefreshTimer = setTimeout(async () => {
    if (!craftStack) return;
    const token = ++stackToken;
    const active = stackActiveItem();
    await Promise.all(craftStack.items.filter((i) => !active || i.uid !== active.uid).map(async (item) => {
      try {
        const data = await fetchJson(`/api/craft-calc?${craftParamsFor(stackSpec(item))}`);
        if (token === stackToken && craftStack) stackResults.set(item.uid, data.error ? { error: data.error } : data);
      } catch (err) {
        if (token === stackToken && craftStack) stackResults.set(item.uid, { error: err.message });
      }
      if (token === stackToken && craftStack) { renderStackLines(); renderStackSummary(); }
    }));
  }, 250);
}

function removeStackItem(uid) {
  if (!craftStack) return;
  const idx = craftStack.items.findIndex((i) => i.uid === uid);
  if (idx < 0) return;
  const wasActive = craftStack.activeUid === uid;
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
  stackSave();
  if (wasActive) activateStackItem(craftStack.items[Math.min(idx, craftStack.items.length - 1)].uid);
  else { renderFactionBadge(); renderStackPanel(); }
}

function stackLine(item) {
  const d = stackResults.get(item.uid);
  if (!d) return '<small class="stack-wait">считаю…</small>';
  if (d.error) return `<small class="scan-stale">${d.error}</small>`;
  const points = d.faction ? d.faction.pointsPerCape * item.quantity : null;
  const profitCls = d.totalProfit > 0 ? 'profit-pos' : d.totalProfit < 0 ? 'profit-neg' : '';
  const warn = d.recipe && d.recipe.some((r) => r.manual) || d.manualSale ? ' <span class="fp-warn" title="В расчёте есть вписанные вручную цены — недостоверные">⚠</span>' : '';
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
    const active = item.uid === craftStack.activeUid;
    return `<div class="stack-card ${active ? 'is-active' : ''}" data-uid="${item.uid}">
      <button type="button" class="stack-pick" title="Открыть позицию в калькуляторе"><img class="item-icon-sm" src="${iconUrl(base.id, 64, item.enchant, item.quality)}" alt="" onerror="this.style.visibility='hidden'" />
        <span>${base.name}${enchantTag(item.enchant)}<br><small class="scan-item-sub">T${base.tier} · .${item.enchant} · ${QUALITY_NAMES[item.quality]}${item.after ? ' · чары после крафта' : ''}</small></span></button>
      <label class="stack-qty-label">шт <input class="stack-qty" type="number" min="1" step="1" value="${item.quantity}" /></label>
      <label class="stack-check" title="Купить герб на рынке за серебро вместо очков"><input type="checkbox" class="stack-crest" ${item.crestSilver ? 'checked' : ''} /> герб за серебро</label>
      <label class="stack-check" title="Купить сердце на рынке за серебро вместо очков"><input type="checkbox" class="stack-heart" ${item.heartSilver ? 'checked' : ''} /> сердце за серебро</label>
      <button type="button" class="stack-remove" title="Убрать позицию из калькулятора">✕</button>
      <span class="stack-line">${stackLine(item)}</span></div>`;
  }).join('');
  stackPanel.innerHTML = `<div class="faction-plan stack-shell">
    <h4>Стек плащей · ${craftFaction ? craftFaction.name : ''} <small>позиция открыта ниже в обычном калькуляторе — можно править параметры, цены, план продажи</small></h4>
    <div id="stack-summary" class="craft-summary"></div>
    <div class="stack-cards">${cards}</div></div>`;
  renderStackSummary();
  bindStackPanel();
}

function renderStackSummary() {
  const box = document.getElementById('stack-summary');
  if (!box || !craftStack) return;
  const items = craftStack.items;
  const done = items.filter((i) => stackResults.get(i.uid) && !stackResults.get(i.uid).error);
  let cost = 0;
  let profit = 0;
  let points = 0;
  let noPrice = 0;
  const buy = new Map();
  for (const item of done) {
    const d = stackResults.get(item.uid);
    if (d.hasAllMaterialPrices === false || d.totalProfit === null) { noPrice++; continue; }
    cost += d.totalCost;
    profit += d.totalProfit;
    if (d.faction) points += d.faction.pointsPerCape * item.quantity;
    for (const r of d.recipe || []) {
      if (r.materialSource !== 'buy' || !(r.neededToBuy > 0)) continue;
      const cur = buy.get(r.resource) || { name: r.resourceName, count: 0, cost: 0 };
      cur.count += r.neededToBuy;
      cur.cost += r.neededToBuy * (r.cheapestPrice || 0);
      buy.set(r.resource, cur);
    }
  }
  const capes = items.reduce((s, i) => s + i.quantity, 0);
  const avail = craftFaction ? craftFaction.points : 0;
  const over = points > avail;
  const pending = items.length - done.length;
  const buyList = [...buy.values()].sort((a, b) => b.cost - a.cost);
  box.innerHTML = `
    <div class="craft-summary-row"><span>Позиций / плащей</span><span>${items.length} / ${stackNum(capes)}</span></div>
    <div class="craft-summary-row"><span>Очков нужно из ${stackNum(avail)}</span><span class="${over ? 'profit-neg' : ''}">${stackNum(points)}${over ? ` · не хватает ${stackNum(points - avail)}` : ` · остаток ${stackNum(avail - points)}`}</span></div>
    <div class="craft-summary-row"><span>Вложения серебром</span><span>${stackNum(cost)}</span></div>
    <div class="craft-summary-row"><strong>Профит стека</strong><strong class="${profit >= 0 ? 'profit-pos' : 'profit-neg'}">${stackNum(profit)}</strong></div>
    ${noPrice || pending ? `<div class="craft-summary-row"><span class="scan-stale">${pending ? `Считается позиций: ${pending}. ` : ''}${noPrice ? `Без цены материалов или продажи (не в итогах): ${noPrice}` : ''}</span><span></span></div>` : ''}
    ${buyList.length ? `<details class="stack-buy"><summary>Закупить на рынке (материалов: ${buyList.length})</summary><table class="craft-recipe-table"><thead><tr><th>Материал</th><th>Штук</th><th>≈ Серебра</th></tr></thead><tbody>${buyList.map((b) => `<tr><td>${b.name}</td><td>${stackNum(b.count)}</td><td>${stackNum(b.cost)}</td></tr>`).join('')}</tbody></table><p class="calc-note">Сумма по позициям: каждая считается отдельно, поэтому общий объём одинаковых материалов мог бы поднять цену выше — детали по городам см. в открытой позиции.</p></details>` : ''}`;
}

function bindStackPanel() {
  stackPanel.querySelectorAll('.stack-card').forEach((card) => {
    const uid = card.dataset.uid;
    const item = craftStack.items.find((i) => i.uid === uid);
    card.querySelector('.stack-pick').addEventListener('click', () => { if (craftStack.activeUid !== uid) activateStackItem(uid); });
    card.querySelector('.stack-remove').addEventListener('click', () => removeStackItem(uid));
    let timer = null;
    const changed = () => {
      stackSave();
      clearTimeout(timer);
      timer = setTimeout(() => {
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
  if (craftStack) { renderStackLines(); renderStackSummary(); }
}

// Восстановление стека после перезагрузки страницы
function stackRestore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STACK_KEY) || 'null');
    if (!saved || !saved.faction || !Array.isArray(saved.items) || saved.items.length === 0) return;
    enterCraftStack(saved.faction, saved.items, Math.max(saved.items.findIndex((i) => i.uid === saved.activeUid), 0));
  } catch (e) { /* повреждённое сохранение — пропускаем */ }
}
Promise.all([itemsReady, craftReady]).then(stackRestore);
