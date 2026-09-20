// Крафт-лист: плавающий «док» внизу с итогами и выдвижная панель со списком позиций.
import { html, createStore, useStore, useState, fmt, signed, tone, itemLabel, itemTier, copyText, auctionName } from './lib.js';
import { craftList, setQuantity, removeFromList, clearList } from './list.js';
import { Glyph, Tags, Icon, ICONS, toast } from './ui.js';
import { nav } from './nav.js';

export const drawerStore = createStore({ open: false });

export const totalsOf = (items) => items.filter((x) => x.on !== false).reduce((a, x) => ({
  cost: a.cost + (x.cost || 0) * x.quantity, profit: a.profit + (x.profit || 0) * x.quantity, points: a.points + (x.points || 0) * x.quantity, capes: a.capes + x.quantity,
}), { cost: 0, profit: 0, points: 0, capes: 0 });

export function Dock() {
  const { items } = useStore(craftList);
  const t = totalsOf(items);
  return html`<div class="dock" id="dock" role="region" aria-label="Крафт-лист">
    <div class="d"><span>Крафт-лист</span><b><span class="cnt" id="dock-count">${items.length}</span></b></div>
    <div class="d hide-s"><span>Вложения</span><b id="dock-inv">${items.length ? fmt(t.cost) : '—'}</b></div>
    <div class="d"><span>Профит</span><b class=${tone(t.profit)} id="dock-pr">${items.length ? signed(t.profit) : '—'}</b></div>
    <button class="btn primary sm" type="button" id="open-list" onClick=${() => drawerStore.set({ open: true })}>Открыть</button></div>`;
}

export function ListDrawer() {
  const { open } = useStore(drawerStore);
  const { items } = useStore(craftList);
  if (!open) return null;
  const close = () => drawerStore.set({ open: false });
  const t = totalsOf(items);
  const copyNames = async () => {
    const text = items.map((x) => `${auctionName(itemLabel(x.itemId))}${x.enchant ? ` .${x.enchant}` : ''} × ${x.quantity}`).join('\n');
    toast((await copyText(text)) ? 'Список скопирован' : 'Не удалось скопировать');
  };
  return html`<${Fragment}>
    <div class="scrim" onClick=${close}></div>
    <aside class="drawer" id="drawer-list" aria-label="Крафт-лист">
      <header><h3>Крафт-лист</h3><button class="btn sm" type="button" onClick=${close}>Закрыть</button></header>
      <div class="scroll">
        ${items.length === 0 ? html`<div class="empty">Лист пуст.<br />Добавляй позиции кнопкой «+» в скане, из калькулятора или целым планом.</div>` : html`
          <div class="totals"><div><span>Вложения</span><b class="neg">${fmt(t.cost)}</b></div><div class="soft-good"><span>Профит</span><b class=${tone(t.profit)}>${signed(t.profit)}</b></div><div><span>Очки</span><b>${fmt(t.points)}</b></div></div>
          <div><div class="grouphead">Позиции</div>${items.map((x) => html`<div class="li" key=${x.uid}>
            <div class="n"><div class="li-h"><${Glyph} id=${x.itemId} tier=${itemTier(x.itemId)} enchant=${x.enchant} quality=${x.quality} size=${48} /><b>${itemLabel(x.itemId)}</b></div><${Tags} tier=${itemTier(x.itemId)} enchant=${x.enchant} quality=${x.quality} />${x.after ? html` <span class="muted" style="font-size:12.5px">· чары после крафта</span>` : null}</div>
            <div class="qty"><button type="button" aria-label="Меньше" onClick=${() => setQuantity(x.uid, x.quantity - 1)}>−</button><input type="number" min="1" value=${x.quantity} onChange=${(e) => setQuantity(x.uid, e.target.value)} aria-label="Количество" /><button type="button" aria-label="Больше" onClick=${() => setQuantity(x.uid, x.quantity + 1)}>+</button></div>
            <button class="x" type="button" aria-label="Убрать из листа" title="Убрать из листа" onClick=${() => removeFromList(x.uid)}>✕</button></div>`)}</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" type="button" onClick=${copyNames}>Скопировать список</button><button class="btn ghost" type="button" onClick=${clearList}>Очистить</button></div>`}
      </div></aside></${Fragment}>`;
}
import { Fragment } from './lib.js';
