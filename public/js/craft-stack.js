// Стек фракционных плащей в калькуляторе: позиции из плана трат очков (зелёные строки) переносятся сюда одной кнопкой. Каждая позиция считается
// тем же /api/craft-calc, что и обычный крафт. Позиции бывают «в расчёте» (зелёные) и серые: по умолчанию зелёные все — калькулятор показывает
// общий вид (общий профит и сводный список закупки по всем зелёным). Клик по позиции оставляет зелёной только её — калькулятор показывает её
// обычным полным видом; дальше клики по серым добавляют их в расчёт, по зелёным — убирают (клик по единственной зелёной возвращает «все»).
// Цена продажи позиции — из плана (средняя по истории сделок, как в плане), её можно заменить своей; недостающие цены материалов вписываются в карточке.
// «Зачаровать после крафта» — галочка на весь стек: применяется к позиции, только если её профит с чарами выше на 7% и больше.
// Герб и сердце можно купить за серебро на рынке вместо очков — переключатель у позиции. Стек хранится в браузере (localStorage).
const STACK_KEY = 'albion_craft_stack';
const AFTER_GAIN = 0.07;             // «чары после крафта» выбираются, если профит выше на 7% и больше
const stackResults = new Map();      // uid → ответ /api/craft-calc (или { error })
const stackPairs = new Map();        // uid → { direct, after }: оба варианта позиции (для автовыбора «после крафта»)
let stackToken = 0;                  // номер последнего пересчёта — устаревшие ответы отбрасываются
let stackUidCounter = 0;
const stackPanel = document.getElementById('craft-stack-panel');
const STACK_ITEM_FIELDS = ['craft-enchant', 'craft-quality', 'craft-quantity', 'craft-enchant-after'];   // поля одной позиции: в общем виде недоступны

const stackNum = (n, d = 0) => (n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: d }));
const stackActiveItem = () => (craftStack && craftStack.activeUid ? craftStack.items.find((i) => i.uid === craftStack.activeUid) || null : null);
const stackSelected = () => (craftStack ? craftStack.items.filter((i) => i.on) : []);
const stackPartsSilver = (item) => (item ? [item.crestSilver ? 'crest' : null, item.heartSilver ? 'heart' : null].filter(Boolean) : []);
const stackAfterPossible = (item) => item.enchant >= 1 && item.enchant <= 3;                 // чары после крафта возможны до .3
const stackAutoAfter = (item) => !!craftStack && craftStack.autoAfter && stackAfterPossible(item);
const stackSpec = (item, after = item.after) => ({ itemId: item.itemId, enchant: item.enchant, quality: item.quality, quantity: item.quantity, after: !!after && stackAfterPossible(item), partsSilver: stackPartsSilver(item) });
const stackOk = (uid) => { const d = stackResults.get(uid); return d && !d.error ? d : null; };

function stackSave() {
  try {
    if (!craftStack || !craftFaction) localStorage.removeItem(STACK_KEY);
    else localStorage.setItem(STACK_KEY, JSON.stringify({ faction: craftFaction, items: craftStack.items, autoAfter: craftStack.autoAfter }));
  } catch (e) { /* хранилище недоступно — стек живёт до перезагрузки */ }
}

// Недостающие цены материалов в ответе (у деталей за очки цены нет и не нужно): их можно вписать — расчёт подхватит
function stackMissing(d) {
  const out = [];
  const label = (id, fallback) => (d.names && d.names[id]) || fallback || id;
  const eac = d.enchantAfterCraft;
  if (!(eac && eac.baseSource === 'buy')) {
    for (const r of d.recipe || []) if (r.materialSource !== 'points' && r.cheapestPrice === null) out.push({ id: r.queryId || r.resource, label: label(r.queryId || r.resource, r.resourceName) });
  }
  for (const st of (eac && eac.steps) || []) if (st.cheapestPrice === null) out.push({ id: st.materialId, label: st.materialName });
  return out;
}

// Профит позиции: цена продажи из плана (или своя) за вычетом налога и Setup Fee и себестоимости из калькулятора; нет цены продажи — терпеливая
// продажа калькулятора, а если и её нет — мгновенная. null — не хватает данных (цены материала или продажи)
function stackProfitOf(item, d) {
  if (!d || d.error || stackMissing(d).length) return null;
  const cost = d.effectiveCostPerUnit;
  if (cost === null || cost === undefined) return null;
  const gross = item.salePriceOwn !== undefined ? item.salePriceOwn : item.salePrice;
  if (gross > 0) return { unit: gross * (1 - d.taxRate - (d.setupFeeRate || 0)) - cost, basis: 'plan' };
  const p = d.patientSell;
  if (p) {
    const unit = p.plan && p.plan.cities && p.plan.cities.length ? p.plan.profitPerUnit : p.profitPerUnit;
    if (unit !== null && unit !== undefined) return { unit, basis: 'patient' };
  }
  if (d.profitPerUnit !== null && d.profitPerUnit !== undefined) return { unit: d.profitPerUnit, basis: 'instant' };
  return null;
}

// Автовыбор «после крафта»: чары после крафта — если профит выше на 7% и больше (а прямой путь без данных — если хоть какие-то есть)
function decideAfter(item, pair) {
  const pd = stackProfitOf(item, pair.direct);
  const pa = stackProfitOf(item, pair.after);
  if (!pa) return false;
  if (!pd) return true;
  return pa.unit > pd.unit + AFTER_GAIN * Math.abs(pd.unit);
}

// Вход в режим стека: items — позиции {itemId, enchant, quality, quantity, after, crestSilver, heartSilver, salePrice, on}; заменяет прежний стек
function enterCraftStack(faction, items, opts = {}) {
  const list = items.filter((i) => findItem(i.itemId) && i.quantity > 0).map((i) => ({ ...i, on: i.on !== false, uid: `s${++stackUidCounter}` }));
  if (list.length === 0) return;
  if (!list.some((i) => i.on)) list.forEach((i) => { i.on = true; });
  stackResults.clear();
  stackPairs.clear();
  craftFaction = { id: faction.id, name: faction.name, points: faction.points };
  craftStack = { items: list, activeUid: null, aggregate: false, autoAfter: opts.autoAfter !== false };
  renderFactionBadge();
  applyStackSelection(true);
}

// Выход: стек и его сохранение очищаются (фракционный режим калькулятора выключает вызывающий код)
function exitCraftStack() {
  craftStack = null;
  stackResults.clear();
  stackPairs.clear();
  stackToken++;
  stackSave();
  setStackItemFields(false);
  if (stackPanel) { stackPanel.hidden = true; stackPanel.innerHTML = ''; }
}

// В общем виде поля одной позиции (предмет, зачарование, качество, количество) не редактируются — они у каждой позиции свои;
// «после крафта» у позиции, которую ведёт автовыбор, тоже не правится вручную
function setStackItemFields(aggregate) {
  for (const id of STACK_ITEM_FIELDS) { const el = document.getElementById(id); if (el) el.disabled = aggregate; }
  if (craftEl.selected) craftEl.selected.style.display = aggregate ? 'none' : '';
  const after = document.getElementById('craft-enchant-after');
  const item = stackActiveItem();
  if (after && !aggregate) {
    const auto = !!item && stackAutoAfter(item);
    after.disabled = auto;
    after.title = auto ? 'В стеке «после крафта» выбирается само по галочке стека (профит выше на 7% и больше)' : '';
  }
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
  document.getElementById('craft-enchant-after').checked = !!item.after && stackAfterPossible(item);
  setStackItemFields(false);
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

// Ответ по открытой позиции: сохраняем, при автовыборе сравниваем с другим вариантом («после крафта»/прямой), пересчитываем остальные
function stackOnActiveResult(data) {
  const item = stackActiveItem();
  if (!item) return;
  stackResults.set(item.uid, data);
  renderStackPanel();
  stackRefreshOthers();
  if (stackAutoAfter(item)) stackDecideActive(item, data);
}
async function stackDecideActive(item, data) {
  const thisAfter = !!item.after;
  const other = await fetchStackItem(item, !thisAfter);
  if (!craftStack || stackActiveItem() !== item || !!item.after !== thisAfter) return;
  const pair = thisAfter ? { direct: other, after: data } : { direct: data, after: other };
  stackPairs.set(item.uid, pair);
  const choice = decideAfter(item, pair);
  if (choice !== thisAfter) {                                     // другой вариант выгоднее на 7%+ (или наоборот) — переключаем и пересчитываем
    item.after = choice;
    document.getElementById('craft-enchant-after').checked = choice;
    stackSave();
    runCraftCalc(true);
  } else {
    renderStackLines();
    renderStackSummary();
  }
}

async function fetchStackItem(item, after = item.after) {
  try {
    const d = await fetchJson(`/api/craft-calc?${craftParamsFor(stackSpec(item, after))}`);
    return d.error ? { error: d.error } : d;
  } catch (err) {
    return { error: err.message };
  }
}

// Считает позицию: при автовыборе — оба варианта и выбор по 7%, иначе один запрос
async function stackCalcItem(item) {
  if (stackAutoAfter(item)) {
    const [direct, after] = await Promise.all([fetchStackItem(item, false), fetchStackItem(item, true)]);
    return { pair: { direct, after } };
  }
  return { data: await fetchStackItem(item) };
}
function stackApplyCalc(item, res) {
  if (res.pair) {
    stackPairs.set(item.uid, res.pair);
    item.after = decideAfter(item, res.pair);
    stackResults.set(item.uid, item.after ? res.pair.after : res.pair.direct);
  } else {
    stackPairs.delete(item.uid);
    stackResults.set(item.uid, res.data);
  }
  stackSave();
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
      const res = await stackCalcItem(item);
      if (token === stackToken && craftStack) { stackApplyCalc(item, res); afterStackResults(); }
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
async function refreshOne(item) {
  const token = stackToken;
  const res = await stackCalcItem(item);
  if (token === stackToken && craftStack) { stackApplyCalc(item, res); afterStackResults(); }
}

function removeStackItem(uid) {
  if (!craftStack) return;
  const idx = craftStack.items.findIndex((i) => i.uid === uid);
  if (idx < 0) return;
  const wasOpen = craftStack.activeUid === uid;
  craftStack.items.splice(idx, 1);
  stackResults.delete(uid);
  stackPairs.delete(uid);
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
  const missing = stackMissing(d).length > 0;
  const pf = stackProfitOf(item, d);
  const total = pf ? pf.unit * item.quantity : null;
  const profitCls = total > 0 ? 'profit-pos' : total < 0 ? 'profit-neg' : '';
  const warn = (d.recipe && d.recipe.some((r) => r.manual)) || d.manualSale ? ' <span class="fp-warn" title="В расчёте есть вписанные вручную цены — недостоверные">⚠</span>' : '';
  const basis = pf && pf.basis !== 'plan' ? ` <small class="scan-stale" title="Цены продажи из плана нет — профит по ${pf.basis === 'patient' ? 'плану терпеливой продажи калькулятора' : 'мгновенной продаже'}; впиши свою цену продажи">(${pf.basis === 'patient' ? 'терпеливо' : 'мгновенно'})</small>` : '';
  let afterNote = '';
  if (item.after) {
    const pair = stackPairs.get(item.uid);
    const pd = pair && stackProfitOf(item, pair.direct);
    afterNote = ` · чары после крафта${pd && pf && pd.unit !== 0 ? ` (+${stackNum(((pf.unit - pd.unit) / Math.abs(pd.unit)) * 100, 0)}% к профиту)` : ''}`;
  }
  return `вложения <b>${missing ? '—' : stackNum(d.totalCost)}</b> · профит <b class="${profitCls}">${total === null ? (missing ? 'не хватает цен' : 'нет цены продажи') : stackNum(total)}</b>${basis} · очков ${stackNum(points)}${afterNote}${warn}`;
}

function renderStackLines() {
  if (!stackPanel || !craftStack) return;
  for (const item of craftStack.items) {
    const card = stackPanel.querySelector(`.stack-card[data-uid="${item.uid}"]`);
    if (!card) continue;
    card.querySelector('.stack-line').innerHTML = stackLine(item);
    renderStackMissing(item, card);
  }
}

// Недостающие цены материалов: поля прямо в карточке; вписанное сохраняется на сервере (общее, недостоверное, до 10 дней) и подхватывается расчётом
function renderStackMissing(item, card) {
  const box = card.querySelector('.stack-missing');
  const d = stackResults.get(item.uid);
  const list = d && !d.error ? stackMissing(d) : [];
  const key = list.map((m) => m.id).join('|');
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  if (list.length === 0) { box.innerHTML = ''; return; }
  box.innerHTML = `<span class="fp-missing-title">Не хватает цен материалов (впиши свою — расчёт подхватит):</span> ${list.map((m) => `<label class="fp-chip">${m.label}<input class="fp-input stack-mat" type="number" min="0" step="1" data-id="${m.id}" placeholder="цена" /></label>`).join('')}`;
  box.querySelectorAll('input.stack-mat').forEach((inp) => {
    let timer = null;
    inp.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const price = parseFloat(inp.value);
        if (!(price > 0)) return;
        try {
          await fetch('/api/manual-price', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: inp.dataset.id, quality: 1, price }) });
        } catch (e) { return; }
        if (!craftStack) return;
        if (item.uid === craftStack.activeUid) runCraftCalc(true); else refreshOne(item);
      }, 700);
    });
  });
}

function renderStackPanel() {
  if (!stackPanel || !craftStack) return;
  stackPanel.hidden = false;
  const cards = craftStack.items.map((item) => {
    const base = findItem(item.itemId) || { id: item.itemId, name: item.itemId };
    const own = item.salePriceOwn !== undefined ? item.salePriceOwn : '';
    return `<div class="stack-card ${item.on ? 'is-on' : 'is-off'}" data-uid="${item.uid}">
      <button type="button" class="stack-pick" title="${item.on ? 'В расчёте (зелёная). Клик — оставить только её или убрать из расчёта' : 'Не в расчёте (серая). Клик — добавить в расчёт'}"><img class="item-icon-sm" src="${iconUrl(base.id, 64, item.enchant, item.quality)}" alt="" onerror="this.style.visibility='hidden'" />
        <span>${base.name}${enchantTag(item.enchant)}<br><small class="scan-item-sub">T${base.tier} · .${item.enchant} · ${QUALITY_NAMES[item.quality]}</small></span></button>
      <label class="stack-qty-label">шт <input class="stack-qty" type="number" min="1" step="1" value="${item.quantity}" /></label>
      <label class="stack-qty-label" title="Цена продажи одного плаща: по умолчанию из плана (средняя по истории сделок); впиши свою — профит пересчитается сразу">цена продажи <input class="stack-sale" type="number" min="0" step="1" value="${own}" placeholder="${item.salePrice > 0 ? Math.round(item.salePrice) : 'нет данных'}" /></label>
      <label class="stack-check" title="Купить герб на рынке за серебро вместо очков"><input type="checkbox" class="stack-crest" ${item.crestSilver ? 'checked' : ''} /> герб за серебро</label>
      <label class="stack-check" title="Купить сердце на рынке за серебро вместо очков"><input type="checkbox" class="stack-heart" ${item.heartSilver ? 'checked' : ''} /> сердце за серебро</label>
      <button type="button" class="stack-remove" title="Убрать позицию из калькулятора">✕</button>
      <span class="stack-line">${stackLine(item)}</span>
      <div class="stack-missing"></div></div>`;
  }).join('');
  const all = craftStack.items.every((i) => i.on);
  stackPanel.innerHTML = `<div class="faction-plan stack-shell">
    <h4>Стек плащей · ${craftFaction ? craftFaction.name : ''} <small>${all ? 'в расчёте все позиции — клик по позиции откроет только её' : 'зелёные — в расчёте, серые — нет; клик добавляет/убирает'}</small>
      ${all || craftStack.items.length < 2 ? '' : '<button type="button" id="stack-all" class="stack-all">Все в расчёт</button>'}</h4>
    <label class="stack-check stack-auto" title="Для каждой позиции считаются оба пути (прямой плащ нужного зачарования и «плащ .0 + руны, души, реликты»); чары после крафта применяются к позиции, только если профит с ними выше на 7% и больше, и план закупки строится соответственно"><input type="checkbox" id="stack-auto-after" ${craftStack.autoAfter ? 'checked' : ''} /> Зачаровать после крафта — там, где профит выше на 7% и больше</label>
    <div id="stack-summary" class="craft-summary"></div>
    <div class="stack-cards">${cards}</div></div>`;
  renderStackSummary();
  bindStackPanel();
  renderStackLines();
}

// Сводка по зелёным позициям: очки, вложения, профит
function stackTotals() {
  const on = stackSelected();
  const t = { items: on.length, capes: on.reduce((s, i) => s + i.quantity, 0), cost: 0, profit: 0, instant: 0, instantAll: true, points: 0, noPrice: 0, pending: 0, errors: 0, fallback: 0 };
  for (const item of on) {
    const raw = stackResults.get(item.uid);
    if (!raw) { t.pending++; continue; }
    if (raw.error) { t.errors++; continue; }
    const pf = stackProfitOf(item, raw);
    if (!pf) { t.noPrice++; continue; }
    if (pf.basis !== 'plan') t.fallback++;
    t.cost += raw.totalCost;
    t.profit += pf.unit * item.quantity;
    if (raw.faction) t.points += raw.faction.pointsPerCape * item.quantity;
    if (raw.totalProfit !== null && raw.totalProfit !== undefined) t.instant += raw.totalProfit;
    else t.instantAll = false;
  }
  return t;
}

function stackNote(t) {
  return `${t.pending ? `Считается позиций: ${t.pending}. ` : ''}${t.noPrice ? `Не хватает цен материалов или продажи (в итоги не входят): ${t.noPrice} — впиши их в карточках. ` : ''}${t.errors ? `С ошибкой: ${t.errors}. ` : ''}${t.fallback ? `У ${t.fallback} поз. нет цены продажи из плана — профит по продаже калькулятора.` : ''}`;
}

function renderStackSummary() {
  const box = document.getElementById('stack-summary');
  if (!box || !craftStack) return;
  const t = stackTotals();
  const avail = craftFaction ? craftFaction.points : 0;
  const over = t.points > avail;
  const note = stackNote(t);
  box.innerHTML = `
    <div class="craft-summary-row"><span>В расчёте: позиций / плащей</span><span>${t.items} из ${craftStack.items.length} / ${stackNum(t.capes)}</span></div>
    <div class="craft-summary-row"><span>Очков нужно из ${stackNum(avail)}</span><span class="${over ? 'profit-neg' : ''}">${stackNum(t.points)}${over ? ` · не хватает ${stackNum(t.points - avail)}` : ` · остаток ${stackNum(avail - t.points)}`}</span></div>
    <div class="craft-summary-row"><span>Вложения серебром</span><span>${stackNum(t.cost)}</span></div>
    <div class="craft-summary-row"><strong>Профит по зелёным позициям</strong><strong class="${t.profit >= 0 ? 'profit-pos' : 'profit-neg'}">${stackNum(t.profit)}</strong></div>
    ${note ? `<div class="craft-summary-row"><span class="scan-stale">${note}</span><span></span></div>` : ''}`;
}

// Общий вид: сводные показатели и один список закупки по всем зелёным позициям. Каждая позиция считается отдельно (как в обычном крафте),
// здесь результаты складываются: количества материалов — суммой, города — вместе.
function stackPurchaseRows() {
  const map = new Map();
  for (const item of stackSelected()) {
    const data = stackOk(item.uid);
    if (!data) continue;
    for (const row of acquisitionRowsData(data)) {
      const entry = map.get(row.id) || { id: row.id, name: row.baseName, needed: 0, cost: 0, unknown: false, cities: new Map() };
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
  const note = stackNote(t);
  const body = rows.map((r) => `<tr>
      <td class="copyable" data-copy-id="${r.id}" data-copy-name="${r.name}" title="Клик — скопировать название для поиска в аукционе"><img class="item-icon-sm" src="${iconUrl(r.id, 40)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" /> ${r.name}</td>
      <td>${stackNum(r.needed)}</td>
      <td class="plan-cities">${[...r.cities.entries()].map(([city, c]) => `${city}: ${stackNum(c.qty)} шт по ${stackNum(c.cost / c.qty, c.cost / c.qty < 100 ? 1 : 0)}`).join('<br>') || '—'}${r.unknown ? '<br><small class="scan-stale">часть без цены</small>' : ''}</td>
      <td data-sort-value="${r.cost}">${r.unknown && !r.cost ? '—' : stackNum(r.cost)}</td></tr>`).join('');
  craftEl.result.innerHTML = `
    <div class="craft-scoreboard stack-scoreboard">
      <div class="sb-cell sb-cost"><span class="sb-label">Нужно денег на все зелёные позиции</span><b class="sb-value">${stackNum(t.cost)}</b><small>${t.items} поз. · ${stackNum(t.capes)} плащей</small></div>
      <div class="sb-cell"><span class="sb-label">Маржа всего · продажа Sell Order</span><b class="sb-value ${cls(t.profit)}">${stackNum(t.profit)}</b><small>${t.cost > 0 ? `${stackNum((t.profit / t.cost) * 100, 0)}% к вложениям · ` : ''}по цене продажи из плана (или своей)</small></div>
      <div class="sb-cell"><span class="sb-label">Маржа всего · мгновенная продажа</span><b class="sb-value ${t.instantAll ? cls(t.instant) : ''}">${t.instantAll && t.items ? stackNum(t.instant) : '—'}</b><small>${t.instantAll ? 'в ордера на покупку — обычно ниже' : 'нет цены у части позиций'}</small></div>
      <div class="sb-cell faction-tile"><span class="sb-label">Фракционные очки · ${craftFaction ? craftFaction.name : ''}</span><b class="sb-value ${t.points > avail ? 'profit-neg' : ''}">${stackNum(t.points)}</b><small>из ${stackNum(avail)}${t.points > avail ? ` · не хватает ${stackNum(t.points - avail)}` : ` · остаток ${stackNum(avail - t.points)}`}${t.points > 0 ? ` · ${stackNum(t.profit / t.points, 1)} профита на очко` : ''}</small></div>
    </div>
    ${note ? `<p class="calc-note">${note}</p>` : ''}
    <h4 class="plan-title">Закупить для всего стека <small>сумма по зелёным позициям; каждая считается отдельно — клик по позиции покажет её подробный план закупки; клик по названию копирует его для поиска на аукционе</small></h4>
    ${rows.length ? `<div class="table-scroll"><table class="craft-recipe-table" id="stack-purchase-table">
      <thead><tr><th>Что покупаем</th><th>Нужно, шт</th><th>Города закупки</th><th>Сумма</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr class="materials-total"><td colspan="3">Итого на закупку</td><td>${stackNum(total)}</td></tr></tfoot></table></div>
    <p class="calc-note">Складываются количества и цены по отдельности посчитанных позиций: если одинаковый материал нужен в нескольких позициях, общий объём мог бы поднять цену чуть выше. Герб и сердце за очки в закупку не входят.</p>` : '<div class="chart-empty">Считаю позиции…</div>'}`;
}

function bindStackPanel() {
  const all = document.getElementById('stack-all');
  if (all) all.addEventListener('click', () => { craftStack.items.forEach((i) => { i.on = true; }); applyStackSelection(); });
  document.getElementById('stack-auto-after').addEventListener('change', (e) => {
    craftStack.autoAfter = e.target.checked;
    stackPairs.clear();
    if (!craftStack.autoAfter) craftStack.items.forEach((i) => { i.after = false; });        // без галочки — все позиции прямым путём
    stackSave();
    const open = stackActiveItem();
    if (open) {
      document.getElementById('craft-enchant-after').checked = !!open.after && stackAfterPossible(open);
      setStackItemFields(false);
      runCraftCalc(true);
    } else stackRefreshAll();
  });
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
    // своя цена продажи: профит пересчитывается сразу, без запроса (в том числе выбор «после крафта» по уже посчитанным вариантам)
    card.querySelector('.stack-sale').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v) && v > 0) item.salePriceOwn = v; else delete item.salePriceOwn;
      stackSave();
      const pair = stackPairs.get(uid);
      if (pair && stackAutoAfter(item)) {
        item.after = decideAfter(item, pair);
        stackResults.set(uid, item.after ? pair.after : pair.direct);
      }
      renderStackLines();
      renderStackSummary();
      if (craftStack.aggregate) renderAggregate();
    });
  });
}

// Восстановление стека после перезагрузки страницы
function stackRestore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STACK_KEY) || 'null');
    if (!saved || !saved.faction || !Array.isArray(saved.items) || saved.items.length === 0) return;
    enterCraftStack(saved.faction, saved.items, { autoAfter: saved.autoAfter });
  } catch (e) { /* повреждённое сохранение — пропускаем */ }
}
Promise.all([itemsReady, craftReady]).then(stackRestore);
