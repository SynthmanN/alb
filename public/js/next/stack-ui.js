// Общие компоненты стека позиций: карточки (включить/выключить, количество, детали за серебро, цена продажи), итоги и сводная закупка.
// Используются и панелью крафт-листа, и калькулятором в режиме стека: def = { ops, engine } — хранилище позиций и его расчёт.
import { html, Fragment, useStore, useState, useMemo, fmt, signed, tone, itemLabel, itemTier, apiPost } from './lib.js';
import { settings, activeCities } from './settings.js';
import { prices } from './prices.js';
import { Glyph, Tags, Turnover, toast } from './ui.js';
import { missingPrices, itemProfit, stackTotals } from './logic/stack.js';
import { turnoverPerDay, turnoverInfo } from './logic/turnover.js';
import { adjustData } from './logic/adjust.js';
import { applyItemPlan } from './logic/planEdit.js';

// Данные стека одним объектом: позиции, результаты расчёта со своими ценами материалов, итоги
export function useStackData({ ops, engine }) {
  const { items, faction, autoAfter } = useStore(ops.store);
  const { results: raw, pairs, pending } = useStore(engine.store);
  const pr = useStore(prices);
  const s = useStore(settings);
  const cities = activeCities(s);
  const citiesKey = cities.join();
  const results = useMemo(() => {
    const out = new Map();
    const planOf = new Map(items.map((i) => [i.uid, i.plan]));
    for (const [uid, d] of raw) out.set(uid, applyItemPlan(adjustData(d, pr, { purchaseLog: s.purchaseLog, cities }), planOf.get(uid)));   // правки плана продажи позиции — в профит
    return out;
  }, [raw, pr, s.purchaseLog, citiesKey, items]);
  const t = useMemo(() => {
    const total = stackTotals(items, results, faction ? faction.points : 0);
    // позиции, ещё не посчитанные, дают в итоги приблизительные цифры из скана (себестоимость и профит при добавлении)
    for (const it of items) if (it.on !== false && !results.get(it.uid) && it.cost !== undefined) { total.cost += (it.cost || 0) * it.quantity; total.profit += (it.profit || 0) * it.quantity; }
    return total;
  }, [items, results, faction]);
  return { items, faction, autoAfter, results, pairs, pending, totals: t, prices: pr, cities, settings: s };
}

function MissingInput({ m, item, def }) {
  const [v, setV] = useState('');
  const save = async () => {
    const price = parseFloat(v);
    if (!(price > 0)) return;
    await apiPost('/api/manual-price', { id: m.id, quality: 1, price });
    toast(`Цена сохранена: ${m.label}`);
    def.engine.invalidate(item.uid);
  };
  return html`<label class="chipin">${m.label}<input type="number" min="0" placeholder="цена" value=${v} onInput=${(e) => setV(e.target.value)} onBlur=${save} onKeyDown=${(e) => { if (e.key === 'Enter') save(); }} /></label>`;
}

// Карточка позиции. Клик по значку и названию включает или выключает позицию (зелёная / серая); серые не входят в расчёт
export function StackCard({ def, x, result, pair, onDetail, detailLabel = 'Открыть в калькуляторе' }) {
  const { ops, engine } = def;
  const windowDays = useStore(settings).hist;
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
  return html`<div class=${`li-card ${on ? 'on' : 'off'}`} data-uid=${x.uid}>
    <div class="li-top">
      <button type="button" class="li-pick" aria-pressed=${String(on)} title=${on ? 'В расчёте — клик исключит из итогов' : 'Не в расчёте — клик вернёт'} onClick=${() => ops.toggle(x.uid)}>
        <${Glyph} id=${x.itemId} tier=${itemTier(x.itemId)} enchant=${x.enchant} quality=${x.quality} size=${48} />
        <span><b>${itemLabel(x.itemId)}</b><br /><${Tags} tier=${itemTier(x.itemId)} enchant=${x.enchant} quality=${x.quality} /></span></button>
      <div class="qty"><button type="button" aria-label="Меньше" onClick=${() => ops.setQuantity(x.uid, x.quantity - 1)}>−</button><input type="number" min="1" value=${x.quantity} onChange=${(e) => ops.setQuantity(x.uid, e.target.value)} aria-label="Количество" /><button type="button" aria-label="Больше" onClick=${() => ops.setQuantity(x.uid, x.quantity + 1)}>+</button></div>
      <button class="x" type="button" aria-label="Убрать" title="Убрать" onClick=${() => ops.remove(x.uid)}>✕</button>
    </div>
    <div class="li-line">${!result ? html`<span class="muted">считаю…</span>` : result.error ? html`<span class="neg">${result.error}</span>` : html`вложения <b>${miss.length ? '—' : fmt(d.totalCost)}</b> · профит <b class=${tone(total)}>${total === null ? (miss.length ? 'не хватает цен' : 'нет цены продажи') : signed(total)}</b>${pts !== null ? html` · очков ${fmt(pts)}` : null}${afterNote}`}</div>
    ${d ? html`<div class="li-turn"><${Turnover} info=${turnoverInfo(x.quantity, turnoverPerDay(x, d).perDay, windowDays)} qty=${x.quantity} /></div>` : null}
    <div class="li-opts">
      ${x.faction ? html`<label class="switch sm"><input type="checkbox" checked=${!!x.crestSilver} onChange=${(e) => ops.patch(x.uid, { crestSilver: e.target.checked })} /> герб за серебро</label>
        <label class="switch sm"><input type="checkbox" checked=${!!x.heartSilver} onChange=${(e) => ops.patch(x.uid, { heartSilver: e.target.checked })} /> сердце за серебро</label>` : null}
      ${x.salePrice > 0 || x.faction ? html`<label class="chipin" title="Цена продажи одного плаща: по умолчанию из плана; впиши свою — профит пересчитается сразу">цена продажи<input type="number" min="0" placeholder=${x.salePrice > 0 ? Math.round(x.salePrice) : 'нет данных'} value=${x.salePriceOwn ?? ''} onInput=${(e) => { const v = parseFloat(e.target.value); ops.patch(x.uid, { salePriceOwn: v > 0 ? v : undefined }); setTimeout(() => engine.redecide(x.uid), 0); }} /></label>` : null}
      <button type="button" class="linkbtn" onClick=${() => onDetail(x)}>${detailLabel}</button>
    </div>
    ${miss.length ? html`<div class="li-miss"><span class="pl">Не хватает цен материалов</span>${miss.map((m) => html`<${MissingInput} key=${m.id} m=${m} item=${x} def=${def} />`)}</div>` : null}
  </div>`;
}

export function StackCards({ def, data, onDetail, detailLabel }) {
  return html`<div class="li-cards">${data.items.map((x) => html`<${StackCard} key=${x.uid} def=${def} x=${x} result=${data.results.get(x.uid)} pair=${data.pairs.get(x.uid)} onDetail=${onDetail} detailLabel=${detailLabel} />`)}</div>`;
}

// Итоги по включённым позициям: вложения, профит, очки, количество; предупреждения о нехватке очков и данных
export function StackTotals({ data }) {
  const { totals: t, faction } = data;
  const over = faction && t.points > faction.points;
  return html`<${Fragment}>
    <div class="totals four"><div><span>Вложения</span><b class="neg">${fmt(t.cost)}</b></div><div class="soft-good"><span>Профит</span><b class=${tone(t.profit)}>${signed(t.profit)}</b></div>
      <div><span>Очки${faction ? ` из ${fmt(faction.points)}` : ''}</span><b class=${over ? 'neg' : ''}>${fmt(t.points)}</b></div><div><span>Плащей / позиций</span><b>${fmt(t.capes)} / ${t.items}</b></div></div>
    ${over ? html`<div class="note neg" style="margin:0">Очков не хватает: ${fmt(t.points - faction.points)}</div>` : null}
    ${t.noPrice || t.pending || t.errors ? html`<div class="note" style="margin:0">${t.pending ? `Считается позиций: ${t.pending}. ` : ''}${t.noPrice ? `Не хватает цен материалов или продажи (в итоги не входят): ${t.noPrice} — впиши их в карточках. ` : ''}${t.errors ? `С ошибкой: ${t.errors}.` : ''}</div>` : null}</${Fragment}>`;
}
