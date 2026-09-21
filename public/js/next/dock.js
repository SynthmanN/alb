// Крафт-лист: плавающий «док» с итогами и выдвижная панель — позиции (включить/выключить, количество, детали за серебро, цена продажи), итоги, сводная закупка.
// «Открыть активные в калькуляторе» копирует включённые позиции в стек калькулятора.
import { html, useStore, Fragment, itemLabel, fmt, signed, tone, copyText, auctionName } from './lib.js';
import { craftList, list, clearList } from './list.js';
import { listDef } from './listcalc.js';
import { drawerStore, nav } from './nav.js';
import { StackCards, StackTotals, useStackData } from './stack-ui.js';
import { StackShopping } from './stack-shopping.js';
import { Switch, Icon, ICONS, toast } from './ui.js';
import { afterPossible } from './logic/stack.js';
import { openListInCalculator } from './stack-open.js';

export { drawerStore };

export function Dock() {
  const data = useStackData(listDef);
  const { items, totals: t } = data;
  return html`<div class="dock" id="dock" role="region" aria-label="Крафт-лист">
    <div class="d"><span>Крафт-лист</span><b><span class="cnt" id="dock-count">${items.length}</span></b></div>
    <div class="d hide-s"><span>Вложения</span><b id="dock-inv">${items.length ? fmt(t.cost) : '—'}</b></div>
    <div class="d"><span>Профит</span><b class=${tone(t.profit)} id="dock-pr">${items.length ? signed(t.profit) : '—'}</b></div>
    <button class="btn primary sm" type="button" id="open-list" onClick=${() => drawerStore.set({ open: true })}>Открыть</button></div>`;
}

export function ListDrawer() {
  const { open } = useStore(drawerStore);
  const data = useStackData(listDef);
  if (!open) return null;
  const { items, faction, autoAfter, totals: t } = data;
  const close = () => drawerStore.set({ open: false });
  const active = items.filter((i) => i.on !== false).length;
  const anyEligible = items.some((i) => afterPossible(i));
  const openDetail = (x) => { close(); nav.openCalc({ itemId: x.itemId, enchant: x.enchant, quality: x.quality, quantity: x.quantity, after: !!x.after, faction: x.faction, crestSilver: x.crestSilver, heartSilver: x.heartSilver }); };
  const copyNames = async () => {
    const text = items.map((x) => `${auctionName(itemLabel(x.itemId))}${x.enchant ? ` .${x.enchant}` : ''} × ${x.quantity}`).join('\n');
    toast((await copyText(text)) ? 'Список скопирован' : 'Не удалось скопировать');
  };
  return html`<${Fragment}>
    <div class="scrim" onClick=${close}></div>
    <aside class="drawer wide" id="drawer-list" aria-label="Крафт-лист">
      <header><h3>Крафт-лист${faction ? html` <span class="muted" style="font-weight:400;font-size:14px">· ${faction.name}</span>` : null}</h3><button class="btn sm" type="button" onClick=${close}>Закрыть</button></header>
      <div class="scroll">
        ${items.length === 0 ? html`<div class="empty">Лист пуст.<br />Добавляй позиции кнопкой «+» в скане, из калькулятора или целым планом.</div>` : html`
          <button class="btn primary" type="button" id="open-in-calc" disabled=${!active} onClick=${openListInCalculator} title="Активные (зелёные) позиции копируются в стек калькулятора: общий расчёт закупки и продажи"><${Icon} d=${ICONS.calc} />Открыть активные в калькуляторе (${active})</button>
          <${StackTotals} data=${data} />
          ${anyEligible ? html`<${Switch} checked=${autoAfter} onChange=${list.setAutoAfter} title="Для каждой позиции считаются оба пути; чары после крафта применяются, если профит выше на 7% и больше">Зачаровать после крафта — там, где профит выше на 7% и больше</${Switch}>` : null}
          <div><div class="grouphead">Позиции <span class="muted" style="text-transform:none;letter-spacing:0">· клик по позиции включает и выключает её</span></div><${StackCards} def=${listDef} data=${data} onDetail=${openDetail} /></div>
          <${StackShopping} data=${data} />
          <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" type="button" onClick=${copyNames}>Скопировать список</button><button class="btn ghost" type="button" onClick=${clearList}>Очистить</button></div>`}
      </div></aside></${Fragment}>`;
}
