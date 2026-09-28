// Интерфейс «Мои материалы»: таблица с полями «есть» и сводка по рецептам — что докупить и сколько штук уже можно скрафтить.
// Один набор компонентов для калькулятора одной вещи и для стека (крафт-листа): им отдают результаты allocateItem/allocateStack.
import { html, useStore, useState, useMemo, fmt, allItems } from './lib.js';
import { inventory, setHave, resetInventory } from './inventory.js';
import { hasHave, materialTable } from './logic/inventory.js';
import { buildCatalog, filterCatalog, materialName, KINDS } from './logic/materialCatalog.js';
import { MaterialName, Glyph, Tags } from './ui.js';
import { splitMaterialId } from './logic/material.js';

export function useInventory() { return useStore(inventory).have; }

function HaveInput({ id, value, name }) {
  return html`<input class=${`have-input ${value > 0 ? 'is-manual' : ''}`} type="number" min="0" step="1" data-have=${id} value=${value > 0 ? value : ''} placeholder="0" onInput=${(e) => setHave(id, e.target.value)} aria-label=${`Есть: ${name}`} title="Сколько у тебя уже есть. Калькулятор вычтет это из закупки и покажет, сколько можно скрафтить" />`;
}


// Пикер материалов: любой материал можно добавить в «Мои материалы», даже если выбранный сейчас рецепт его не использует —
// калькулятор сам поищет рецепт и путь (купить / переработать / скрафтить), где он пригодится
function MaterialPicker({ have }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [tier, setTier] = useState('');
  const [ench, setEnch] = useState('');
  const [open, setOpen] = useState(false);
  const catalog = useMemo(() => buildCatalog(allItems()), [open]);
  const active = q.trim() || kind || tier || ench !== '';
  const matches = useMemo(() => (active ? filterCatalog(catalog, { q, kind, tier, enchant: ench }).slice(0, 40) : []), [catalog, q, kind, tier, ench]);
  const pick = (m) => {
    if (!(have[m.id] > 0)) setHave(m.id, 1);
    setQ(''); setOpen(false);
    setTimeout(() => { const el = document.querySelector(`input[data-have="${m.id}"]`); if (el) { el.focus(); el.select(); } }, 60);
  };
  const opt = (v, t, cur) => html`<option value=${v} selected=${cur === v}>${t}</option>`;
  return html`<div class="inv-add picker-wrap" onFocusIn=${() => setOpen(true)} onFocusOut=${() => setTimeout(() => setOpen(false), 180)}>
    <div class="filters" style="margin:0">
      <label class="f" style="flex:1 1 220px;width:auto">Добавить материал<input id="inv-search" type="search" autocomplete="off" placeholder="Сырьё, слитки, ткань, руны, плащи…" value=${q} onInput=${(e) => { setQ(e.target.value); setOpen(true); }} /></label>
      <label class="f" style="width:170px">Вид<select id="inv-kind" onChange=${(e) => setKind(e.target.value)}>${opt('', 'Любой', kind)}${KINDS.map(([k, t]) => opt(k, t, kind))}</select></label>
      <label class="f" style="width:100px">Тир<select id="inv-tier" onChange=${(e) => setTier(e.target.value)}>${opt('', 'Любой', tier)}${[2, 3, 4, 5, 6, 7, 8].map((t) => opt(String(t), `T${t}`, tier))}</select></label>
      <label class="f" style="width:130px">Зачарование<select id="inv-ench" onChange=${(e) => setEnch(e.target.value)}>${opt('', 'Любое', ench)}${[0, 1, 2, 3, 4].map((e) => opt(String(e), `.${e}`, ench))}</select></label></div>
    ${open && matches.length ? html`<div class="suggest" role="listbox" id="inv-suggest">${matches.map((m) => {
      const { base } = splitMaterialId(m.id, m.name);
      return html`<button type="button" role="option" key=${m.id} data-add=${m.id} onMouseDown=${(e) => { e.preventDefault(); pick(m); }}><${Glyph} id=${base} tier=${m.tier} enchant=${m.enchant} size=${48} /><span>${m.name.replace(/^T\d+\s+/, '')}</span><${Tags} tier=${m.tier} enchant=${m.enchant} />${have[m.id] > 0 ? html`<span class="pill g">уже есть</span>` : null}</button>`;
    })}</div>` : open && active ? html`<div class="suggest"><span class="muted" style="padding:8px">Ничего не нашлось — измени поиск или фильтры</span></div>` : null}
  </div>`;
}

// allocs — список результатов allocateItem (одна вещь или все позиции стека)
export function MyMaterials({ allocs, nameOf }) {
  const have = useInventory();
  const items = allItems();
  const rows = materialTable(allocs, have, (id) => materialName(id, items, nameOf));
  const any = hasHave(have);
  const needed = rows.filter((r) => r.needed > 0 || r.semi);
  const others = rows.filter((r) => !(r.needed > 0 || r.semi));
  const line = (r) => html`<tr key=${r.id} data-mat=${r.id} class=${r.have > 0 && r.needed > 0 && r.toBuy === 0 && !r.semi ? 'inv-ok' : ''}>
    <td><${MaterialName} id=${r.id} name=${r.name} />${r.semi && !r.direct ? html` <span class="pill n" title="Полуфабрикат: если он у тебя есть, ему не нужны его компоненты">полуфабрикат</span>` : null}</td>
    <td><${HaveInput} id=${r.id} value=${r.have} name=${r.name} /></td>
    <td>${r.needed > 0 ? fmt(r.needed) : '—'}</td>
    <td>${r.direct ? (r.toBuy > 0 ? html`<b class="neg">${fmt(r.toBuy)}</b>` : html`<span class="pill g">хватает</span>`) : '—'}</td>
    <td>${r.extra > 0 ? html`<span class="muted" title="Лишнее: в расчёте не понадобилось">+${fmt(r.extra)}</span>` : ''}</td></tr>`;
  return html`<details class="card inv-panel" id="my-materials" open=${any || undefined}>
    <summary><b>Мои материалы</b> <span class="muted">${any ? `· указано позиций: ${Object.keys(have).length}` : '· добавь, что у тебя уже есть, — рецепты, докупка и «что можно скрафтить» пересчитаются'}</span></summary>
    <${MaterialPicker} have=${have} />
    <div class="tw"><table><thead><tr><th>Материал</th><th>Есть</th><th>Нужно</th><th>Докупить</th><th></th></tr></thead>
      <tbody>${needed.map(line)}${others.length ? html`<tr class="inv-sep"><td colspan="5" class="muted">Не нужны в расчёте</td></tr>${others.map(line)}` : null}</tbody></table></div>
    <div class="inv-foot"><span class="muted">Потребность считается с учётом возврата ресурсов. Свои материалы считаются бесплатными: рецепт и путь (купить, переработать, скрафтить самому) выбираются по тому, что придётся докупить. В стеке материалы раздаются позициям по порядку сверху вниз.</span>
      ${any ? html`<button type="button" class="btn sm" id="inv-reset" onClick=${resetInventory}>Сбросить материалы</button>` : null}</div>
  </details>`;
}


// Сравнение рецептов одной вещи на твоих материалах: что докупить в каждом, что можно скрафтить и какой дешевле. cmp — результат compareVariants
export function RecipeCompare({ cmp, currentKey, onPick }) {
  if (!cmp || cmp.rows.length < 2) return null;
  return html`<div class="card recipe-compare" id="recipe-compare">
    <div class="ready-head"><b>Рецепты на твоих материалах</b> <span class="muted">выгоднее тот, где со своими материалами штука обходится дешевле</span></div>
    <div class="tw"><table class="ready-table"><thead><tr><th>Рецепт</th><th>Докупить</th><th>Можно скрафтить</th><th>Вложения / шт</th><th></th></tr></thead><tbody>
      ${cmp.rows.map((r) => html`<tr key=${r.key} data-variant=${r.key} class=${r.key === cmp.best ? 'inv-ok' : ''}>
        <td>${recipeName(r)} ${r.key === currentKey ? html`<span class="pill n">выбран</span>` : null}${r.key === cmp.best ? html` <span class="pill g">выгоднее всего</span>` : null}</td>
        <td>${r.ownCost === null ? html`<span class="pill w">нет цен</span>` : fmt(r.cash)}</td>
        <td>${fmt(r.alloc.craftable)} из ${fmt(r.alloc.quantity)}</td>
        <td>${r.ownCost === null ? '—' : fmt(r.ownCost)}</td>
        <td>${r.key !== currentKey && r.ownCost !== null ? html`<button type="button" class="btn sm" data-use=${r.key} onClick=${() => onPick(r)}>Считать по нему</button>` : null}</td></tr>`)}
    </tbody></table></div></div>`;
}
const recipeName = (r) => (r.key === 'direct' ? 'Прямой крафт (сразу зачарованные материалы)' : r.alloc.recipe);

const cov = (l) => (l.needed > 0 ? Math.min(l.covered / l.needed, 1) : 1);

// Рецепт одной позиции: каждый материал — нужно / есть / докупить, сверху вердикт «можно скрафтить X из N»
export function Readiness({ title, alloc, head = null }) {
  const { lines, craftable, quantity, ready, saved, recipe } = alloc;
  const verdict = ready ? html`<span class="pill g">всё есть на ${fmt(quantity)} шт</span>`
    : craftable > 0 ? html`<span class="pill n">можно скрафтить ${fmt(craftable)} из ${fmt(quantity)}</span>`
    : html`<span class="pill w">пока нельзя скрафтить</span>`;
  return html`<div class=${`card ready ${ready ? 'ready-ok' : ''}`} data-ready=${title}>
    <div class="ready-head">${head}<b>${title}</b> ${verdict}</div>
    ${recipe || saved > 0 ? html`<div class="ready-meta muted">${recipe ? html`Рецепт: <b>${recipe}</b>` : null}${saved > 0 ? html`${recipe ? ' · ' : ''}свои материалы экономят <b class="pos">${fmt(saved)}</b>` : null}</div>` : null}
    <table class="ready-table"><thead><tr><th>Материал</th><th>Нужно</th><th>Есть</th><th>Докупить</th></tr></thead><tbody>
      ${lines.map((l) => {
        const buyLeft = Math.max(Math.ceil(l.needed - l.covered - 1e-9), 0);
        return html`<tr key=${l.id} class=${cov(l) >= 1 ? 'inv-ok' : ''}>
          <td><${MaterialName} id=${l.id} name=${l.name} />${l.via ? html` <span class="pill n" title=${l.via === 'craft' ? 'Крафтится самому из компонентов ниже' : 'Перерабатывается из компонентов ниже'}>${l.via === 'craft' ? 'крафт самому' : 'переработка'}</span>` : null}${l.switched ? html` <span class="pill g" title="Сервер предлагал другой путь, но с твоими материалами этот выходит дешевле">по твоим материалам${l.via ? '' : ': купить готовым'}</span>` : null}
            ${l.comps.map((c) => html`<div class="ready-comp" key=${c.id}>${c.name}: нужно ${fmt(c.needed)}, есть ${fmt(c.have)}${c.toBuy > 0 ? html`, докупить <b class="neg">${fmt(c.toBuy)}</b>` : html` — <span class="pos">хватает</span>`}</div>`)}</td>
          <td>${fmt(l.needed)}</td><td>${fmt(Math.min(Math.floor(l.covered + 1e-9), l.needed))}</td>
          <td>${l.via ? (buyLeft > 0 ? html`<span class="muted">компонентами</span>` : html`<span class="pill g">хватает</span>`) : buyLeft > 0 ? html`<b class="neg">${fmt(buyLeft)}</b>` : html`<span class="pill g">хватает</span>`}</td></tr>`;
      })}</tbody></table></div>`;
}
