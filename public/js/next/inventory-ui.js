// Интерфейс «Мои материалы»: таблица с полями «есть» и сводка по рецептам — что докупить и сколько штук уже можно скрафтить.
// Один набор компонентов для калькулятора одной вещи и для стека (крафт-листа): им отдают результаты allocateItem/allocateStack.
import { html, useStore, fmt } from './lib.js';
import { inventory, setHave, resetInventory } from './inventory.js';
import { hasHave, materialTable } from './logic/inventory.js';
import { MaterialName } from './ui.js';

export function useInventory() { return useStore(inventory).have; }

function HaveInput({ id, value, name }) {
  return html`<input class=${`have-input ${value > 0 ? 'is-manual' : ''}`} type="number" min="0" step="1" data-have=${id} value=${value > 0 ? value : ''} placeholder="0" onInput=${(e) => setHave(id, e.target.value)} aria-label=${`Есть: ${name}`} title="Сколько у тебя уже есть. Калькулятор вычтет это из закупки и покажет, сколько можно скрафтить" />`;
}

// allocs — список результатов allocateItem (одна вещь или все позиции стека)
export function MyMaterials({ allocs, nameOf }) {
  const have = useInventory();
  const rows = materialTable(allocs, have, nameOf);
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
    <summary><b>Мои материалы</b> <span class="muted">${any ? `· указано позиций: ${Object.keys(have).length}` : '· впиши, что у тебя уже есть — докупка и «что можно скрафтить» пересчитаются'}</span></summary>
    <div class="tw"><table><thead><tr><th>Материал</th><th>Есть</th><th>Нужно</th><th>Докупить</th><th></th></tr></thead>
      <tbody>${needed.map(line)}${others.length ? html`<tr class="inv-sep"><td colspan="5" class="muted">Не нужны в расчёте</td></tr>${others.map(line)}` : null}</tbody></table></div>
    <div class="inv-foot"><span class="muted">Потребность считается с учётом возврата ресурсов. В стеке материалы раздаются позициям по порядку сверху вниз.</span>
      ${any ? html`<button type="button" class="btn sm" id="inv-reset" onClick=${resetInventory}>Сбросить материалы</button>` : null}</div>
  </details>`;
}

const cov = (l) => (l.needed > 0 ? Math.min(l.covered / l.needed, 1) : 1);

// Рецепт одной позиции: каждый материал — нужно / есть / докупить, сверху вердикт «можно скрафтить X из N»
export function Readiness({ title, alloc, head = null }) {
  const { lines, craftable, quantity, ready } = alloc;
  const verdict = ready ? html`<span class="pill g">всё есть на ${fmt(quantity)} шт</span>`
    : craftable > 0 ? html`<span class="pill n">можно скрафтить ${fmt(craftable)} из ${fmt(quantity)}</span>`
    : html`<span class="pill w">пока нельзя скрафтить</span>`;
  return html`<div class=${`card ready ${ready ? 'ready-ok' : ''}`} data-ready=${title}>
    <div class="ready-head">${head}<b>${title}</b> ${verdict}</div>
    <table class="ready-table"><thead><tr><th>Материал</th><th>Нужно</th><th>Есть</th><th>Докупить</th></tr></thead><tbody>
      ${lines.map((l) => {
        const buyLeft = Math.max(Math.ceil(l.needed - l.covered - 1e-9), 0);
        return html`<tr key=${l.id} class=${cov(l) >= 1 ? 'inv-ok' : ''}>
          <td><${MaterialName} id=${l.id} name=${l.name} />${l.via ? html` <span class="pill n" title=${l.via === 'craft' ? 'Крафтится самому из компонентов ниже' : 'Перерабатывается из компонентов ниже'}>${l.via === 'craft' ? 'крафт самому' : 'переработка'}</span>` : null}
            ${l.comps.map((c) => html`<div class="ready-comp" key=${c.id}>${c.name}: нужно ${fmt(c.needed)}, есть ${fmt(c.have)}${c.toBuy > 0 ? html`, докупить <b class="neg">${fmt(c.toBuy)}</b>` : html` — <span class="pos">хватает</span>`}</div>`)}</td>
          <td>${fmt(l.needed)}</td><td>${fmt(Math.min(Math.floor(l.covered + 1e-9), l.needed))}</td>
          <td>${l.via ? (buyLeft > 0 ? html`<span class="muted">компонентами</span>` : html`<span class="pill g">хватает</span>`) : buyLeft > 0 ? html`<b class="neg">${fmt(buyLeft)}</b>` : html`<span class="pill g">хватает</span>`}</td></tr>`;
      })}</tbody></table></div>`;
}
