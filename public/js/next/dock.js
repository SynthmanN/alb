// Крафт-лист: плавающий «док» с итогами и выдвижная панель — позиции (количество, детали за серебро, цена продажи), итоги, сводная закупка.
import { html, createStore, useStore, useState, Fragment, fmt, signed, tone, itemLabel, itemTier, copyText, auctionName, apiPost } from './lib.js';
import { craftList, setQuantity, removeFromList, clearList, patchItem, setAutoAfter, setFaction } from './list.js';
import { listCalc, invalidateItem, redecide } from './listcalc.js';
import { Glyph, Tags, CityPill, Switch, Icon, ICONS, toast } from './ui.js';
import { nav } from './nav.js';
import { missingPrices, itemProfit, stackTotals, afterPossible } from './logic/stack.js';
import { acquisitionRows, mergeRows } from './logic/acquire.js';

export const drawerStore = createStore({ open: false, checks: {} });

function totals(items, results, faction) {
  const t = stackTotals(items, results, faction ? faction.points : 0);
  // позиции, ещё не посчитанные, дают в док приблизительные цифры из скана (себестоимость и профит при добавлении)
  for (const it of items) if (it.on !== false && !results.get(it.uid) && it.cost !== undefined) { t.cost += (it.cost || 0) * it.quantity; t.profit += (it.profit || 0) * it.quantity; }
  return t;
}

export function Dock() {
  const { items, faction } = useStore(craftList);
  const { results } = useStore(listCalc);
  const t = totals(items, results, faction);
  return html`<div class="dock" id="dock" role="region" aria-label="Крафт-лист">
    <div class="d"><span>Крафт-лист</span><b><span class="cnt" id="dock-count">${items.length}</span></b></div>
    <div class="d hide-s"><span>Вложения</span><b id="dock-inv">${items.length ? fmt(t.cost) : '—'}</b></div>
    <div class="d"><span>Профит</span><b class=${tone(t.profit)} id="dock-pr">${items.length ? signed(t.profit) : '—'}</b></div>
    <button class="btn primary sm" type="button" id="open-list" onClick=${() => drawerStore.set({ open: true })}>Открыть</button></div>`;
}

function MissingInput({ m, item }) {
  const [v, setV] = useState('');
  const save = async () => {
    const price = parseFloat(v);
    if (!(price > 0)) return;
    await apiPost('/api/manual-price', { id: m.id, quality: 1, price });
    toast(`Цена сохранена: ${m.label}`);
    invalidateItem(item.uid);
  };
  return html`<label class="chipin">${m.label}<input type="number" min="0" placeholder="цена" value=${v} onInput=${(e) => setV(e.target.value)} onBlur=${save} onKeyDown=${(e) => { if (e.key === 'Enter') save(); }} /></label>`;
}

function ItemCard({ x, result, pair, autoAfter }) {
  const d = result && !result.error ? result : null;
  const pf = d ? itemProfit(x, d) : null;
  const miss = d ? missingPrices(d) : [];
  const total = pf ? pf.unit * x.quantity : null;
  const pts = d && d.faction ? d.faction.pointsPerCape * x.quantity : null;
  const on = x.on !== false;
  let afterNote = '';
  if (x.after) {
    const pd = pair ? itemProfit(x, pair.direct) : null;
    afterNote = pd && pf && pd.unit !== 0 ? ` · чары после крафта (+${fmt(((pf.unit - pd.unit) / Math.abs(pd.unit)) * 100, 0)}% к профиту)` : ' · чары после крафта';
  }
  const openCalc = () => { drawerStore.set({ open: false }); nav.openCalc({ itemId: x.itemId, enchant: x.enchant, quality: x.quality, quantity: x.quantity, after: !!x.after, faction: x.faction, crestSilver: x.crestSilver, heartSilver: x.heartSilver }); };
  return html`<div class=${`li-card ${on ? 'on' : 'off'}`} data-uid=${x.uid}>
    <div class="li-top">
      <button type="button" class="li-pick" aria-pressed=${String(on)} title=${on ? 'В расчёте — клик исключит из итогов' : 'Не в расчёте — клик вернёт'} onClick=${() => patchItem(x.uid, { on: !on })}>
        <${Glyph} id=${x.itemId} tier=${itemTier(x.itemId)} enchant=${x.enchant} quality=${x.quality} size=${48} />
        <span><b>${itemLabel(x.itemId)}</b><br /><${Tags} tier=${itemTier(x.itemId)} enchant=${x.enchant} quality=${x.quality} /></span></button>
      <div class="qty"><button type="button" aria-label="Меньше" onClick=${() => setQuantity(x.uid, x.quantity - 1)}>−</button><input type="number" min="1" value=${x.quantity} onChange=${(e) => setQuantity(x.uid, e.target.value)} aria-label="Количество" /><button type="button" aria-label="Больше" onClick=${() => setQuantity(x.uid, x.quantity + 1)}>+</button></div>
      <button class="x" type="button" aria-label="Убрать из листа" title="Убрать из листа" onClick=${() => removeFromList(x.uid)}>✕</button>
    </div>
    <div class="li-line">${!result ? html`<span class="muted">считаю…</span>` : result.error ? html`<span class="neg">${result.error}</span>` : html`вложения <b>${miss.length ? '—' : fmt(d.totalCost)}</b> · профит <b class=${tone(total)}>${total === null ? (miss.length ? 'не хватает цен' : 'нет цены продажи') : signed(total)}</b>${pts !== null ? html` · очков ${fmt(pts)}` : null}${afterNote}`}</div>
    <div class="li-opts">
      ${x.faction ? html`<label class="switch sm"><input type="checkbox" checked=${!!x.crestSilver} onChange=${(e) => patchItem(x.uid, { crestSilver: e.target.checked })} /> герб за серебро</label>
        <label class="switch sm"><input type="checkbox" checked=${!!x.heartSilver} onChange=${(e) => patchItem(x.uid, { heartSilver: e.target.checked })} /> сердце за серебро</label>` : null}
      ${x.salePrice > 0 || x.faction ? html`<label class="chipin" title="Цена продажи одного плаща: по умолчанию из плана; впиши свою — профит пересчитается сразу">цена продажи<input type="number" min="0" placeholder=${x.salePrice > 0 ? Math.round(x.salePrice) : 'нет данных'} value=${x.salePriceOwn ?? ''} onInput=${(e) => { const v = parseFloat(e.target.value); patchItem(x.uid, { salePriceOwn: v > 0 ? v : undefined }); setTimeout(() => redecide(x.uid), 0); }} /></label>` : null}
      <button type="button" class="linkbtn" onClick=${openCalc}>Открыть в калькуляторе</button>
    </div>
    ${miss.length ? html`<div class="li-miss"><span class="pl">Не хватает цен материалов</span>${miss.map((m) => html`<${MissingInput} key=${m.id} m=${m} item=${x} />`)}</div>` : null}
  </div>`;
}

function Shopping({ items, results }) {
  const { checks } = useStore(drawerStore);
  const rows = mergeRows(items.filter((i) => i.on !== false && results.get(i.uid) && !results.get(i.uid).error).map((i) => acquisitionRows(results.get(i.uid), itemLabel)));
  if (!rows.length) return null;
  const done = rows.filter((r) => checks[r.id]).length;
  const total = rows.reduce((s, r) => s + r.sum, 0);
  const copy = async (r) => toast((await copyText(auctionName(r.name))) ? `Скопировано: ${auctionName(r.name)}` : 'Не удалось скопировать');
  return html`<div id="shopping"><div class="grouphead">Закупить для всего листа <span class="muted" style="text-transform:none;letter-spacing:0">· куплено ${done} из ${rows.length}</span></div>
    <div class="shop-list">${rows.map((r) => html`<div class=${`shop ${checks[r.id] ? 'done' : ''}`} key=${r.id}>
      <label class="shop-l"><input type="checkbox" class="ck" checked=${!!checks[r.id]} onChange=${(e) => drawerStore.set({ checks: { ...checks, [r.id]: e.target.checked } })} />
        <span><button type="button" class="namebtn" title="Скопировать название для поиска на аукционе" onClick=${() => copy(r)}>${r.name}</button>
          <span class="shop-c">${r.cities.map((c) => html`<${CityPill} key=${c.city} name=${c.city} />`)}</span></span></label>
      <span class="shop-n"><b>${fmt(r.needed)}</b> шт<br /><span class="neg">${fmt(r.sum)}</span></span></div>`)}</div>
    <div class="statusline" style="padding:10px 0 0;border:0">Итого на закупку: <b class="neg">${fmt(total)}</b>. Складываются результаты по отдельно посчитанным позициям: общий объём одинакового материала мог бы поднять цену чуть выше.</div></div>`;
}

export function ListDrawer() {
  const { open } = useStore(drawerStore);
  const { items, faction, autoAfter } = useStore(craftList);
  const { results, pairs, pending } = useStore(listCalc);
  if (!open) return null;
  const close = () => drawerStore.set({ open: false });
  const t = totals(items, results, faction);
  const anyEligible = items.some((i) => afterPossible(i));
  const over = faction && t.points > faction.points;
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
          <div class="totals four"><div><span>Вложения</span><b class="neg">${fmt(t.cost)}</b></div><div class="soft-good"><span>Профит</span><b class=${tone(t.profit)}>${signed(t.profit)}</b></div>
            <div><span>Очки${faction ? ` из ${fmt(faction.points)}` : ''}</span><b class=${over ? 'neg' : ''}>${fmt(t.points)}</b></div><div><span>Плащей / позиций</span><b>${fmt(t.capes)} / ${t.items}</b></div></div>
          ${over ? html`<div class="note neg" style="margin:0">Очков не хватает: ${fmt(t.points - faction.points)}</div>` : null}
          ${t.noPrice || t.pending || t.errors ? html`<div class="note" style="margin:0">${t.pending ? `Считается позиций: ${t.pending}. ` : ''}${t.noPrice ? `Не хватает цен материалов или продажи (в итоги не входят): ${t.noPrice} — впиши их в карточках. ` : ''}${t.errors ? `С ошибкой: ${t.errors}.` : ''}</div>` : null}
          ${anyEligible ? html`<${Switch} checked=${autoAfter} onChange=${setAutoAfter} title="Для каждой позиции считаются оба пути; чары после крафта применяются, если профит выше на 7% и больше">Зачаровать после крафта — там, где профит выше на 7% и больше</${Switch}>` : null}
          <div><div class="grouphead">Позиции</div><div class="li-cards">${items.map((x) => html`<${ItemCard} key=${x.uid} x=${x} result=${results.get(x.uid)} pair=${pairs.get(x.uid)} autoAfter=${autoAfter} />`)}</div></div>
          <${Shopping} items=${items} results=${results} />
          <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" type="button" onClick=${copyNames}>Скопировать список</button><button class="btn ghost" type="button" onClick=${clearList}>Очистить</button></div>`}
      </div></aside></${Fragment}>`;
}
