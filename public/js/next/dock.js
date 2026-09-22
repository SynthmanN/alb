// Крафт-лист: плавающий «док» с итогами и выдвижная панель — позиции (включить/выключить, количество, детали за серебро, цена продажи), итоги, сводная закупка.
// «Открыть активные в калькуляторе» копирует включённые позиции в стек калькулятора.
import { html, useStore, useEffect, useState, Fragment, itemLabel, itemTier, fmt, signed, tone, ruPlural, copyText, auctionName } from './lib.js';
import { craftList, list, clearList, listNotify } from './list.js';
import { listDef } from './listcalc.js';
import { drawerStore, nav } from './nav.js';
import { StackCards, StackTotals, useStackData } from './stack-ui.js';
import { StackShopping } from './stack-shopping.js';
import { Switch, Icon, ICONS, Glyph, Tags, toast } from './ui.js';
import { afterPossible } from './logic/stack.js';
import { openListInCalculator } from './stack-open.js';
import { FreshnessButton, FreshnessDialog, invalidateDef } from './freshness.js';
import { collectAllIds } from './logic/freshness.js';

export { FreshnessDialog };

export { drawerStore };

export function Dock() {
  const data = useStackData(listDef);
  const { items, totals: t } = data;
  return html`<div class="dock" id="dock" role="region" aria-label="Крафт-лист">
    <div class="dock-info">
      <div class="d"><span>Крафт-лист</span><b><span class="cnt" id="dock-count">${items.length}</span></b></div>
      <div class="d hide-s"><span>Вложения</span><b id="dock-inv">${items.length ? fmt(t.cost) : '—'}</b></div>
      <div class="d"><span>Профит</span><b class=${tone(t.profit)} id="dock-pr">${items.length ? signed(t.profit) : '—'}</b></div>
    </div>
    <button class="btn primary dock-open" type="button" id="open-list" onClick=${() => drawerStore.set({ open: true })}><${Icon} d=${ICONS.list} />Открыть</button></div>`;
}

const NOTICE_MS = 2800;
// Всплывающая карточка «добавлено в крафт-лист» у дока: одна позиция — значок и название, массовое добавление (план целиком) —
// одна карточка на всё вместо вспышки из N. Тихая анимация (въезжает и мягко «мерцает» акцентом один раз) — не должна мозолить глаза.
export function DockNotice() {
  const { id, note } = useStore(listNotify);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!note) return undefined;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), NOTICE_MS);
    return () => clearTimeout(t);
  }, [id]);
  if (!note || !visible) return null;
  return html`<div class="dock-notice" role="status" key=${id}>
    ${note.kind === 'batch'
      ? html`<span class="dn-icon dn-icon-plain"><${Icon} d=${ICONS.list} /></span><div class="dn-body"><b>${fmt(note.count)} ${ruPlural(note.count, 'позиция', 'позиции', 'позиций')}</b><span>в крафт-листе${note.label ? ` — ${note.label}` : ''}</span></div>`
      : html`<${Glyph} id=${note.item.itemId} tier=${itemTier(note.item.itemId)} enchant=${note.item.enchant} quality=${note.item.quality} size=${40} /><div class="dn-body"><b>${itemLabel(note.item.itemId)}</b><span><${Tags} tier=${itemTier(note.item.itemId)} enchant=${note.item.enchant} quality=${note.item.quality} /> × ${fmt(note.item.quantity)}</span></div>`}
  </div>`;
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
          <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" type="button" onClick=${copyNames}>Скопировать список</button><${FreshnessButton} ids=${collectAllIds(data.results)} onRefreshed=${() => invalidateDef(listDef)} /><button class="btn ghost" type="button" onClick=${clearList}>Очистить</button></div>`}
      </div></aside></${Fragment}>`;
}
