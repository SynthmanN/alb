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
  purchaseLog: document.getElementById('craft-purchase-log'),
  gearRrr: document.getElementById('craft-gear-rrr'),
  gearRrrCustom: document.getElementById('craft-gear-rrr-custom'),
  refineRrr: document.getElementById('craft-refine-rrr'),
  refineRrrCustom: document.getElementById('craft-refine-rrr-custom'),
  materialHours: document.getElementById('craft-material-hours'),
  blackMarket: document.getElementById('craft-black-market'),
  quantity: document.getElementById('craft-quantity'),
  run: document.getElementById('craft-run'),
  result: document.getElementById('craft-result'),
};

let craftSelectedItem = null;
let lastCraftData = null;          // последний результат калькулятора — для пересчёта плана продажи без запроса к серверу
const manualSalePlan = new Map();  // город -> штук, введённых вручную в плане продажи (сбрасывается при новом расчёте)
const manualMaterialPrice = new Map(); // id материала -> своя цена, вписанная в таблице материалов (сбрасывается при новом расчёте)
const purchaseLots = new Map();       // id материала -> [{ qty, price }]: реально купленные стаки (режим «Лог закупок по лотам»)
let manualSellPrice = null;         // своя цена продажи готового предмета в мгновенном блоке «Продажа в Buy Order»
const manualCityPrice = new Map();  // город -> своя цена продажи (видел в игре): для городов без сделок за период и для правки цены любого города
const saleCityToggles = new Map(); // город -> true/false: включён/выключен в плане чекбоксом (пусто — автоплан)
let saleStrategy = 'profit';       // распределение партии: 'profit' — максимизировать профит по индексу города (по умолчанию), 'even' — равный срок продажи
const PROFIT_STRATEGY_HORIZON = 1.5; // «в пределах разумного»: при стратегии «профит» город может держать партию до 1.5× срока равномерного плана

// Возврат ресурсов при крафте гира: список готовых ставок с реальными процентами + «Своя ставка…». Список строится из /api/refining-meta
// (gearRrrPresets), чтобы проценты не разъезжались с сервером; по умолчанию — «город с бонусом предмета» (24.8%).
let gearRrrPresets = [];
function fillGearRrrSelect(select, custom) {
  select.innerHTML = gearRrrPresets.map((p) => `<option value="${p.id}">${p.label} — ${(p.rrr * 100).toFixed(1)}%</option>`).join('') + '<option value="custom">Своя ставка…</option>';
  select.value = 'city_bonus';
  select.addEventListener('change', () => {
    custom.hidden = select.value !== 'custom';
    if (!custom.hidden) custom.focus();
  });
}
// Параметры запроса: пресет и (только при «Своя ставка…») свой процент.
function gearRrrParams(select, custom) {
  const own = select.value === 'custom' ? parseFloat(custom.value) : NaN;
  return Number.isFinite(own) ? { gearRrr: 'city_bonus', gearRrrCustom: String(own) } : { gearRrr: select.value === 'custom' ? 'city_bonus' : select.value };
}
// Та же ставка долей 0..1 — для мгновенного пересчёта в калькуляторе без запроса.
function currentGearRate() {
  const own = craftEl.gearRrr.value === 'custom' ? parseFloat(craftEl.gearRrrCustom.value) : NaN;
  if (Number.isFinite(own)) return Math.min(Math.max(own, 0), 95) / 100;
  const preset = gearRrrPresets.find((p) => p.id === craftEl.gearRrr.value) || gearRrrPresets.find((p) => p.id === 'city_bonus');
  return preset ? preset.rrr : null;
}

// Возврат при ПЕРЕРАБОТКЕ сырья («переработать самому» вместо покупки готового материала): пресеты RRR_PRESETS с сервера (rrrPresets),
// по умолчанию «город со спец-бонусом ресурса» (36.7%). Устроен так же, как список ставки крафта, но это ДРУГАЯ ставка.
let refineRrrPresets = [];
function fillRefineRrrSelect(select, custom) {
  select.innerHTML = refineRrrPresets.map((p) => `<option value="${p.id}">${p.label} — ${(p.rrr * 100).toFixed(1)}%</option>`).join('') + '<option value="custom">Своя ставка…</option>';
  select.value = 'city_bonus';
  select.addEventListener('change', () => {
    custom.hidden = select.value !== 'custom';
    if (!custom.hidden) custom.focus();
  });
}
function refineRrrParams(select, custom) {
  const own = select.value === 'custom' ? parseFloat(custom.value) : NaN;
  return Number.isFinite(own) ? { refineRrr: 'city_bonus', refineRrrCustom: String(own) } : { refineRrr: select.value === 'custom' ? 'city_bonus' : select.value };
}
function currentRefineRate() {
  const own = craftEl.refineRrr.value === 'custom' ? parseFloat(craftEl.refineRrrCustom.value) : NaN;
  if (Number.isFinite(own)) return Math.min(Math.max(own, 0), 95) / 100;
  const preset = refineRrrPresets.find((p) => p.id === craftEl.refineRrr.value) || refineRrrPresets.find((p) => p.id === 'city_bonus');
  return preset ? preset.rrr : null;
}

async function initCraft() {
  const res = await fetch('/api/refining-meta');
  const meta = await res.json();
  gearRrrPresets = meta.gearRrrPresets || [];
  fillGearRrrSelect(craftEl.gearRrr, craftEl.gearRrrCustom);
  fillGearRrrSelect(marginEl.gearRrr, marginEl.gearRrrCustom);
  weaponGroups = await fetch('/api/item-groups').then((r) => r.json()).then((d) => d.weapon || []).catch(() => []);
  refineRrrPresets = meta.rrrPresets || [];
  fillRefineRrrSelect(craftEl.refineRrr, craftEl.refineRrrCustom);
  fillRefineRrrSelect(marginEl.refineRrr, marginEl.refineRrrCustom);
  // смена ставки в калькуляторе пересчитывает результат на месте — без запроса к серверу
  // Смена ставки возврата: результат сразу пересчитывается на месте (быстро, приближённо), а следом сервер честно пересчитывает цену материалов
  // за нужное количество (многогородовой план + комиссия) — материалы он берёт из кувшина, поэтому это быстро. Свои цены сохраняются.
  let rateTimer = null;
  const rerender = () => {
    if (!lastCraftData) return;
    renderCraftResult(lastCraftData);
    clearTimeout(rateTimer);
    rateTimer = setTimeout(() => runCraftCalc(true), 500);
  };
  craftEl.enchant.addEventListener('change', refreshSelectedIcon);
  craftEl.quality.addEventListener('change', refreshSelectedIcon);
  craftEl.gearRrr.addEventListener('change', rerender);
  craftEl.purchaseLog.addEventListener('change', () => { if (lastCraftData) renderCraftResult(lastCraftData); });        // включает/выключает мини-список лотов вместо поля «своя цена»
  craftEl.gearRrrCustom.addEventListener('input', rerender);
  craftEl.refineRrr.addEventListener('change', rerender);
  craftEl.refineRrrCustom.addEventListener('input', rerender);

  craftEl.search.addEventListener('input', (e) => renderCraftSuggestions(e.target.value));
  craftEl.categoryFilter.addEventListener('change', () => renderCraftSuggestions(craftEl.search.value));
  craftEl.tierFilter.addEventListener('change', () => renderCraftSuggestions(craftEl.search.value));
  craftEl.run.addEventListener('click', () => runCraftCalc());
  craftEl.result.addEventListener('click', onCopyClick);
  // Очки фракции в калькуляторе: количество плащей подгоняется само; «Количество» по штукам остаётся и работает как раньше
  let pointsTimer = null;
  document.getElementById('craft-faction-points').addEventListener('input', () => {
    if (!craftFaction) return;
    craftFaction.points = readGroupedNumber(document.getElementById('craft-faction-points')) || 0;
    fitQuantityToPoints();
    if (craftStack) { stackSave(); renderStackSummary(); }
    clearTimeout(pointsTimer);
    pointsTimer = setTimeout(() => runCraftCalc(true), 500);
  });
  craftEl.selected.addEventListener('click', onCopyClick);
  // Любая правка параметров, которые считает сервер (количество, доля рынка, окна, порог, зачарование, качество, галочки…), сама
  // пересчитывает результат. Ставки возврата и свои цены/лоты/план продажи пересчитываются на месте, без запроса (см. rerender выше).
  const AUTO_FIELDS = new Set(['craft-enchant', 'craft-quality', 'craft-quantity', 'craft-enchant-after', 'craft-market-share', 'craft-price-tolerance', 'craft-sell-threshold',
    'craft-black-market', 'craft-teleport', 'craft-days', 'craft-material-hours', 'craft-ceiling', 'craft-sell-low', 'craft-sell-high']);
  let autoTimer = null;
  const autoRun = (e) => {
    const holder = e.target.closest && e.target.closest('[id]');
    const id = e.target.id || (holder ? holder.id : '');
    const owner = AUTO_FIELDS.has(id) ? id : [...AUTO_FIELDS].find((f) => e.target.closest('label') && e.target.closest('label').querySelector(`#${f}`));
    if (!owner || !lastCraftData) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => runCraftCalc(true), 500);
  };
  craftEl.controls.addEventListener('change', autoRun);
  craftEl.controls.addEventListener('input', autoRun);
  document.getElementById('craft-extra').addEventListener('change', autoRun);
  document.getElementById('craft-extra').addEventListener('input', autoRun);
}

// Выбор предмета по категории — колонками: броня по материалу (латная/кожаная/тканевая), оружие по игровой классификации (мастерки:
// «Луки» = лук + боевой лук + длинный…), плащи по городам и фракциям. Группы оружия приходят с сервера (/api/item-groups).
let weaponGroups = [];
const CAPE_COLUMNS = [
  ['CAPE', 'Базовые'],
  ['CAPEITEM_FW_BRIDGEWATCH', 'Бридгуотч'], ['CAPEITEM_FW_CAERLEON', 'Каэрлеон'], ['CAPEITEM_FW_FORTSTERLING', 'Форт Стерлинг'], ['CAPEITEM_FW_LYMHURST', 'Лимхёрст'],
  ['CAPEITEM_FW_MARTLOCK', 'Мартлок'], ['CAPEITEM_FW_THETFORD', 'Тетфорд'], ['CAPEITEM_FW_BRECILIEN', 'Бресилиен'],
  ['CAPEITEM_AVALON', 'Авалонские'], ['CAPEITEM_DEMON', 'Демонов'], ['CAPEITEM_HERETIC', 'Еретиков'], ['CAPEITEM_KEEPER', 'Хранителей'],
  ['CAPEITEM_MORGANA', 'Морганы'], ['CAPEITEM_SMUGGLER', 'Контрабандистов'], ['CAPEITEM_UNDEAD', 'Нежити'],
];
const ARMOR_COLUMNS = [['латы', 'Латная броня'], ['кожа', 'Кожаная броня'], ['ткань', 'Тканевая броня']];
const familyOf = (id) => id.replace(/^T\d+_/, '');
function suggestionColumns(cat, items) {
  let columns;
  if (cat === 'armor') columns = ARMOR_COLUMNS.map(([key, title]) => ({ title, test: (i) => i.material === key }));
  else if (cat === 'cape') columns = CAPE_COLUMNS.map(([fam, title]) => ({ title, test: (i) => familyOf(i.id) === fam }));
  else columns = weaponGroups.map((g) => ({ title: g.title, test: (i) => g.families.includes(familyOf(i.id)) }));
  return columns.map((col) => ({ title: col.title, items: items.filter(col.test).sort((a, b) => familyOf(a.id).localeCompare(familyOf(b.id)) || a.tier - b.tier) })).filter((col) => col.items.length);
}
function suggestionChip(item) {
  const chip = document.createElement('div');
  chip.className = 'suggestion-item';
  const extra = [item.slot, item.material].filter(Boolean).join(', ');
  const label = extra ? `${item.name} (${extra})` : item.name;
  chip.innerHTML = `<img class="item-icon-sm" src="${iconUrl(item.id, 24)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" /><span>${label}</span>`;
  chip.onclick = () => selectCraftItem(item);
  return chip;
}

function renderCraftSuggestions(query) {
  craftEl.suggestions.innerHTML = '';
  craftEl.suggestions.classList.remove('as-columns');
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
  });

  if (cat) {
    // Категория выбрана — ровные колонки по подкатегориям; тир и текст поиска сужают колонки.
    craftEl.suggestions.classList.add('as-columns');
    for (const col of suggestionColumns(cat, matches)) {
      const box = document.createElement('div');
      box.className = 'suggestion-column';
      box.innerHTML = `<h4>${col.title} <small>${col.items.length}</small></h4>`;
      for (const item of col.items) box.appendChild(suggestionChip(item));
      craftEl.suggestions.appendChild(box);
    }
    return;
  }
  for (const item of matches.slice(0, 30)) craftEl.suggestions.appendChild(suggestionChip(item));
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
// Фракционный режим калькулятора: включается только плащом, присланным из скана с включённым режимом (id фракции и очки); выбор предмета вручную его сбрасывает
let craftFaction = null;
let craftStack = null;                 // стек фракционных плащей из плана трат очков (см. craft-stack.js); null — обычный калькулятор
let stackSelecting = false;
let selectingFromFactionScan = false;
// Очков на один плащ выбранного тира: сердце 3000 + герб тира (цены в очках одинаковы для всех фракций)
const FACTION_HEART_POINTS = 3000;
const FACTION_CREST_POINTS = { 4: 400, 5: 2250, 6: 3000, 7: 7500, 8: 15000 };
const factionPerCape = () => (craftSelectedItem && FACTION_CREST_POINTS[craftSelectedItem.tier] !== undefined ? FACTION_HEART_POINTS + FACTION_CREST_POINTS[craftSelectedItem.tier] : null);
// Подгоняет количество плащей под очки фракции: floor(очки ÷ очков на плащ), не меньше 1
function fitQuantityToPoints() {
  const perCape = factionPerCape();
  if (!craftFaction || !perCape || craftStack) return;                     // в стеке количество у каждой позиции своё
  craftEl.quantity.value = String(Math.max(Math.floor(craftFaction.points / perCape), 1));
}
function renderFactionBadge() {
  const field = document.getElementById('craft-faction-points-field');
  if (field) {
    field.hidden = !craftFaction;
    if (craftFaction) document.getElementById('craft-faction-points').value = Number(craftFaction.points).toLocaleString('ru-RU').replace(/,/g, ' ');
  }
  const el = document.getElementById('craft-faction-badge');
  if (!el) return;
  el.innerHTML = craftFaction && craftStack ? `<div class="faction-badge">Фракционный стек: <b>${craftFaction.name}</b> · позиций ${craftStack.items.length} <button type="button" id="craft-faction-off">выключить</button></div>`
    : craftFaction ? `<div class="faction-badge">Фракционный режим: <b>${craftFaction.name}</b> · очков ${fmtNum(craftFaction.points)} <button type="button" id="craft-faction-off">выключить</button></div>` : '';
  const off = document.getElementById('craft-faction-off');
  if (off) off.addEventListener('click', () => { craftFaction = null; if (craftStack) exitCraftStack(); renderFactionBadge(); runCraftCalc(true); });
}

function selectCraftItem(item, keep = false) {
  if (!keep && !selectingFromFactionScan && !stackSelecting && craftFaction) { craftFaction = null; if (craftStack) exitCraftStack(); renderFactionBadge(); }
  const prevEnchant = craftEl.enchant.value;
  craftSelectedItem = item;
  craftEl.search.value = '';
  craftEl.suggestions.innerHTML = '';
  const tiers = craftFamilyItems(item);
  const tierSwitch = tiers.length > 1
    ? `<label class="tier-switch">Тир <select id="craft-tier-switch">${tiers.map((t) => `<option value="${t.id}" ${t.id === item.id ? 'selected' : ''}>T${t.tier}</option>`).join('')}</select></label>`
    : '';
  craftEl.selected.innerHTML = `<img id="craft-selected-icon" src="${iconUrl(item.id, 128, 0, 1)}" alt="" onerror="this.style.visibility='hidden'" /><strong class="copyable" data-copy-id="${item.id}" data-copy-gear="1" title="Клик — скопировать название для поиска в аукционе">${item.name}</strong>${tierSwitch}`;
  const sw = document.getElementById('craft-tier-switch');
  if (sw) sw.addEventListener('change', () => switchCraftTier(sw.value));

  const maxE = maxEnchantFor(item);
  const opts = [{ v: 0, l: 'Без зачар.' }, { v: 1, l: 'Зачар. 1' }, { v: 2, l: 'Зачар. 2' }, { v: 3, l: 'Зачар. 3' }, { v: 4, l: 'Зачар. 4' }];
  craftEl.enchant.innerHTML = opts.map((o) => `<option value="${o.v}" ${o.v > maxE ? 'disabled' : ''}>${o.l}</option>`).join('');
  if (keep && Number(prevEnchant) <= maxE) craftEl.enchant.value = prevEnchant;

  craftEl.controls.style.display = 'grid';
  refreshSelectedIcon();
  refreshGearBonusHint();
  document.getElementById('craft-extra').style.display = 'block';
  if (!keep) { craftEl.result.innerHTML = ''; lastCraftData = null; }   // новый предмет — старый результат не пересчитываем
}

// Где крафтить гир, чтобы получить бонус города (максимальный возврат): у каждого типа предмета свой бонус-город (меч — Лимхёрст, топор —
// Мартлок…), а не один на все: по игровой таблице специализаций крафта. Это только подсказка — ставку выбираешь сам, где ты стоишь, инструмент не гадает.
const GEAR_BONUS_BY_WEAPON_GROUP = {
  COMBAT_SWORDS: 'Лимхёрст', COMBAT_BOWS: 'Лимхёрст', COMBAT_ARCANESTAFFS: 'Лимхёрст', COMBAT_AXES: 'Мартлок', COMBAT_QUARTERSTAFFS: 'Мартлок', COMBAT_FROSTSTAFFS: 'Мартлок',
  COMBAT_HAMMERS: 'Форт Стерлинг', COMBAT_SPEARS: 'Форт Стерлинг', COMBAT_HOLYSTAFFS: 'Форт Стерлинг', COMBAT_MACES: 'Тетфорд', COMBAT_FIRESTAFFS: 'Тетфорд', COMBAT_NATURESTAFFS: 'Тетфорд',
  COMBAT_CROSSBOWS: 'Бридгуотч', COMBAT_DAGGERS: 'Бридгуотч', COMBAT_CURSEDSTAFFS: 'Бридгуотч', COMBAT_SHAPESHIFTER: 'Каэрлеон', COMBAT_KNUCKLES: 'Каэрлеон',
  COMBAT_BOOKS: 'Мартлок', COMBAT_TORCHES: 'Мартлок', COMBAT_SHIELDS: 'Мартлок',
};
const GEAR_BONUS_BY_ARMOR = {
  ARMOR_CLOTH: 'Форт Стерлинг', HEAD_CLOTH: 'Тетфорд', SHOES_CLOTH: 'Бридгуотч', ARMOR_LEATHER: 'Тетфорд', HEAD_LEATHER: 'Лимхёрст', SHOES_LEATHER: 'Лимхёрст',
  ARMOR_PLATE: 'Бридгуотч', HEAD_PLATE: 'Форт Стерлинг', SHOES_PLATE: 'Мартлок',
};
function gearBonusCity(item) {
  if (!item) return null;
  if (item.category === 'cape') return 'Бресилиен';
  const fam = familyOf(item.id);
  if (item.category === 'armor') { const m = fam.match(/^(ARMOR|HEAD|SHOES)_(CLOTH|LEATHER|PLATE)/); return m ? GEAR_BONUS_BY_ARMOR[`${m[1]}_${m[2]}`] || null : null; }
  const group = weaponGroups.find((g) => g.families.includes(fam));
  return group ? GEAR_BONUS_BY_WEAPON_GROUP[group.id] || null : null;
}
function refreshGearBonusHint() {
  const el = document.getElementById('craft-gear-bonus');
  if (!el) return;
  const city = gearBonusCity(craftSelectedItem);
  el.textContent = city ? `бонус: ${city}` : '';
  el.title = city ? `Город, где крафт этого предмета даёт бонус к возврату (пресеты «бонус-город»). Ставку выбираешь ты — инструмент не гадает, где ты стоишь` : '';
}

// Быстрая смена тира без повторного поиска: тот же предмет на другом тире, зачарование/качество/количество те же.
// Иконка выбранного предмета показывает то, что считаем: тир, зачарование (свой цвет рамки) и качество — обновляется вместе с полями.
function refreshSelectedIcon() {
  const img = document.getElementById('craft-selected-icon');
  if (!img || !craftSelectedItem) return;
  img.style.visibility = '';
  img.src = iconUrl(craftSelectedItem.id, 128, Number(craftEl.enchant.value) || 0, Number(craftEl.quality.value) || 1);
}
function switchCraftTier(itemId) {
  const item = findItem(itemId);
  if (!item) return;
  selectCraftItem(item, true);
  fitQuantityToPoints();                                                      // на другом тире плащ стоит других очков — количество подгоняется заново
  runCraftCalc();
}

// Параметры запроса к /api/craft-calc: общие настройки калькулятора (ставки, города, окна, доля рынка…) берутся из полей, а позиция — из spec
// (предмет, зачарование, качество, количество, «после крафта», детали за серебро). Позиции стека считаются тем же путём, что обычный расчёт.
function craftSpecFromControls() {
  return {
    itemId: craftSelectedItem.id, enchant: craftEl.enchant.value, quality: craftEl.quality.value, quantity: craftEl.quantity.value || '1',
    after: document.getElementById('craft-enchant-after').checked, partsSilver: craftStack ? stackPartsSilver(stackActiveItem()) : [],
  };
}
function craftParamsFor(spec) {
  const params = new URLSearchParams({
    item: spec.itemId, enchant: String(spec.enchant), quality: String(spec.quality),
    quantity: String(spec.quantity || '1'), ...gearRrrParams(craftEl.gearRrr, craftEl.gearRrrCustom), ...refineRrrParams(craftEl.refineRrr, craftEl.refineRrrCustom), blackMarket: String(craftEl.blackMarket.checked), materialHours: readCustomizable(craftEl.materialHours), cities: activeCities().join(','),
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
  if (spec.after) params.set('enchantAfterCraft', 'true');
  const threshold = document.getElementById('craft-sell-threshold').value;
  if (threshold) params.set('sellThreshold', threshold);
  if (craftFaction) {
    params.set('faction', craftFaction.id);
    params.set('factionPoints', String(craftFaction.points));
    if (spec.partsSilver && spec.partsSilver.length) params.set('partsSilver', spec.partsSilver.join(','));
  }
  return params;
}

// «Посчитать» — и автоматический пересчёт при правке параметров (keepManual: свои цены и лоты на автопересчёте сохраняются; план продажи
// по городам зависит от количества и рынка — он сбрасывается).
async function runCraftCalc(keepManual = false) {
  if (craftStack && craftStack.aggregate) { stackRefreshAll(); return; }     // общий вид стека: пересчитываются все позиции в расчёте
  if (!craftSelectedItem) return;
  if (keepManual !== true) keepManual = false;
  if (!keepManual || !lastCraftData) craftEl.result.innerHTML = 'Считаю...';
  try {
    if (craftStack) stackSyncFromControls();                                  // правки полей (зачарование, качество, количество) — это правки активной позиции стека
    const params = craftParamsFor(craftSpecFromControls());
    const data = await fetchJson(`/api/craft-calc?${params}`);
    if (data.error) throw new Error(data.error);
    manualSalePlan.clear();
    saleCityToggles.clear();
    if (!keepManual) {
      manualCityPrice.clear();
      manualMaterialPrice.clear();
      purchaseLots.clear();
      manualSellPrice = null;
    }
    lastCraftData = data;
    renderCraftResult(data);
    if (craftStack) stackOnActiveResult(data);
  } catch (err) {
    craftEl.result.innerHTML = `<span style="color:#ff6b6b">Ошибка: ${err.message}</span>`;
  }
}

// Свои цены: видишь расхождение с игрой — вписываешь реальную цену сырья или продажи, всё пересчитывается на месте (без запроса к серверу).
// Возвращает копию ответа с подставленными ценами; исходный lastCraftData не меняется. Сравнения по качеству и по тирам своими
// ценами не пересчитываются (они считались по рыночным).
// Средневзвешенная цена по реально купленным лотам: Σ(кол-во × цена) / Σ кол-во; null — пока лотов нет.
function lotsAverage(lots) {
  let qty = 0;
  let sum = 0;
  for (const l of lots || []) if (l.qty > 0 && l.price >= 0) { qty += l.qty; sum += l.qty * l.price; }
  return qty > 0 ? { qty, avg: sum / qty } : null;
}
// Своя цена материала: из лога закупок (если он включён и есть лоты), иначе вписанная вручную; undefined — своей цены нет.
function ownPriceFor(resource) {
  if (craftEl.purchaseLog.checked) {
    const avg = lotsAverage(purchaseLots.get(resource));
    if (avg) return avg.avg;
  }
  return manualMaterialPrice.has(resource) ? manualMaterialPrice.get(resource) : undefined;
}
const hasOwnPrices = () => manualMaterialPrice.size > 0 || (craftEl.purchaseLog.checked && [...purchaseLots.values()].some((l) => lotsAverage(l)));

function applyManualPrices(data) {
  // Ставка возврата, выбранная в списке ПОСЛЕ расчёта, тоже подставляется на месте (без запроса): меняются только доли возврата,
  // цены материалов те же. План закупки по городам (сроки) остаётся посчитан по ставке последнего запроса.
  const newRate = currentGearRate();
  const oldRate = data.rrrPreset ? data.rrrPreset.gearRate : undefined;
  const rateChanged = oldRate !== undefined && newRate !== null && Math.abs(newRate - oldRate) > 1e-9;
  // Ставка переработки: «купить готовый или переработать самому» выбирается заново — сначала эта проверка, дальше остальные расчёты
  // идут уже по выбранному источнику и по ставке возврата гира.
  const newRefine = currentRefineRate();
  const refineChanged = data.refineRate !== undefined && newRefine !== null && Math.abs(newRefine - data.refineRate) > 1e-9;
  if (!hasOwnPrices() && manualSellPrice === null && manualCityPrice.size === 0 && !rateChanged && !refineChanged) return data;
  const d = { ...data, recipe: data.recipe.map((r) => ({ ...r })) };
  if (refineChanged) d.refineRate = newRefine;
  if (rateChanged) d.rrrPreset = { ...data.rrrPreset, gearRate: newRate, rrr: newRate, label: `возврат при крафте: ${(newRate * 100).toFixed(1)}%${craftEl.gearRrr.value === 'custom' ? ' (своя ставка)' : ''}` };
  let materialDelta = 0;                 // изменение себестоимости за штуку от своих цен на материалы рецепта (с учётом возврата)
  let nominalDelta = 0;
  for (const r of d.recipe) {
    if (r.cheapestPrice === null || r.materialSource === 'points') continue;
    const oldPrice = r.cheapestPrice;                    // цена до пересчётов: от неё считаются дельты себестоимости
    // Своя цена сырья или полуфабриката предыдущего тира (из плана закупки) тоже пересчитывает «купить или переработать»
    const ownComp = r.refineOption ? r.refineOption.components.some((cp) => ownPriceFor(cp.id) !== undefined) : false;
    if ((refineChanged || ownComp) && r.refineOption) {
      const rate = refineChanged ? newRefine : r.refineOption.rate;
      const rawCost = r.refineOption.components.reduce((sum, cp) => { const own = ownPriceFor(cp.id); return sum + cp.count * (own !== undefined ? own : cp.price); }, 0);
      const alt = rawCost * (1 - rate);
      const buy = r.materialSource === 'refine' ? r.buyPrice : r.cheapestPrice;
      r.refineOption = { ...r.refineOption, rate, rawCost, price: alt };
      if (buy === null || alt <= buy * 0.95) { r.materialSource = 'refine';   // выгода меньше 5% — не переработка (как на сервере)
        r.cheapestPrice = alt; r.cheapestCity = r.refineOption.city; r.priceSource = 'refine'; r.buyPrice = buy; }
      else { r.materialSource = 'buy'; r.cheapestPrice = buy; r.cheapestCity = r.buyCity; r.priceSource = null; }
    }
    const own = ownPriceFor(r.resource);
    const p = own !== undefined ? own : r.cheapestPrice;
    const oldFactor = r.returnable === false ? 1 : 1 - (r.rrr || 0);
    if (rateChanged && r.returnable !== false) r.rrr = newRate;
    const newFactor = r.returnable === false ? 1 : 1 - (r.rrr || 0);
    materialDelta += (p * newFactor - oldPrice * oldFactor) * r.count;
    nominalDelta += (p - oldPrice) * r.count;
    if (rateChanged) r.neededToBuy = Math.ceil(r.count * data.quantity * newFactor);
    if (own !== undefined && p !== r.cheapestPrice) { r.marketPrice = r.cheapestPrice; r.cheapestPrice = p; r.manualPrice = true; }   // рыночная цена остаётся серой подсказкой в поле
  }
  const baseFlow = data.enchantAfterCraft || data.baseChoice;
  let stepsDelta = 0;
  if (data.enchantAfterCraft) {
    d.enchantAfterCraft = { ...data.enchantAfterCraft, steps: data.enchantAfterCraft.steps.map((st) => ({ ...st })) };
    for (const st of d.enchantAfterCraft.steps) {
      const p = ownPriceFor(st.materialId);
      if (p === undefined || st.cheapestPrice === null) continue;
      stepsDelta += (p - st.cheapestPrice) * st.count;
      st.cheapestPrice = p;
      st.cost = p * st.count;
      st.manualPrice = true;
    }
    d.enchantAfterCraft.stepsCostPerUnit = data.enchantAfterCraft.stepsCostPerUnit + stepsDelta;
  }
  let effective;
  if (baseFlow) {
    // База .0: снова выбираем «купить или скрафтить» — с учётом своих цен на материалы
    const craft = baseFlow.baseCraftCostPerUnit === null ? null : baseFlow.baseCraftCostPerUnit + materialDelta;
    const buy = baseFlow.baseBuy ? baseFlow.baseBuy.price : null;
    const source = buy !== null && (craft === null || buy < craft) ? 'buy' : 'craft';
    const baseCost = source === 'buy' ? buy : craft;
    const copy = { ...baseFlow, baseCraftCostPerUnit: craft, baseSource: source, baseCostPerUnit: baseCost };
    if (data.enchantAfterCraft) d.enchantAfterCraft = { ...d.enchantAfterCraft, ...copy };
    else d.baseChoice = copy;
    effective = baseCost + (data.enchantAfterCraft ? d.enchantAfterCraft.stepsCostPerUnit : 0);
  } else {
    effective = data.effectiveCostPerUnit + materialDelta;
  }
  const costDelta = effective - data.effectiveCostPerUnit;
  d.effectiveCostPerUnit = effective;
  d.materialCostPerUnit = data.materialCostPerUnit + nominalDelta;
  d.totalCost = effective * data.quantity;
  // Мгновенная продажа: своя цена вместо лучшей из ордеров
  if (manualSellPrice !== null) {
    const rate = data.bestSell && data.bestSell.taxRate !== undefined ? data.bestSell.taxRate : data.taxRate;
    d.bestSell = { ...(data.bestSell || { city: 'своя цена', blackMarket: false }), price: manualSellPrice, taxRate: rate, manual: true };
    d.netSellPrice = manualSellPrice * (1 - rate);
  }
  d.profitPerUnit = d.netSellPrice === null || d.netSellPrice === undefined ? null : d.netSellPrice - effective;
  d.totalProfit = d.profitPerUnit === null ? null : d.profitPerUnit * data.quantity;
  // Терпеливая продажа: цены продажи те же, но себестоимость другая — профит городов, плана и итога сдвигается на разницу;
  // своя цена города (вписана в план продажи) заменяет среднюю цену истории и пересчитывает чистую цену и профит города.
  if (data.patientSell && (costDelta !== 0 || manualCityPrice.size > 0)) {
    const ps = { ...data.patientSell };
    const index = (profit, vol) => (profit > 0 && effective > 0 ? ((profit / effective) * 100) * Math.log2(2 + vol) : 0);
    ps.byCity = ps.byCity.map((c) => {
      const own = manualCityPrice.get(c.city);
      if (own !== undefined) {
        const net = own * (1 - c.taxRate);
        const profit = net - effective;
        return { ...c, avgSellPrice: own, netPrice: net, profitPerUnit: profit, profitIndex: index(profit, c.avgDailyVolume), ownPrice: true };
      }
      if (c.noData) return c;
      const profit = c.profitPerUnit - costDelta;
      return { ...c, profitPerUnit: profit, profitIndex: index(profit, c.avgDailyVolume) };
    });
    ps.profitPerUnit = data.patientSell.profitPerUnit - costDelta;
    if (ps.plan) ps.plan = { ...ps.plan, profitPerUnit: ps.plan.profitPerUnit === undefined ? undefined : ps.plan.profitPerUnit - costDelta };
    d.patientSell = ps;
  }
  d.manualPrices = hasOwnPrices() || manualSellPrice !== null || manualCityPrice.size > 0;
  return d;
}

function renderCraftResult(rawData) {
  if (craftStack && craftStack.aggregate) return;                              // общий вид стека занимает область результата
  const data = applyManualPrices(rawData);
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
        <td class="copyable" data-copy-id="${r.queryId || r.resource}" data-copy-name="${nameOfId(data, r.queryId || r.resource)}" title="Клик — скопировать название для поиска в аукционе"><img class="item-icon-sm" src="${iconUrl(r.queryId || r.resource, 40)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" /> ${name}${r.returnable === false && !r.enchStep ? ' <span class="no-return" title="Этот материал при крафте не возвращается — RRR на него не действует">без возврата</span>' : ''}</td>
        <td>${needed.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}${r.byRecipe !== undefined && r.byRecipe !== needed ? `<br><small>по рецепту ${r.byRecipe.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}</small>` : ''}</td>
        <td class="${missing ? 'missing' : ''}" data-sort-value="${r.cheapestPrice ?? ''}">${missing ? 'нет цены' : r.materialSource === 'points' ? `<span class="faction-points" title="Получено у интенданта за фракционные очки — в серебре 0">за очки: ${fmtNum(r.points)} на шт · ${fmtNum(r.points * data.quantity)} на ${fmtNum(data.quantity)} шт</span>` : `${r.materialSource === 'refine' && !r.manualPrice ? refineSourceHtml(r) : r.materialSource === 'craft' && !r.manualPrice ? craftSourceHtml(r) : cityPricesCell(r.cheapestCity, r.cheapestPrice, r.cityPrices)}${r.priceSource === 'quote' ? '<br><small class="scan-stale" title="Сделок за окно нет — взята текущая котировка">котировка</small>' : ''}${craftEl.purchaseLog.checked ? lotLogHtml(r) : `<br><input class="manual-price ${r.manualPrice ? 'is-manual' : ''}" type="number" min="0" step="1" data-res="${r.resource}" placeholder="${unitPlaceholder(r.marketPrice ?? r.cheapestPrice)}" value="${manualMaterialPrice.has(r.resource) ? manualMaterialPrice.get(r.resource) : ''}" title="Серым — цена за штуку по рынку. Видишь другую цену в игре — впиши свою: расчёт обновится сразу" />`}`}</td>
        <td class="${missing ? 'missing' : ''}">${missing ? '—' : subtotal.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}</td>
        <td data-sort-value="${acquireDaysFor(data, r) ?? ''}">${acquireDaysFor(data, r) !== null ? fmtDays(acquireDaysFor(data, r)) : '—'}${data.acquire && (data.acquire.bottleneckParent || data.acquire.bottleneckResource) === r.resource ? ' 🐢' : ''}</td>
        <td data-sort-value="${r.rrr ?? 0}">${r.materialSource === 'craft' && r.craftOption ? `<span title="Плащ-ингредиент не возвращается, но при крафте плаща самому ткань и кожа возвращаются">${((data.rrrPreset.gearRate ?? 0) * 100).toFixed(1)}% на ткань и кожу</span>` : r.returnable === false ? '—' : `${r.materialSource === 'refine' && r.refineOption ? `<span title="Два независимых возврата двух разных этапов: переработка сырья в полуфабрикат (${(r.refineOption.rate * 100).toFixed(1)}%) и крафт гира из готового полуфабриката (${((r.rrr || 0) * 100).toFixed(1)}%). Не складываются в одно число — каждый снижает нужное количество на своём этапе закупки.">${(r.refineOption.rate * 100).toFixed(1)}% сырьё · ${((r.rrr || 0) * 100).toFixed(1)}% гир</span>` : `${((r.rrr || 0) * 100).toFixed(1)}%`}${r.cityBonus ? ` <span class="city-bonus" title="Город закупки (${r.cheapestCity}) даёт спец-бонус именно этому типу ресурса: возврат выше базового">★ бонус</span>` : ''}`}</td>
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

  // Хронология цикла: сводка → Шаг 1 «Сырьё» (закупка, план по городам, логистика) → Шаг 2 «Продажа» (сразу и терпеливо); «Что если» — отдельно.
  craftEl.result.innerHTML = `
    <div class="craft-result-shell">
    ${scoreboardHtml(data)}
    <ol class="craft-flow">
      <li class="craft-step">
        <span class="step-badge" aria-hidden="true">1</span>
        <div class="step-body">
          <h3 class="step-title">Сырьё <small>закупка и переработка</small></h3>
          ${warning}
          <div class="table-scroll"><table class="craft-recipe-table" id="craft-recipe-table">
      <thead><tr><th>Материал</th><th>Нужно всего</th><th>Где дешевле</th><th>Сумма</th><th>Дней на закупку</th><th title="Ставка возврата ресурсов для этого материала в городе его покупки">Возврат</th></tr></thead>
      <tbody>${recipeRows}</tbody>
      <tfoot><tr class="materials-total"><td colspan="3">Итого материалы к закупке (с учётом возврата)</td><td>${fmtNum(materialsTotal)}</td><td></td><td></td></tr>${data.manualPrices ? '<tr><td colspan="6"><button type="button" class="manual-reset">Сбросить свои цены</button> <small>Расчёт идёт по твоим ценам; «Сравнение по качеству и тирам» считает по рыночным.</small></td></tr>' : ''}</tfoot>
    </table></div>
          ${acquisitionPlanHtml(data)}
          <div class="craft-summary">
      <div class="craft-summary-row"><span>Себестоимость материала / шт (сырое)</span><span>${Math.round(data.materialCostPerUnit).toLocaleString('ru-RU', { maximumFractionDigits: 0 })}</span></div>
      <div class="craft-summary-row"><span title="${data.rrrPreset.label}; у каждого материала своя ставка (см. таблицу материалов)">Себестоимость с учётом RRR (в среднем ${(data.rrrPreset.rrr * 100).toFixed(1)}%) / шт</span><span>${Math.round(data.effectiveCostPerUnit).toLocaleString('ru-RU', { maximumFractionDigits: 0 })}</span></div>
          </div>
          ${baseChoiceHtml(data)}
          ${enchantAfterHtml(data)}
          ${teleportHtml(data)}
        </div>
      </li>
      <li class="craft-step">
        <span class="step-badge" aria-hidden="true">2</span>
        <div class="step-body">
          <h3 class="step-title">Продажа <small>сразу в Buy Order и терпеливо через Sell Order</small></h3>
          <div class="craft-summary">
      <div class="craft-summary-row"><span>Продажа в Buy Order: лучшая цена (мгновенно, в чужой ордер на покупку)</span><span>${data.bestSell && !data.bestSell.manual ? `${data.bestSell.blackMarket ? '⚫ ' : ''}${data.bestSell.city}: ${data.bestSell.price.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}` : data.bestSell ? `своя цена: ${data.bestSell.price.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}` : 'нет данных'} <input id="manual-sell-price" class="manual-price ${manualSellPrice !== null ? 'is-manual' : ''}" type="number" min="0" step="1" placeholder="своя цена" value="${manualSellPrice !== null ? manualSellPrice : ''}" title="Вписал цену, по которой реально продаёшь, — профит пересчитается сразу" /></span></div>
      <div class="craft-summary-row"><span>После налога с продажи (${((data.bestSell && data.bestSell.taxRate !== undefined ? data.bestSell.taxRate : data.taxRate) * 100).toFixed(data.bestSell && data.bestSell.blackMarket ? 1 : 0)}%${data.bestSell && data.bestSell.blackMarket ? ', Чёрный Рынок' : ''})</span><span>${data.netSellPrice !== null ? Math.round(data.netSellPrice).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) : '—'}</span></div>
      <div class="craft-summary-row"><span>Профит / шт</span><span class="${profitClass}">${data.profitPerUnit !== null ? Math.round(data.profitPerUnit).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) : '—'}</span></div>
      <div class="craft-summary-row"><strong>Итого на ${data.quantity.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} шт</strong><strong class="${profitClass}">${data.totalProfit !== null ? Math.round(data.totalProfit).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) : '—'}</strong></div>
          </div>
          <details style="margin-top:10px">
      <summary style="cursor:pointer; font-size:13px; color:#9aa0aa">Цены готового предмета по городам</summary>
      <div class="table-scroll"><table class="craft-recipe-table" id="craft-sell-table" style="margin-top:6px">
        <thead><tr><th>Город</th><th>Купить</th><th>Продать</th></tr></thead>
        <tbody>${sellRows}</tbody>
      </table></div>
    </details>
          ${patientSellHtml(data)}
        </div>
      </li>
    </ol>
    ${data.tierComparison && data.tierComparison.length ? `<div class="craft-whatif">
      <h3 class="whatif-title">Что если <small>другой тир — решается до закупки, вне цикла</small></h3>
      ${tierComparisonHtml(data)}
    </div>` : ''}
    </div>
  `;

  craftEl.result.querySelectorAll('tr.tier-row').forEach((tr) => tr.addEventListener('click', () => switchCraftTier(tr.dataset.itemId)));
  bindSalePlanEditing();
  bindManualPrices();
  bindPurchaseLog();
  wireTableSort(craftEl.result.querySelector('#craft-recipe-table'), 'craft-recipe');
  wireTableSort(craftEl.result.querySelector('#craft-sell-table'), 'craft-sell');
}


// Цена материала: самая дешёвая — в подписи, клик раскрывает все города (чтобы раскидать терпеливые ордера на закупку
// по нескольким городам и быстрее собрать сырьё).
// Оборот/день строки скана: сумма по городам продажи и раскрывающийся список «город — сколько торгуется» (как «Где дешевле» у материалов).
function volumeCell(r, showCount) {
  // «Данные устарели на N дней»: возраст последней сделки в городах продажи; от 2 дней — жёлтым (данные старые — оборот сегодня мог быть другим)
  const age = r.dataAgeDays;
  const ageNote = age !== null && age !== undefined && age >= 2
    ? `<br><small class="scan-stale" title="Последняя сделка в городах продажи была ${age.toFixed(1)} дн. назад — оборот считан по старым данным">данные устарели на ${age.toFixed(1)} дн.</small>` : '';
  const filledNote = r.filledCities ? `<br><small class="scan-stale" title="В окне скана в ${r.filledCities} г. сделок нет — взят средний оборот прошлых дней (до 10 дней). Основная оценка идёт по окну скана">${r.filledCities} г. — из прошлых дней</small>` : '';
  const main = `${fmtNum(r.dailyVolume, 1)}${showCount ? ` <small>(${r.sellCities.length} гор.)</small>` : ''}`;
  if (!r.byCity || r.byCity.length < 2) return main + ageNote + filledNote;
  const list = r.byCity.map((c) => `<li class="${c.inPlan ? '' : 'city-out'}">${c.city}: ${fmtNum(c.dailyVolume, 1)}/день · цена ${fmtNum(c.avgPrice)} <small>${c.inPlan ? 'в расчёте' : 'вне расчёта'}</small>${c.filled ? ' <small class="scan-stale" title="В окне скана сделок нет — оборот из прошлых дней">за прошлые дни</small>' : ''}</li>`).join('');
  return `<details class="city-prices"><summary>${main}</summary><ul>${list}</ul></details>${ageNote}${filledNote}`;
}

// Название материала по id (в т.ч. зачарованного T4_ORE_LEVEL1@1 → «… .1»).
// Название материала: сначала из ответа сервера (знает руны, души, реликты, плащ с зачарованием), иначе по каталогу клиента
function nameOfId(data, id) { return (data && data.names && data.names[id]) || itemLabel(id); }
function itemLabel(id) {
  const m = String(id).match(/^(.+?)_LEVEL(\d)@\d$/);
  return m ? `${itemName(m[1])} .${m[2]}` : itemName(id);
}
// Материал выгоднее переработать самому: город переработки, состав (сырьё + предыдущий тир) и цена готового с рынка для сравнения.
// Две ставки возврата НЕ склеиваются: переработка (по составу) и крафт гира (в колонке «Возврат») — разные действия.
// Плащ-ингредиент выгоднее скрафтить самому: сам плащ в рецепте не возвращается, но ткань и кожа для него — с возвратом при крафте
function craftSourceHtml(r) {
  const o = r.craftOption;
  const parts = o.components.map((c) => `${c.count}× ${itemLabel(c.id)}`).join(' + ');
  const buy = r.buyPrice ? `; готовый на рынке — ${fmtNum(r.buyPrice)}` : '';
  return `<span class="refine-source" title="Сам плащ-ингредиент в рецепте не возвращается, но если крафтить его самому — возврат при крафте действует на ткань и кожу${buy}">🔨 выгоднее скрафтить самому: ${fmtNum(r.cheapestPrice)}${r.buyPrice ? ` (−${Math.round((1 - r.cheapestPrice / r.buyPrice) * 100)}%)` : ''}</span><br><small>${parts}</small>`;
}
function refineSourceHtml(r) {
  const o = r.refineOption;
  const parts = o.components.map((c) => `${c.count}× ${itemLabel(c.id)}`).join(' + ');
  const buy = r.buyPrice ? `; готовый на рынке — ${fmtNum(r.buyPrice)}` : '';
  return `<span class="refine-source" title="Сырьё и полуфабрикат предыдущего тира по рыночным ценам, ставка возврата при переработке ${(o.rate * 100).toFixed(1)}%${buy}">♻ выгоднее переработать в ${o.city}: ${fmtNum(r.cheapestPrice)}${r.buyPrice ? ` (−${Math.round((1 - r.cheapestPrice / r.buyPrice) * 100)}%)` : ''}</span><br><small>${parts}</small>`;
}

// Подпись в строке скана: какие материалы рецепта выгоднее переработать самому (♻), а какие купить готовыми.
function refinedNote(r) {
  if (!r.refined || r.refined.length === 0) return '';
  const refinedList = r.refined.filter((m) => !m.crafted);
  const craftedList = r.refined.filter((m) => m.crafted);
  const line = (m) => `${itemLabel(m.id)}: ${m.crafted ? 'скрафтить самому' : `переработать в ${m.city}`} — ${fmtNum(m.price)} вместо ${fmtNum(m.buyPrice)}`;
  const tip = r.refined.map(line).join('; ');
  const parts = [];
  if (refinedList.length) parts.push(`♻ переработка: ${refinedList.length}`);
  if (craftedList.length) parts.push(`🔨 плащ самому: ${craftedList.length}`);
  return `<br><small class="refine-source" title="${tip}">${parts.join(' · ')}</small>`;
}

// Серая подсказка в поле «своя цена»: цена за штуку по рынку (без копеек от 100)
function unitPlaceholder(p) {
  return p === null || p === undefined ? 'своя цена' : String(Math.round(p * (Math.abs(p) < 100 ? 10 : 1)) / (Math.abs(p) < 100 ? 10 : 1));
}

function cityPricesCell(cheapestCity, cheapestPrice, cityPrices) {
  const main = `${cheapestCity}: ${fmtNum(cheapestPrice)}`;
  if (!cityPrices || cityPrices.length < 2) return main;
  const list = cityPrices.map((c) => `<li>${c.city}: ${fmtNum(c.price)}${c.price > cheapestPrice ? ` <small>(+${((c.price / cheapestPrice - 1) * 100).toFixed(0)}%)</small>` : ''}</li>`).join('');
  return `<details class="city-prices"><summary>${main}</summary><ul>${list}</ul></details>`;
}

// Лог закупок: список реально купленных стаков (кол-во × цена за штуку) по материалу. Средняя цена подставляется вместо рыночной,
// а «куплено X из Y» показывает, сколько ещё нужно докупить. Считается на месте, без запроса.
// scope — метка таблицы: тот же материал есть в таблице рецепта и в плане закупки, и поле нужно находить именно в своей таблице
function lotLogHtml(r, scope = '') {
  const sc = scope ? ` data-scope="${scope}"` : '';
  const lots = purchaseLots.get(r.resource) || [];
  const avg = lotsAverage(lots);
  const rows = lots.map((l, i) => `<div class="lot-row">
      <input class="lot-qty" type="number" min="1" step="1" data-res="${r.resource}" data-idx="${i}"${sc} value="${l.qty}" placeholder="шт" title="Сколько штук в стаке" />
      <span>×</span>
      <input class="lot-price" type="number" min="0" step="1" data-res="${r.resource}" data-idx="${i}"${sc} value="${l.price}" placeholder="цена" title="Цена за штуку" />
      <button type="button" class="lot-del" data-res="${r.resource}" data-idx="${i}"${sc} title="Убрать стак">×</button>
    </div>`).join('');
  const need = r.needed || r.neededToBuy || 0;
  const progress = avg ? `куплено ${fmtNum(avg.qty)} из ${fmtNum(need)} (${need > 0 ? Math.round((avg.qty / need) * 100) : 0}%)` : `нужно ${fmtNum(need)}`;
  return `<div class="lot-log">${rows}<button type="button" class="lot-add" data-res="${r.resource}"${sc}>+ стак</button>
    <div class="lot-sum"><small>${avg ? `средняя ${fmtNum(avg.avg, 1)} · ` : ''}${progress}</small></div></div>`;
}
const scopeSel = (el) => (el.dataset.scope ? `[data-scope="${el.dataset.scope}"]` : ':not([data-scope])');
function bindPurchaseLog() {
  let timer = null;
  const rerenderKeepingFocus = (selector, caret) => {
    renderCraftResult(lastCraftData);
    const again = craftEl.result.querySelector(selector);
    if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch (e) { /* number input */ } }
  };
  craftEl.result.querySelectorAll('input.lot-qty, input.lot-price').forEach((inp) => {
    inp.addEventListener('input', () => {
      const lots = purchaseLots.get(inp.dataset.res);
      const v = parseFloat(inp.value);
      lots[Number(inp.dataset.idx)][inp.classList.contains('lot-qty') ? 'qty' : 'price'] = Number.isFinite(v) ? v : '';
      const selector = `input.${inp.classList.contains('lot-qty') ? 'lot-qty' : 'lot-price'}[data-res="${inp.dataset.res}"][data-idx="${inp.dataset.idx}"]${scopeSel(inp)}`;
      const caret = inp.selectionStart;
      clearTimeout(timer);
      timer = setTimeout(() => rerenderKeepingFocus(selector, caret), 350);
    });
  });
  craftEl.result.querySelectorAll('button.lot-add').forEach((btn) => btn.addEventListener('click', () => {
    if (!purchaseLots.has(btn.dataset.res)) purchaseLots.set(btn.dataset.res, []);
    const lots = purchaseLots.get(btn.dataset.res);
    lots.push({ qty: '', price: '' });
    rerenderKeepingFocus(`input.lot-qty[data-res="${btn.dataset.res}"][data-idx="${lots.length - 1}"]${scopeSel(btn)}`, 0);
  }));
  craftEl.result.querySelectorAll('button.lot-del').forEach((btn) => btn.addEventListener('click', () => {
    purchaseLots.get(btn.dataset.res).splice(Number(btn.dataset.idx), 1);
    renderCraftResult(lastCraftData);
  }));
}

// --- Копирование названия для поиска в аукционе ---
// Клик по предмету (выбранный гир, материал в таблице рецепта или плана закупки) копирует его игровое название без тира («Палаш (знаток)»,
// «Слиток стали»): аукцион ищет по названию, а не по техническому id. Зачарование и качество в игре — отдельные фильтры интерфейса, а не часть
// строки поиска, поэтому вместо них в подсказке говорим, какие фильтры выбрать.
function auctionFilters(el) {
  const id = String(el.dataset.copyId);
  let enchant = 0;
  let quality = 1;
  if (el.dataset.copyGear) { enchant = Number(craftEl.enchant.value) || 0; quality = Number(craftEl.quality.value) || 1; }
  else { const m = id.match(/_LEVEL(\d)@\d$/) || id.match(/@(\d)$/); if (m) enchant = Number(m[1]); }
  const parts = [];
  if (enchant > 0) parts.push(`зачарование ${enchant}`);
  if (quality > 1) parts.push(`качество ${QUALITY_WORDS[quality]}`);
  return parts;
}
async function onCopyClick(e) {
  const el = e.target.closest('[data-copy-id]');
  if (!el || e.target.closest('select, input, button, a')) return;
  await copyAuctionName(el.dataset.copyId, auctionFilters(el), el.dataset.copyName || '');
}

// Свои цены: значение запоминаем сразу, перерисовку откладываем (быстрый ввод не теряется), фокус и курсор возвращаем на то же поле.
function bindManualPrices() {
  let timer = null;
  const commit = (inp, apply) => {
    apply();
    const selector = inp.id ? `#${inp.id}` : `input.manual-price[data-res="${inp.dataset.res}"]${scopeSel(inp)}`;
    const caret = inp.selectionStart;
    clearTimeout(timer);
    timer = setTimeout(() => {
      renderCraftResult(lastCraftData);
      const again = craftEl.result.querySelector(selector);
      if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch (e) { /* number input */ } }
    }, 350);
  };
  craftEl.result.querySelectorAll('input.manual-price[data-res]').forEach((inp) => {
    inp.addEventListener('input', () => commit(inp, () => {
      const v = parseFloat(inp.value);
      if (Number.isFinite(v) && v >= 0) manualMaterialPrice.set(inp.dataset.res, v); else manualMaterialPrice.delete(inp.dataset.res);
    }));
  });
  const sell = craftEl.result.querySelector('#manual-sell-price');
  if (sell) sell.addEventListener('input', () => commit(sell, () => { const v = parseFloat(sell.value); manualSellPrice = Number.isFinite(v) && v >= 0 ? v : null; }));
  const reset = craftEl.result.querySelector('.manual-reset');
  if (reset) reset.addEventListener('click', () => { manualMaterialPrice.clear(); purchaseLots.clear(); manualSellPrice = null; manualCityPrice.clear(); renderCraftResult(lastCraftData); });
}

// Первая правка набора городов фиксирует набор автоплана как «галочки», дальше набор ведёт пользователь.
function ensureCityToggles() {
  if (saleCityToggles.size > 0) return;
  const auto = lastCraftData.patientSell && lastCraftData.patientSell.plan ? lastCraftData.patientSell.plan.cities.map((c) => c.city) : [];
  for (const c of lastCraftData.patientSell.byCity) saleCityToggles.set(c.city, auto.includes(c.city));
}

// Ручное редактирование плана продажи: ввод количества в любом городе пересчитывает срок, цикл и профит в реальном времени.
function bindSalePlanEditing() {
  let timer = null;
  craftEl.result.querySelectorAll('input.plan-qty').forEach((inp) => {
    inp.addEventListener('input', () => {
      // значение запоминаем сразу (иначе быстрый ввод в два города потеряет первый), а перерисовку откладываем
      manualSalePlan.set(inp.dataset.city, Math.max(Math.floor(Number(inp.value) || 0), 0));
      // вписанное количество включает город в план (в том числе тот, что автоплан не взял — например, город без сделок со своей ценой)
      if (Number(inp.value) > 0) {
        ensureCityToggles();
        saleCityToggles.set(inp.dataset.city, true);
      }
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
      ensureCityToggles();
      saleCityToggles.set(box.dataset.city, box.checked);
      if (!box.checked) manualSalePlan.delete(box.dataset.city);
      renderCraftResult(lastCraftData);
    });
  });
  craftEl.result.querySelectorAll('input.plan-city-price').forEach((inp) => {
    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value);
      if (Number.isFinite(v) && v >= 0) manualCityPrice.set(inp.dataset.city, v); else manualCityPrice.delete(inp.dataset.city);
      const city = inp.dataset.city;
      const caret = inp.selectionStart;
      clearTimeout(timer);
      timer = setTimeout(() => {
        renderCraftResult(lastCraftData);
        const again = craftEl.result.querySelector(`input.plan-city-price[data-city="${city}"]`);
        if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch (e) { /* number input */ } }
      }, 350);
    });
  });
  const strategy = craftEl.result.querySelector('#sale-strategy');
  if (strategy) strategy.addEventListener('change', () => { saleStrategy = strategy.value; renderCraftResult(lastCraftData); });
  const reset = craftEl.result.querySelector('.plan-reset');
  if (reset) reset.addEventListener('click', () => { manualSalePlan.clear(); saleCityToggles.clear(); manualCityPrice.clear(); renderCraftResult(lastCraftData); });
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
// Строки плана закупки материала рецепта: одна (купить готовый) или две (сырьё + полуфабрикат пред. тира, если переработка). Если источник
// после смены ставки переработки на месте уже другой — плана под него нет (нужен новый расчёт), строки не показываем.
function acquireRowsFor(data, r) {
  const rows = data.acquire ? data.acquire.byResource.filter((a) => (a.parent || a.resource) === r.resource) : [];
  const wanted = r.materialSource === 'refine' ? 'refine' : r.materialSource === 'craft' ? 'craft' : 'buy';
  return rows.every((a) => (a.source || 'buy') === wanted) ? rows : [];
}
function acquirePlanHtml(data, r) {
  return acquireRowsFor(data, r).map((row) => acquireRowPlanHtml(row, acquireRowsFor(data, r).length > 1)).join('');
}
function acquireRowPlanHtml(row, labelled) {
  const plan = row && row.plan;
  if (!plan || plan.cities.length === 0) return '';
  const label = labelled ? `${row.role === 'raw' ? 'сырьё' : 'полуфабрикат пред. тира'} — ${itemLabel(row.queryId)}: ` : '';
  const cities = plan.cities.map((c) => `<li>${c.city}: ${fmtNum(c.qty)} шт по ${fmtNum(c.avgPrice)} <small>(допуск ${(c.tolerance * 100).toFixed(0)}%, ${fmtDays(c.days)})</small></li>`).join('');
  const skipped = plan.excluded.length ? `<li class="plan-skipped">вне плана: ${plan.excluded.map((e) => `${e.city} (${e.reason})`).join('; ')}</li>` : '';
  return `<details class="acquire-plan"><summary>${label}план закупки${plan.cities.length > 1 ? ` (${plan.cities.length} гор., +${plan.overpayPct.toFixed(1)}% к лучшей цене)` : ''}</summary><ul>${cities}${skipped}</ul></details>`;
}

// «План закупки» — что именно покупать: для каждого полуфабриката либо он сам, либо (если выгоднее переработка) сырьё и полуфабрикат
// предыдущего тира; плюс материалы зачарования. По строке — сколько, где, цена, своя цена/лог лотов и подытог; внизу итог плана.
// Строится из текущего (уже пересчитанного на месте) результата, поэтому следует за ставками возврата и своими ценами; города и сроки
// берутся из серверного плана, если он ещё соответствует выбранному источнику и количеству.
function acquisitionRowsData(data) {
  const byRes = data.acquire ? data.acquire.byResource : [];
  const planFor = (pick) => byRes.find(pick) || null;
  const rows = [];
  for (const r of data.recipe) {
    if (r.cheapestPrice === null || r.materialSource === 'points') continue;
    if (r.materialSource === 'craft' && r.craftOption) {
      r.craftOption.components.forEach((cp) => {
        const srv = planFor((a) => a.parent === r.resource && a.source === 'craft' && a.queryId === cp.id);
        rows.push({ key: cp.id, id: cp.id, baseName: nameOfId(data, cp.id), name: `${nameOfId(data, cp.id)} <small>(для крафта: ${r.resourceName})</small>`, needed: Math.ceil(r.neededToBuy * cp.count * cp.factor), srv, fallbackPrice: cp.price, fallbackCity: cp.city });
      });
    } else if (r.materialSource === 'refine' && r.refineOption) {
      r.refineOption.components.forEach((cp, i) => {
        const role = i === 0 ? 'raw' : 'prev';
        const needed = Math.ceil(r.neededToBuy * cp.count * (1 - r.refineOption.rate));
        const srv = planFor((a) => a.parent === r.resource && a.source === 'refine' && a.role === role);
        rows.push({ key: cp.id, id: cp.id, baseName: nameOfId(data, cp.id), name: `${nameOfId(data, cp.id)} <small>(${role === 'raw' ? 'сырьё' : 'полуфабрикат пред. тира'} → ${r.resourceName})</small>`, needed, srv, fallbackPrice: cp.price, fallbackCity: cp.city });
      });
    } else {
      const srv = planFor((a) => (a.parent || a.resource) === r.resource && (a.source || 'buy') === 'buy');
      rows.push({ key: r.resource, id: r.queryId || r.resource, baseName: nameOfId(data, r.queryId || r.resource), name: data.names && data.names[r.queryId || r.resource] ? data.names[r.queryId || r.resource] : r.resourceName, needed: r.neededToBuy, srv, fallbackPrice: r.buyPrice || r.cheapestPrice, fallbackCity: r.cheapestCity });
    }
  }
  if (data.enchantAfterCraft) {
    for (const st of data.enchantAfterCraft.steps) {
      const srv = planFor((a) => a.resource === st.materialId);
      rows.push({ key: st.materialId, id: st.materialId, baseName: st.materialName, name: `${st.materialName} <small>(зачарование .${st.level - 1} → .${st.level})</small>`, needed: st.count * data.quantity, srv, fallbackPrice: st.cheapestPrice, fallbackCity: st.cheapestCity });
    }
  }
  return rows;
}
function acquisitionPlanHtml(data) {
  const rows = acquisitionRowsData(data);
  if (rows.length === 0) return '';
  let total = 0;
  const body = rows.map((row) => {
    const plan = row.srv && row.srv.plan && row.srv.plan.cities.length && row.srv.plan.cities.reduce((s, c) => s + c.qty, 0) === row.needed ? row.srv.plan : null;
    const own = ownPriceFor(row.key);
    const marketPrice = plan ? plan.avgPrice : row.srv && row.srv.unitPrice ? row.srv.unitPrice : row.fallbackPrice;
    const unit = own !== undefined ? own : marketPrice;
    const sub = unit === null || unit === undefined ? null : unit * row.needed;
    if (sub !== null) total += sub;
    const cities = plan
      ? `${plan.cities.map((c) => `${c.city}: ${fmtNum(c.qty)} шт по ${fmtNum(c.avgPrice)} <small>(допуск ${(c.tolerance * 100).toFixed(0)}%, ${fmtDays(c.days)})</small>`).join('<br>')}${plan.cities.length > 1 ? `<br><small>+${plan.overpayPct.toFixed(1)}% к лучшей цене</small>` : ''}`
      : `${row.fallbackCity || '—'}${row.fallbackCity ? `: ${fmtNum(row.needed)} шт` : ''}${row.srv ? '' : ' <small>(план по городам — после «Посчитать»)</small>'}`;
    const days = row.srv && row.srv.daysToAcquire !== null && row.srv.daysToAcquire !== undefined ? row.srv.daysToAcquire : null;
    const control = craftEl.purchaseLog.checked
      ? lotLogHtml({ resource: row.key, needed: row.needed }, 'plan')
      : `<input class="manual-price ${own !== undefined ? 'is-manual' : ''}" type="number" min="0" step="1" data-res="${row.key}" data-scope="plan" placeholder="${unitPlaceholder(marketPrice)}" value="${manualMaterialPrice.has(row.key) ? manualMaterialPrice.get(row.key) : ''}" title="Видишь другую цену в игре — впиши её: расчёт обновится сразу" />`;
    return `<tr>
        <td class="copyable" data-copy-id="${row.id}" data-copy-name="${row.baseName}" title="Клик — скопировать название для поиска в аукционе"><img class="item-icon-sm" src="${iconUrl(row.id, 40)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" /> ${row.name}</td>
        <td>${fmtNum(row.needed)}</td>
        <td class="plan-cities">${cities}</td>
        <td data-sort-value="${unit ?? ''}">${unit === null || unit === undefined ? 'нет цены' : `${fmtNum(unit, unit < 100 ? 1 : 0)}${own !== undefined ? ' <small class="is-manual-note">своя</small>' : ''}`}</td>
        <td>${control}</td>
        <td data-sort-value="${sub ?? ''}">${sub === null ? '—' : fmtNum(sub)}</td>
        <td data-sort-value="${days ?? ''}">${days !== null ? fmtDays(days) : '—'}</td>
      </tr>`;
  }).join('');
  return `
    <h4 class="plan-title">План закупки <small>что и где покупать — с учётом возврата при переработке и при крафте</small></h4>
    <div class="table-scroll"><table class="craft-recipe-table" id="craft-acquire-table">
      <thead><tr><th>Что покупаем</th><th>Нужно, шт</th><th>Города закупки</th><th>Цена / шт</th><th>Своя цена</th><th>Подытог</th><th>Дней</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr class="materials-total"><td colspan="5">Итого на план закупки</td><td>${fmtNum(total)}</td><td></td></tr></tfoot>
    </table></div>`;
}

// Дней на закупку материала (по истории торгов, с учётом доли рынка); null — нет данных.
function acquireDaysFor(data, r) {
  const rows = acquireRowsFor(data, r);
  if (rows.length === 0 || rows.some((row) => row.daysToAcquire === null)) return null;
  return Math.max(...rows.map((row) => row.daysToAcquire));      // материал из двух закупок готов, когда куплено и то и другое
}

// Сводка цикла сверху: сколько денег уйдёт на весь цикл и сколько маржи получится — сразу (Buy Order) и терпеливо (Sell Order, по плану
// продажи). Цена и профит за штуку — мелкой подписью. Перерисовывается вместе с результатом, поэтому любая правка плана её обновляет.
function scoreboardHtml(data) {
  const money = (n) => (n === null || n === undefined ? '—' : Math.round(n).toLocaleString('ru-RU', { maximumFractionDigits: 0 }));
  const cls = (n) => (n === null || n === undefined ? '' : n > 0 ? 'profit-pos' : 'profit-neg');
  const p = data.patientSell;
  const st = p ? salePlanState(p, data) : null;
  const live = st && st.totalQty > 0 ? st : null;
  const patientUnit = p ? (live ? live.profitUnit : p.profitPerUnit) : null;
  const patientQty = live ? live.totalQty : data.quantity;
  const patientTotal = patientUnit === null || patientUnit === undefined ? null : patientUnit * patientQty;
  const sellDays = p ? (live ? live.planDays : p.daysToSellBatch) : null;
  const cycle = data.acquire && data.acquire.days !== null && sellDays !== null && sellDays !== undefined ? data.acquire.days + sellDays : null;
  return `
    <div class="craft-scoreboard">
      <div class="sb-cell sb-cost"><span class="sb-label">Нужно денег на весь цикл</span><b class="sb-value">${money(data.totalCost)}</b><small>${money(data.effectiveCostPerUnit)} за штуку · ${data.quantity.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} шт${cycle !== null ? ` · цикл ${fmtDays(cycle)}` : ''}</small></div>
      <div class="sb-cell"><span class="sb-label">Маржа всего · сразу (Buy Order)</span><b class="sb-value ${cls(data.totalProfit)}">${money(data.totalProfit)}</b><small>${money(data.profitPerUnit)} за штуку</small></div>
      <div class="sb-cell"><span class="sb-label">Маржа всего · терпеливо (Sell Order)</span><b class="sb-value ${cls(patientTotal)}">${money(patientTotal)}</b><small>${money(patientUnit)} за штуку${sellDays !== null && sellDays !== undefined ? ` · продажа ${fmtDays(sellDays)}` : ''}</small></div>
      ${factionTileHtml(data, patientUnit)}
    </div>`;
}

// Плитка фракционного режима: сколько плащей хватит на очки, профит на очко и сравнение с продажей герба и сердца (в расчёте на очко)
function factionTileHtml(data, patientUnit) {
  const f = data.faction;
  if (!f) return '';
  const unit = patientUnit !== null && patientUnit !== undefined ? patientUnit : data.profitPerUnit;
  const perPoint = unit === null || unit === undefined ? null : unit / f.pointsPerCape;
  const spent = data.quantity * f.pointsPerCape;
  const enough = f.availablePoints > 0 ? `хватит на ${fmtNum(f.maxCapes)} плащей · на ${fmtNum(data.quantity)} шт: ${fmtNum(spent)} очков, ${f.availablePoints >= spent ? `остаток ${fmtNum(f.availablePoints - spent)}` : `<span class="scan-stale">не хватает ${fmtNum(spent - f.availablePoints)}</span>`}` : 'очки не введены';
  const parts = f.partsNet === null || f.partsNet === undefined ? 'нет цен герба и сердца'
    : `продажа герба и сердца: ${fmtNum(f.partsNet)} (${fmtNum(f.partsNet / f.pointsPerCape, 1)}/очко) — ${unit !== null && unit !== undefined && unit > f.partsNet ? 'крафт выгоднее' : 'выгоднее продать детали'}`;
  return `<div class="sb-cell faction-tile"><span class="sb-label">Фракционные очки · ${f.name}</span><b class="sb-value">${perPoint === null ? '—' : fmtNum(perPoint, 1)}</b><small>профит на очко · ${fmtNum(f.pointsPerCape)} очков на плащ · ${enough}<br>${parts}</small></div>`;
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
// 'profit' — жадно: города с лучшим ИНДЕКСОМ ПРОФИТА (профит% × log2(2 + оборот)) берут партию первыми, но не больше своей «разумной вместимости»
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
  [...free].sort((a, b) => (b.profitIndex ?? 0) - (a.profitIndex ?? 0) || b.profitPerUnit - a.profitPerUnit).forEach((c) => {
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
  // город без оборота попадает в план только с вписанным количеством (и своей ценой — иначе цены нет)
  const sellable = (c) => (c.avgDailyVolume > 0 || manualSalePlan.has(c.city)) && c.avgSellPrice !== null;
  const enabled = p.byCity.filter((c) => sellable(c) && enabledOf(c));
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
    const isEnabled = enabledOf(c) && sellable(c);
    const manual = manualSalePlan.has(c.city) && isEnabled;
    const qty = !isEnabled ? 0 : manual ? manualSalePlan.get(c.city) : (baseQty.get(c.city) || 0);
    const days = qty > 0 && c.avgDailyVolume > 0 ? qty / (c.avgDailyVolume * marketShare) : 0;
    return { c, qty, days, manual, tolerance: a ? a.tolerance : null, inPlan: !!a, enabled: isEnabled };
  });
  const totalQty = rowsData.reduce((sum, r) => sum + r.qty, 0);
  const planDays = rowsData.reduce((m, r) => Math.max(m, r.days), 0);       // города продают параллельно — срок по самому медленному
  const avgPrice = totalQty > 0 ? rowsData.reduce((sum, r) => sum + (r.c.avgSellPrice || 0) * r.qty, 0) / totalQty : null;
  // Чистая цена — по налогу КАЖДОГО города (Чёрный Рынок берёт свой, выше); одну общую ставку на смесь цен не применяем.
  const cityNet = (c) => (c.netPrice !== undefined ? c.netPrice : c.avgSellPrice * (1 - data.taxRate - (data.setupFeeRate || 0)));
  const netPrice = avgPrice === null ? null : rowsData.reduce((sum, r) => sum + cityNet(r.c) * r.qty, 0) / totalQty;
  const profitUnit = netPrice === null ? null : netPrice - data.effectiveCostPerUnit;
  const anyManual = rowsData.some((r) => r.manual) || anyToggle;
  const noVolume = rowsData.some((r) => r.qty > 0 && !(r.c.avgDailyVolume > 0));
  return { minPrice, marketShare, serverPlan, auto, anyManual, rowsData, totalQty, planDays, avgPrice, netPrice, profitUnit, noVolume };
}

function byCityHtml(p, data, st) {
  if (!st) return '';
  const { minPrice, marketShare, serverPlan, auto, anyManual, rowsData, totalQty, planDays, avgPrice, netPrice, profitUnit, noVolume } = st;

  const rows = rowsData.map(({ c, qty, days, manual, tolerance, inPlan, enabled: isOn }) => {
    const priced = c.avgSellPrice !== null;                 // у города без сделок за период цены нет, пока не впишешь свою
    const dim = (priced && minPrice !== null && c.avgSellPrice < minPrice && !manual) || !isOn;
    const cls = c.profitPerUnit > 0 ? 'profit-pos' : 'profit-neg';
    const canToggle = c.avgDailyVolume > 0 || (priced && manualSalePlan.has(c.city));
    const ownVal = manualCityPrice.has(c.city) ? manualCityPrice.get(c.city) : '';
    const priceCell = `${priced ? fmtNum(c.avgSellPrice) : '<small class="scan-stale">нет данных</small>'}${c.blackMarket ? '' : `<br><input class="plan-city-price ${c.ownPrice ? 'is-manual' : ''}" type="number" min="0" step="1" value="${ownVal}" data-city="${c.city}" placeholder="своя цена" title="${priced ? 'Видишь в игре другую цену продажи в этом городе — впиши её' : 'Сделок за период нет — впиши цену, которую видишь в игре, и город войдёт в план'}" />`}`;
    return `<tr class="${dim ? 'below-threshold' : ''}"><td class="plan-check"><input type="checkbox" class="plan-toggle" data-city="${c.city}" ${isOn ? 'checked' : ''} ${canToggle ? '' : 'disabled'} title="${canToggle ? 'Включить/выключить город в плане продажи — партия пересчитается' : c.noData ? 'Нет сделок за период: впиши свою цену и количество' : 'В этом городе нет сделок за период'}" /></td><td>${c.blackMarket ? `<span title="Чёрный Рынок: другой налог (${(c.taxRate * 100).toFixed(1)}%), не обычный город">⚫ ${c.city}</span>` : c.city}</td><td data-sort-value="${c.avgSellPrice ?? ''}">${priceCell}</td><td>${fmtNum(c.avgDailyVolume, 1)}</td><td class="${cls}">${priced ? fmtNum(c.profitPerUnit) : '—'}</td>
      <td data-sort-value="${qty}"><input class="plan-qty ${manual ? 'is-manual' : ''}" type="number" min="0" step="1" value="${qty}" data-city="${c.city}" ${priced ? '' : 'disabled'} title="Сколько штук планируешь продать в этом городе (введи своё — остальное пересчитается)" /></td>
      <td data-sort-value="${days}">${qty > 0 ? fmtDays(days) : '—'}${inPlan && tolerance && !manual ? ` <small>(допуск ${(tolerance * 100).toFixed(0)}%)</small>` : ''}</td>
      <td data-sort-value="${(c.profitPerUnit || 0) * qty}" class="${cls}">${qty > 0 && priced ? fmtNum(c.profitPerUnit * qty) : '—'}</td>
      <td data-sort-value="${c.profitIndex ?? 0}" title="Индекс профита = профит% × log2(2 + оборот): по нему города берут партию при «максимизировать профит»">${c.profitIndex ? fmtNum(c.profitIndex, 0) : '—'}</td></tr>`;
  }).join('');

  const sumOk = totalQty === data.quantity;
  const acquireDays = data.acquire && data.acquire.days !== null ? data.acquire.days : null;
  return `
    <details open class="by-city">
      <summary>План продажи через Sell Order по городам${minPrice !== null ? ` (серые — ниже порога ${fmtNum(minPrice)}, в автоплан не входят)` : ''}</summary>
      <label class="craft-field" title="«Максимизировать профит» — города с лучшим индексом профита берут партию первыми, но не больше разумной вместимости (до 1.5× срока равномерного плана). «Равномерно по времени» — партия делится пропорционально обороту, во всех городах она распродаётся за один срок">Распределение партии
        <select id="sale-strategy">
          <option value="profit" ${saleStrategy === 'profit' ? 'selected' : ''}>Максимизировать профит — по индексу профита (по умолчанию)</option>
          <option value="even" ${saleStrategy === 'even' ? 'selected' : ''}>Равномерно по времени</option>
        </select>
      </label>
      <div class="table-scroll"><table class="craft-recipe-table">
        <thead><tr><th>В плане</th><th>Город</th><th>Средняя цена</th><th>Сделок в день</th><th>Профит / шт</th><th>Везти сюда, шт</th><th>Дней здесь</th><th>Профит с города</th><th>Индекс профита</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="plan-summary">
        <div>Распределено: <strong class="${sumOk ? '' : 'scan-stale'}">${fmtNum(totalQty)} из ${fmtNum(data.quantity)} шт</strong>${sumOk ? '' : ' ⚠ (сумма плана не равна партии)'}
          ${anyManual ? '<button type="button" class="plan-reset">Сбросить к автоплану</button>' : ''}</div>
        <div>Срок распродажи по плану: <strong>${totalQty > 0 ? fmtDays(planDays) : '—'}</strong>${acquireDays !== null && totalQty > 0 ? ` · весь цикл (закупка ${fmtDays(acquireDays)} + продажа): <strong>${fmtDays(acquireDays + planDays)}</strong>` : ''}</div>
        <div>Средняя цена: <strong>${avgPrice !== null ? fmtNum(avgPrice) : '—'}</strong> · после налога ${netPrice !== null ? fmtNum(netPrice) : '—'} · профит / шт: <strong class="${profitUnit !== null && profitUnit > 0 ? 'profit-pos' : 'profit-neg'}">${profitUnit !== null ? fmtNum(profitUnit) : '—'}</strong> · итого: <strong class="${profitUnit !== null && profitUnit > 0 ? 'profit-pos' : 'profit-neg'}">${profitUnit !== null ? fmtNum(profitUnit * totalQty) : '—'}</strong></div>
        ${noVolume ? '<div class="scan-stale">⚠ В одном из городов нет сделок за период — срок продажи там посчитать нельзя.</div>' : ''}
      </div>
      <p class="calc-note">В автоплан входят все прибыльные города${data.blackMarket ? ' (включая Чёрный Рынок со своим налогом)' : ''}; при доле рынка ${(marketShare * 100).toFixed(0)}% автоплан занимает ${fmtDays(auto.days)}.${serverPlan ? `${serverPlan.excluded.length ? ` Вне автоплана: ${serverPlan.excluded.map((e) => `${e.city} — ${e.reason}`).join('; ')}.` : ''}` : ''} Включай и выключай города галочкой «В плане» или впиши своё количество — всё пересчитается сразу.</p>
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
  const bottleneck = a.byResource.find((r) => r.resource === a.bottleneckResource);   // resourceName у строк переработки уже с пояснением
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
      <div class="craft-summary-row"><span>После налога с продажи (${data.blackMarket ? 'у каждого города свой' : `${(data.taxRate * 100).toFixed(0)}%`})</span><span>${fmtNum(netPrice)}</span></div>
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
      budget: readGroupedNumber(lazyEl.budget) || '0', share: lazyEl.share.value || '25', sellDays: lazyEl.sellDays.value || '1',
      strategy: lazyEl.strategy.value, days: readCustomizable(lazyEl.history), ...gearRrrParams(craftEl.gearRrr, craftEl.gearRrrCustom), ...refineRrrParams(craftEl.refineRrr, craftEl.refineRrrCustom),
      cities: activeCities().join(','), premium: premiumParam(),
    });
    const data = await fetchJson(`/api/lazy-crafter?${params}`);
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

// --- Скан маржи и ликвидности (гир — по данным кувшина; сырьё и рефайн — отдельный скан на странице «Рефайн») ---
const marginEl = {
  factionOn: document.getElementById('margin-faction-on'),
  faction: document.getElementById('margin-faction'),
  factionPoints: document.getElementById('margin-faction-points'),
  factionPlan: document.getElementById('margin-faction-plan'),
  mode: document.getElementById('margin-mode'),
  blackMarket: document.getElementById('margin-black-market'),
  blackMarketField: document.getElementById('margin-black-market-field'),
  gearRrr: document.getElementById('margin-gear-rrr'),
  gearRrrCustom: document.getElementById('margin-gear-rrr-custom'),
  refineRrr: document.getElementById('margin-refine-rrr'),
  refineRrrCustom: document.getElementById('margin-refine-rrr-custom'),
  category: document.getElementById('margin-category'),
  enchantAfter: document.getElementById('margin-enchant-after'),
  materialHours: document.getElementById('margin-material-hours'),
  minDaily: document.getElementById('margin-min-daily'),
  days: document.getElementById('margin-days'),
  run: document.getElementById('margin-run'),
  result: document.getElementById('margin-result'),
};
marginEl.run.addEventListener('click', runMarginScan);
marginEl.factionOn.addEventListener('change', () => { document.getElementById('margin-faction-fields').hidden = !marginEl.factionOn.checked; });
// В мгновенном режиме партии и «ликвидности по городам» нет — лишние поля не показываем.
function syncMarginMode() {
  const patient = marginEl.mode.value === 'patient';
}
marginEl.mode.addEventListener('change', syncMarginMode);
let marginLastData = null;
syncMarginMode();

async function runMarginScan() {
  marginEl.run.disabled = true;
  marginEl.result.innerHTML = 'Считаю по данным кувшина: весь гир × зачарование × качество, это может занять несколько секунд...';
  try {
    const params = new URLSearchParams({
      mode: marginEl.mode.value, blackMarket: String(marginEl.blackMarket.checked),
      category: marginEl.category.value, enchantMode: marginEl.enchantAfter.checked ? 'after' : 'direct', liquidity: 'sum',   // оборот — сумма по всем городам (выбор «лучший город» убран)
      materialHours: readCustomizable(marginEl.materialHours), minDaily: marginEl.minDaily.value || '0', days: readCustomizable(marginEl.days), ...gearRrrParams(marginEl.gearRrr, marginEl.gearRrrCustom), ...refineRrrParams(marginEl.refineRrr, marginEl.refineRrrCustom),
      cities: activeCities().join(','), premium: premiumParam(),
    });
    if (marginEl.factionOn.checked) {
      params.set('faction', marginEl.faction.value);
      params.set('factionPoints', readGroupedNumber(marginEl.factionPoints) || '0');
      if (marginEl.factionPlan.checked) params.set('factionPlan', 'true');
    }
    const data = await fetchJson(`/api/unified-scan?${params}`);
    if (data.error) throw new Error(data.error);
    marginLastData = data;
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

// Скан в фракционном режиме: только плащи выбранной фракции, метрика — профит на очко; опционально — план трат очков (как «ленивый крафтер»)
function renderFactionScan(data) {
  const f = data.faction;
  const jugNote = data.jug && data.jug.lastPricePass ? `Кувшин: цены обновлены ${fmtAgeMinutes((Date.now() - data.jug.lastPricePass) / 60000)}.` : 'Кувшин ещё пуст — фоновый краулер только начал работу.';
  const qLabel = (r) => `T${r.tier} · .${r.enchant} · ${QUALITY_NAMES[r.quality]}`;
  // План трат очков открывается в калькуляторе (там можно вписывать свои цены); в скане остаётся только таблица комбинаций
  if (data.factionPlan) openFactionPlan(f.id, f.points);
  else if (typeof closeFactionPlan === 'function') closeFactionPlan();
  const planHtml = '';
  if (data.results.length === 0) {
    marginEl.result.innerHTML = `${planHtml}<div class="chart-empty">Ничего не нашлось — нет прибыльных плащей фракции «${f.name}» с таким оборотом. ${jugNote}</div>`;
    return;
  }
  const rows = data.results.map((r) => {
    const item = findItem(r.itemId) || { id: r.itemId, name: r.itemId };
    const verdict = r.partsNet === null || r.partsNet === undefined ? '<small class="scan-stale">нет цен герба/сердца</small>'
      : r.craftBeatsParts ? `<small class="profit-pos" title="Крафт плаща выгоднее, чем продать герб и сердце на рынке">крафт выгоднее</small>` : `<small class="scan-stale" title="Продать герб и сердце на рынке выгоднее, чем крафтить плащ">выгоднее продать детали</small>`;
    return `<tr>
      <td><span class="scan-item"><img class="item-icon-lg" src="${iconUrl(item.id, 96, r.enchant, r.quality)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" /><span>${item.name}${enchantTag(r.enchant)}<br><small class="scan-item-sub">${qLabel(r)}</small></span></span></td>
      <td data-sort-value="${r.cost}" title="Себестоимость без герба и сердца (они за очки): плащ-ингредиент${r.refined && r.refined.length ? ' (или скрафченный)' : ''}${r.enchant ? ' + зачарование' : ''}">${fmtNum(r.cost)}${refinedNote(r)}</td>
      <td>${fmtNum(r.avgSellPrice)}</td>
      <td data-sort-value="${r.dailyVolume}">${volumeCell(r, false)}</td>
      <td data-sort-value="${r.profitPerUnit}">+${fmtNum(r.profitPerUnit)} <small>(${r.profitPct.toFixed(0)}%)</small></td>
      <td data-sort-value="${r.factionPoints}" title="Сердце ${fmtNum(f.heartPoints)} + герб T${r.tier} ${fmtNum(f.crestPoints[r.tier])}">${fmtNum(r.factionPoints)}</td>
      <td class="scan-spread-hot" data-sort-value="${r.profitPerPoint}"><b>${fmtNum(r.profitPerPoint, 1)}</b></td>
      <td data-sort-value="${r.partsPerPoint ?? ''}" title="Сколько принесла бы продажа герба и сердца на рынке (после налога и сбора)">${r.partsNet === null || r.partsNet === undefined ? '—' : `${fmtNum(r.partsNet)} <small>(${fmtNum(r.partsPerPoint, 1)}/очко)</small>`}<br>${verdict}</td>
      <td class="${confidenceClass(r.confidence)}" data-sort-value="${r.confidence}">${Math.round(r.confidence * 100)}%<br><small>${r.tradeHours} ч</small></td>
      <td data-sort-value="${r.freshMinutes ?? ''}">${fmtAgeMinutes(r.freshMinutes)}</td>
      <td><button class="scan-add-btn" data-kind="gear" data-id="${item.id}" data-enchant="${r.enchant}" data-quality="${r.quality}">в калькулятор</button></td></tr>`;
  }).join('');
  marginEl.result.innerHTML = `${planHtml}
    <p class="calc-note">Фракционный режим: <b>${f.name}</b>, очков ${fmtNum(f.points)}. Только плащи этой фракции; герб и сердце получены за очки и в себестоимость не входят. Метрика — профит на очко (профит/шт ÷ очков на плащ); рядом — что дала бы продажа герба и сердца вместо крафта. По одной комбинации (тир/зачарование/качество) на плащ — с лучшим профитом на очко. ${jugNote}</p>
    <div class="table-scroll"><table class="scan-table" id="faction-scan-table">
      <thead><tr><th>Плащ</th><th>Себестоимость</th><th>Ср. цена продажи</th><th>Оборот/день</th><th>Маржа/шт</th><th>Очков на плащ</th><th>Профит на очко</th><th>Продать герб и сердце вместо крафта</th><th>Доверие</th><th>Свежесть</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  tableSortStates['margin-scan-faction'] = { label: 'Профит на очко', dir: 'desc' };
  wireTableSort(marginEl.result.querySelector('#faction-scan-table'), 'margin-scan-faction');
  marginEl.result.querySelectorAll('.scan-add-btn').forEach((btn) => btn.addEventListener('click', () => sendFactionToCalc(btn, data)));
}
// «В калькулятор» из фракционного скана: включает фракционный режим калькулятора (только так он и включается)
function sendFactionToCalc(btn, data) {
  const item = findItem(btn.dataset.id);
  if (!item) return;
  selectingFromFactionScan = true;
  selectCraftItem(item);
  selectingFromFactionScan = false;
  craftFaction = { id: data.faction.id, name: data.faction.name, points: data.faction.points };
  renderFactionBadge();
  craftEl.enchant.value = btn.dataset.enchant;
  craftEl.quality.value = btn.dataset.quality;
  refreshSelectedIcon();
  if (btn.dataset.quantity) craftEl.quantity.value = btn.dataset.quantity;    // из плана трат — количество плана
  else fitQuantityToPoints();                                                 // иначе — сколько плащей хватит на очки
  document.getElementById('craft-enchant-after').checked = data.enchantMode === 'after' && btn.dataset.enchant !== '0';
  document.getElementById('craft-controls').scrollIntoView({ behavior: 'smooth', block: 'center' });
  runCraftCalc();
}

function renderMarginScan(data) {
  if (data.faction) return renderFactionScan(data);
  const patient = data.mode === 'patient';
  const jugNote = data.jug && data.jug.lastPricePass
    ? `Кувшин: цены обновлены ${fmtAgeMinutes((Date.now() - data.jug.lastPricePass) / 60000)}, история — ${fmtAgeMinutes(data.jug.lastHistoryPass ? (Date.now() - data.jug.lastHistoryPass) / 60000 : null)}.`
    : 'Кувшин ещё пуст — фоновый краулер только начал работу, подожди пару минут.';
  if (data.results.length === 0) {
    marginEl.result.innerHTML = `<div class="chart-empty">Ничего не нашлось — нет прибыльных комбинаций с таким оборотом. Попробуй снизить «Оборот от» или сменить режим. ${jugNote}</div>`;
    return;
  }
  const rows = data.results.map((r) => {
    const item = findItem(r.itemId) || { id: r.itemId, name: r.itemId };
    const stale = r.freshMinutes !== null && r.freshMinutes > 180;
    const action = `<button class="scan-add-btn" data-kind="gear" data-id="${item.id}" data-enchant="${r.enchant}" data-quality="${r.quality}" data-black-market="${r.blackMarket ? 'true' : ''}">в калькулятор</button>`;
    return `
      <tr>
        <td><span class="scan-item"><img class="item-icon-lg" src="${iconUrl(item.id, 96, r.enchant, r.quality)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" /><span>${item.name}${enchantTag(r.enchant)}<br><small class="scan-item-sub">T${item.tier || '?'} · .${r.enchant} · ${QUALITY_NAMES[r.quality]}</small></span></span></td>
        <td data-sort-value="${r.quality}">${QUALITY_NAMES[r.quality]}</td>
        <td>${fmtNum(r.cost)}${refinedNote(r)}</td>
        <td>${fmtNum(r.avgSellPrice)}${patient ? '' : `<br><small>${r.blackMarket ? '⚫ ' : ''}${r.sellCities[0]}${r.blackMarket ? ` (налог ${(r.sellTaxRate * 100).toFixed(1)}%)` : ''}</small>`}</td>
        <td data-sort-value="${r.dailyVolume}">${volumeCell(r, patient && data.liquidity !== 'best')}</td>
        <td class="scan-spread-hot" data-sort-value="${r.profitPerUnit}">+${fmtNum(r.profitPerUnit)} (${r.profitPct.toFixed(0)}%)</td>
        <td data-sort-value="${r.marketProfitPerDay}" title="Профит/шт × оборот/день: сколько серебра в день, если бы забрал весь оборот рынка по этой позиции — масштаб без выдуманного капитала. Количество вводится в калькуляторе">${fmtNum(r.marketProfitPerDay)}</td>
        <td data-sort-value="${r.rankScore}">${fmtNum(r.rankScore, 0)}</td>
        <td class="${confidenceClass(r.confidence)}" data-sort-value="${r.confidence}" title="Цифры стоят на ${r.tradeHours} разных часах торговли за период (индекс доверия = n / (n + 20))">${Math.round(r.confidence * 100)}%<br><small>${r.tradeHours} ч</small></td>
        <td class="${stale ? 'scan-stale' : ''}" data-sort-value="${r.freshMinutes ?? ''}" title="Возраст самой старой цены в расчёте (материалы и продажа). Влияет на порядок списка">${fmtAgeMinutes(r.freshMinutes)}${stale ? ' ⚠' : ''}</td>
        <td>${action}</td>
      </tr>`;
  }).join('');
  const sellNote = patient
    ? `свой Sell Order по средней цене сделок за ${data.days} дн. только в прибыльных городах (налог ${(data.taxRate * 100).toFixed(0)}% + сбор за размещение ${(data.setupFeeRate * 100).toFixed(1)}%), оборот — ${data.liquidity === 'best' ? 'лучший город' : 'сумма по выбранным городам'}; «Дней цикла» — закупка узкого материала + распродажа позиции`
    : `продажа в текущий Buy Order лучшего города (налог ${(data.taxRate * 100).toFixed(0)}%, без сбора за размещение), оборот — сделки за ${data.days} дн. в этом городе`;
  marginEl.result.innerHTML = `
    <p class="calc-note">Просмотрено комбинаций: ${fmtNum(data.scanned)}. ${data.mode === 'patient' ? 'Терпеливый режим' : 'Мгновенный режим'}: ${sellNote}. Скан считает ОДНУ штуку: профит/шт и оборот; масштаб («сколько сделать») вводится в калькуляторе. Отбор — по рейтингу «профит % × log₂(2 + оборот)» с поправкой на свежесть котировок: ликвидность взвешена, а не отсечена порогом. Таблица открывается отсортированной по «Профиту рынка/день» (профит/шт × оборот/день) — солидные позиции сверху, дешёвый гир с раздутым % ниже; клик по заголовку — другая сортировка. Способ зачарования: ${data.enchantMode === 'after' ? 'после крафта рунами' : 'крафт из зачарованного сырья'}; проверенный диапазон зачарования: ${data.enchantRange}. ${data.blackMarket ? `Чёрный Рынок учтён (налог ${(data.bmTaxRate * 100).toFixed(1)}%, помечен ⚫). ` : ''}Возврат при крафте: ${(data.rrrOptions.gearRate * 100).toFixed(1)}%${data.rrrOptions.gearRrrCustom !== null ? ' (своя ставка)' : ''}. Материал берётся дешевле из двух путей: купить готовым или переработать самому (♻) из сырья и полуфабриката предыдущего тира с возвратом при переработке ${(data.refineRate * 100).toFixed(1)}%. ${jugNote}</p>
    <div class="table-scroll"><table class="scan-table">
      <thead><tr><th>Предмет</th><th>Качество</th><th>Себестоимость</th><th>${patient ? 'Ср. цена продажи' : 'Buy Order'}</th><th>Оборот/день (рынок)</th><th>Профит/шт</th><th title="Профит/шт × оборот/день">Профит рынка/день</th><th title="Рейтинг: профит % × log₂(2 + оборот) — по нему список отобран, ликвидность взвешена">Рейтинг</th><th title="По слабому звену — предмету и его сырью">Доверие</th><th>Свежесть</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  tableSortStates['margin-scan'] = { label: 'Профит рынка/день', dir: 'desc' };     // после каждого скана — сразу по масштабу в серебре
  wireTableSort(marginEl.result.querySelector('table'), 'margin-scan');
  highlightBestRow(marginEl.result.querySelector('table'), data.results);
  marginEl.result.querySelectorAll('.scan-add-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = findItem(btn.dataset.id);
      if (!item) return;
      selectCraftItem(item);
      craftEl.enchant.value = btn.dataset.enchant;
      craftEl.quality.value = btn.dataset.quality;
      refreshSelectedIcon();                                       // иконка — с зачарованием и качеством найденной позиции, а не базовая
      if (btn.dataset.quantity) craftEl.quantity.value = btn.dataset.quantity;
      // Находка выгодна именно через Чёрный Рынок — включаем его и в калькуляторе, иначе он увидит только обычные города (и «нет профита»).
      if (btn.dataset.blackMarket === 'true') craftEl.blackMarket.checked = true;
      document.getElementById('craft-enchant-after').checked = data.enchantMode === 'after' && btn.dataset.enchant !== '0';
      document.getElementById('craft-controls').scrollIntoView({ behavior: 'smooth', block: 'center' });
      runCraftCalc();
    });
  });
}

const craftReady = initCraft();
