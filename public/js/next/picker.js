// Выбор предмета: поиск по названию, категория (колонки по группам) и тир. Используется калькулятором одной вещи и добавлением позиции в стек.
import { html, useState, useMemo, allItems, getWeaponGroups, itemLabel } from './lib.js';
import { Glyph } from './ui.js';

export const GEAR = (i) => i.category === 'weapon' || i.category === 'armor' || i.category === 'cape';
export const familyOf = (id) => id.replace(/^T\d+_/, '');
// ---------- выбор предмета: поиск, категория, тир ----------
const CAPE_COLUMNS = [['CAPE', 'Базовые'], ['CAPEITEM_FW_BRIDGEWATCH', 'Бридгуотч'], ['CAPEITEM_FW_CAERLEON', 'Каэрлеон'], ['CAPEITEM_FW_FORTSTERLING', 'Форт Стерлинг'], ['CAPEITEM_FW_LYMHURST', 'Лимхёрст'], ['CAPEITEM_FW_MARTLOCK', 'Мартлок'], ['CAPEITEM_FW_THETFORD', 'Тетфорд'], ['CAPEITEM_FW_BRECILIEN', 'Бресилиен'], ['CAPEITEM_AVALON', 'Авалонские'], ['CAPEITEM_DEMON', 'Демонов'], ['CAPEITEM_HERETIC', 'Еретиков'], ['CAPEITEM_KEEPER', 'Хранителей'], ['CAPEITEM_MORGANA', 'Морганы'], ['CAPEITEM_SMUGGLER', 'Контрабандистов'], ['CAPEITEM_UNDEAD', 'Нежити']];
const ARMOR_COLUMNS = [['латы', 'Латная броня'], ['кожа', 'Кожаная броня'], ['ткань', 'Тканевая броня']];
function pickerColumns(cat, items) {
  let columns;
  if (cat === 'armor') columns = ARMOR_COLUMNS.map(([key, title]) => ({ title, test: (i) => i.material === key }));
  else if (cat === 'cape') columns = CAPE_COLUMNS.map(([fam, title]) => ({ title, test: (i) => familyOf(i.id) === fam }));
  else columns = getWeaponGroups().map((g) => ({ title: g.title, test: (i) => g.families.includes(familyOf(i.id)) }));
  return columns.map((col) => ({ title: col.title, items: items.filter(col.test).sort((a, b) => familyOf(a.id).localeCompare(familyOf(b.id)) || a.tier - b.tier) })).filter((col) => col.items.length);
}
export function ItemPicker({ value, onPick }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [tier, setTier] = useState('');
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s && !cat && !tier) return [];
    return allItems().filter((it) => GEAR(it) && (!cat || it.category === cat) && (!tier || String(it.tier) === tier) && (!s || it.name.toLowerCase().includes(s) || it.id.toLowerCase().includes(s)));
  }, [q, cat, tier, open]);
  const pick = (it) => { onPick(it.id); setQ(''); setOpen(false); };
  const chip = (it) => html`<button type="button" role="option" key=${it.id} onMouseDown=${(e) => { e.preventDefault(); pick(it); }}><${Glyph} id=${it.id} tier=${it.tier} size=${48} /><span>${itemLabel(it.id)}${it.slot || it.material ? html` <small class="muted">(${[it.slot, it.material].filter(Boolean).join(', ')})</small>` : null}</span><span class=${`tag t${it.tier}`}>T${it.tier}</span></button>`;
  return html`<div class="picker-wrap" style="flex:1 1 320px;position:relative" onFocusIn=${() => setOpen(true)} onFocusOut=${() => setTimeout(() => setOpen(false), 180)}>
    <div class="filters" style="margin:0">
      <label class="f" style="flex:1 1 200px;width:auto">Предмет<input id="c-search" type="search" autocomplete="off" placeholder=${value ? itemLabel(value) : 'Найди предмет: меч, плащ, шлем…'} value=${q} onInput=${(e) => { setQ(e.target.value); setOpen(true); }} /></label>
      <label class="f" style="width:150px">Категория<select id="c-cat" value=${cat} onChange=${(e) => setCat(e.target.value)}>${[['', 'Все категории'], ['weapon', 'Оружие'], ['armor', 'Броня'], ['cape', 'Плащи']].map(([v, t]) => html`<option value=${v} selected=${cat === v}>${t}</option>`)}</select></label>
      <label class="f" style="width:110px">Тир<select id="c-tier" value=${tier} onChange=${(e) => setTier(e.target.value)}>${[['', 'Любой'], ...[4, 5, 6, 7, 8].map((t) => [String(t), `T${t}`])].map(([v, t]) => html`<option value=${v} selected=${tier === v}>${t}</option>`)}</select></label></div>
    ${open && matches.length ? html`<div class=${`suggest ${cat ? 'columns' : ''}`} role="listbox">${cat ? pickerColumns(cat, matches).map((col) => html`<div class="suggest-col" key=${col.title}><h4>${col.title} <small>${col.items.length}</small></h4>${col.items.map(chip)}</div>`) : matches.slice(0, 30).map(chip)}</div>` : null}</div>`;
}

