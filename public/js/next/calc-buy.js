// Вкладка «Закупка»: материалы рецепта (откуда дешевле, переработка/крафт самому), план закупки по городам, свои цены и лог закупок по лотам,
// база .0, чары после крафта, логистика по телепорту.
import { html, useStore, useMemo, fmt, tone, signed, itemLabel, fmtDays, apiPost } from './lib.js';
import { settings } from './settings.js';
import { calcStore, resetOwn, setChainChoice, setForceMain } from './calc-store.js';
import { prices, setOwn, setCityOwn, addLot, setLot, delLot, hasAnyPrices } from './prices.js';
import { CityPriceList } from './citylist.js';
import { CityPill, Tags, MaterialName, Switch, toast } from './ui.js';
import { acquisitionRows, withOverride } from './logic/acquire.js';
import { lotsAverage } from './logic/manual.js';

const unitPlaceholder = (p) => (p === null || p === undefined ? 'своя цена' : String(Math.round(p * (Math.abs(p) < 100 ? 10 : 1)) / (Math.abs(p) < 100 ? 10 : 1)));
const nameOf = (d, id) => (d.names && d.names[id]) || itemLabel(id);
// Цена покупки выбранного входа в цепочку зачарования (готовый .1/.2/.3 с рынка) — из eac.candidates по chainEntryLevel
const entryPriceOf = (eac) => { const c = (eac.candidates || []).find((x) => x.entryLevel === eac.chainEntryLevel); return c ? c.entryPrice : null; };

// Своя цена материала (или лог лотов, если включён): цена за штуку; серая подсказка — рыночная
export function OwnPrice({ resKey, market, needed, scope }) {
  const pr = useStore(prices);
  const s = useStore(settings);
  if (s.purchaseLog) return html`<${LotLog} resKey=${resKey} needed=${needed} scope=${scope} />`;
  const v = Object.prototype.hasOwnProperty.call(pr.own, resKey) ? pr.own[resKey] : '';
  return html`<input class=${`manual-price ${v !== '' ? 'is-manual' : ''}`} type="number" min="0" step="1" data-res=${resKey} data-scope=${scope} placeholder=${unitPlaceholder(market)} value=${v} onInput=${(e) => setOwn(resKey, e.target.value)} title="Серым — цена за штуку по рынку. Видишь другую цену в игре — впиши свою: расчёт обновится сразу" aria-label="Своя цена" />`;
}

function LotLog({ resKey, needed, scope }) {
  const pr = useStore(prices);
  const lots = pr.lots[resKey] || [];
  const avg = lotsAverage(lots);
  const need = needed || 0;
  return html`<div class="lot-log" data-scope=${scope}>${lots.map((l, i) => html`<div class="lot-row" key=${i}>
      <input class="lot-qty" type="number" min="1" step="1" value=${l.qty} placeholder="шт" title="Сколько штук в стаке" onInput=${(e) => setLot(resKey, i, 'qty', e.target.value)} />
      <span>×</span>
      <input class="lot-price" type="number" min="0" step="1" value=${l.price} placeholder="цена" title="Цена за штуку" onInput=${(e) => setLot(resKey, i, 'price', e.target.value)} />
      <button type="button" class="lot-del" title="Убрать стак" onClick=${() => delLot(resKey, i)}>×</button></div>`)}
    <button type="button" class="lot-add" data-res=${resKey} data-scope=${scope} onClick=${() => addLot(resKey)}>+ стак</button>
    <div class="lot-sum"><small>${avg ? `средняя ${fmt(avg.avg, 1)} · ` : ''}${avg ? `куплено ${fmt(avg.qty)} из ${fmt(need)} (${need > 0 ? Math.round((avg.qty / need) * 100) : 0}%)` : `нужно ${fmt(need)}`}</small></div></div>`;
}

function MissingServerPrice({ id, label, onSaved }) {
  const save = async (e) => {
    const price = parseFloat(e.target.value);
    if (!(price > 0)) return;
    await apiPost('/api/manual-price', { id, quality: 1, price });
    toast(`Цена сохранена: ${label}`);
    onSaved();
  };
  return html`<span class="mp"><input type="number" min="0" placeholder="общая цена" title="Нет цены на рынке: впиши — она сохранится как общая «недостоверная» на 10 дней" onBlur=${save} onKeyDown=${(e) => { if (e.key === 'Enter') save(e); }} aria-label=${`Цена: ${label}`} /></span>`;
}

// Компоненты переработки/крафта самому (сырьё, кожа, ткань предыдущего тира): своя цена и панель «Все города» — как у обычного
// материала, а не просто имя в тексте сравнения. Раньше их вообще нельзя было раскрыть по городам, хотя своя цена на них уже
// умела пересчитывать себестоимость (logic/manual.js) — просто нечем было её вписать.
function ComponentPrices({ d, components, lists }) {
  const pr = useStore(prices);
  return html`<div class="comp-list">${components.map((cp) => html`<div class="comp-row" key=${cp.id}>
    <${MaterialName} id=${cp.id} name=${nameOf(d, cp.id)} />
    <${OwnPrice} resKey=${cp.id} market=${cp.price} needed=${cp.count * d.quantity} scope="component" />
    ${lists[cp.id] && lists[cp.id].length ? html`<${CityPriceList} resKey=${cp.id} list=${lists[cp.id]} own=${pr.cityOwn[cp.id]} fee=${d.setupFeeRate} label="Все города" onSet=${(city, v) => setCityOwn(cp.id, city, v)} />` : null}
  </div>`)}</div>`;
}

const sourceLine = (r, nameFn) => {
  const parts = (o) => o.components.map((cp) => `${cp.count}× ${nameFn(cp.id)}`).join(' + ');
  if (r.materialSource === 'refine' && r.refineOption && !r.manualPrice) {
    return html`<span class="refine-source" title=${`Сырьё и полуфабрикат предыдущего тира по рыночным ценам, ставка возврата при переработке ${(r.refineOption.rate * 100).toFixed(1)}%${r.buyPrice ? `; готовый на рынке — ${fmt(r.buyPrice)}` : ''}`}>♻ выгоднее переработать в ${r.refineOption.city}: ${fmt(r.cheapestPrice)}${r.buyPrice ? ` (−${Math.round((1 - r.cheapestPrice / r.buyPrice) * 100)}%)` : ''}</span><br /><small>${parts(r.refineOption)}</small>`;
  }
  if (r.materialSource === 'craft' && r.craftOption && !r.manualPrice) {
    return html`<span class="refine-source" title=${`Сам плащ-ингредиент в рецепте не возвращается, но если крафтить его самому — возврат при крафте действует на ткань и кожу${r.buyPrice ? `; готовый на рынке — ${fmt(r.buyPrice)}` : ''}`}>🔨 выгоднее скрафтить самому: ${fmt(r.cheapestPrice)}${r.buyPrice ? ` (−${Math.round((1 - r.cheapestPrice / r.buyPrice) * 100)}%)` : ''}</span><br /><small>${parts(r.craftOption)}</small>`;
  }
  return html`<span><${CityPill} name=${r.cheapestCity} /> ${fmt(r.cheapestPrice)}</span>`;
};

function acquireRowsFor(d, r) {
  const rows = d.acquire ? d.acquire.byResource.filter((a) => (a.parent || a.resource) === r.resource) : [];
  const wanted = r.materialSource === 'refine' ? 'refine' : r.materialSource === 'craft' ? 'craft' : 'buy';
  return rows.every((a) => (a.source || 'buy') === wanted) ? rows : [];
}
function acquireDaysFor(d, r) {
  const rows = acquireRowsFor(d, r);
  if (!rows.length || rows.some((x) => x.daysToAcquire === null)) return null;
  return Math.max(...rows.map((x) => x.daysToAcquire));
}

function RecipeTable({ d, lists, invalidate }) {
  const pr = useStore(prices);
  const rowsData = d.recipe.map((r) => ({ ...r, needed: r.neededToBuy ?? r.count * d.quantity, byRecipe: r.count * d.quantity, enchStep: null }));
  if (d.enchantAfterCraft) {
    for (const st of d.enchantAfterCraft.steps) rowsData.push({ resourceName: st.materialName, resource: st.materialId, enchanted: false, enchStep: st.level, needed: st.count * d.quantity, byRecipe: st.count * d.quantity, returnable: false, cheapestCity: st.cheapestCity, cheapestPrice: st.cheapestPrice, cityPrices: st.cityPrices, manualPrice: st.manualPrice });
  }
  const total = rowsData.reduce((s, r) => s + (r.cheapestPrice === null ? 0 : r.cheapestPrice * r.needed), 0);
  const bottleneck = d.acquire && (d.acquire.bottleneckParent || d.acquire.bottleneckResource);
  return html`<div class="card"><div class="tw"><table id="craft-recipe-table">
    <thead><tr><th>Материал</th><th>Нужно всего</th><th>Где дешевле</th><th>Сумма</th><th>Дней на закупку</th><th title="Ставка возврата ресурсов для этого материала в городе его покупки">Возврат</th></tr></thead>
    <tbody>${rowsData.map((r) => {
      const id = r.queryId || r.resource;
      const missing = r.cheapestPrice === null;
      const days = acquireDaysFor(d, r);
      return html`<tr key=${r.resource + (r.enchStep || '')}>
        <td><${MaterialName} id=${id} name=${nameOf(d, id)} />
          ${r.enchStep ? html` <span class="tag e">.${r.enchStep - 1} → .${r.enchStep}</span>` : null}
          ${r.returnable === false && !r.enchStep ? html` <span class="no-return" title="Этот материал при крафте не возвращается — возврат на него не действует">без возврата</span>` : null}</td>
        <td>${fmt(r.needed)}${r.byRecipe !== undefined && r.byRecipe !== r.needed ? html`<br /><small>по рецепту ${fmt(r.byRecipe)}</small>` : null}</td>
        <td>${missing ? html`<span class="pill w">нет цены</span> <${MissingServerPrice} id=${id} label=${nameOf(d, id)} onSaved=${invalidate} />`
          : r.materialSource === 'points' ? html`<span class="pill n" title="Получено у интенданта за фракционные очки — в серебре 0">за очки: ${fmt(r.points)} на шт · ${fmt(r.points * d.quantity)} на ${fmt(d.quantity)} шт</span>`
          : html`${sourceLine(r, (x) => nameOf(d, x))}${r.priceSource === 'quote' ? html`<br /><small class="scan-stale" title="Сделок за окно нет — взята текущая котировка">котировка</small>` : null}${r.manual ? html` <span class="fp-warn" title="Вписано вручную — недостоверная цена">⚠</span>` : null}<br /><${OwnPrice} resKey=${r.resource} market=${r.marketPrice ?? r.cheapestPrice} needed=${r.needed} scope="recipe" />${lists[r.resource] ? html`<br /><${CityPriceList} resKey=${r.resource} list=${lists[r.resource]} own=${pr.cityOwn[r.resource]} fee=${d.setupFeeRate} label=${r.materialSource === 'buy' ? 'Все города' : 'Готовый — все города'} onSet=${(city, v) => setCityOwn(r.resource, city, v)} />` : null}${r.materialSource === 'refine' && r.refineOption ? html`<${ComponentPrices} d=${d} components=${r.refineOption.components} lists=${lists} />` : r.materialSource === 'craft' && r.craftOption ? html`<${ComponentPrices} d=${d} components=${r.craftOption.components} lists=${lists} />` : null}`}</td>
        <td class=${missing ? 'neg' : ''}>${missing ? '—' : fmt(r.cheapestPrice * r.needed)}</td>
        <td>${days !== null ? fmtDays(days) : '—'}${bottleneck === r.resource ? ' 🐢' : ''}</td>
        <td>${r.materialSource === 'craft' && r.craftOption ? html`<span title="Плащ-ингредиент не возвращается, но при крафте плаща самому ткань и кожа возвращаются">${fmt((d.rrrOptions ? d.rrrOptions.gearRate : 0) * 100, 1)}% на ткань и кожу</span>`
          : r.returnable === false ? '—' : html`${r.materialSource === 'refine' && r.refineOption ? html`<span title=${`Два независимых возврата: переработка сырья (${(r.refineOption.rate * 100).toFixed(1)}%) и крафт гира из готового полуфабриката`}>${fmt(r.refineOption.rate * 100, 1)}% сырьё · ${fmt((r.rrr || 0) * 100, 1)}% гир</span>` : `${fmt((r.rrr || 0) * 100, 1)}%`}${r.cityBonus ? html` <span title="Сработал бонус города">★</span>` : null}`}</td></tr>`;
    })}</tbody>
    <tfoot><tr class="materials-total"><td colspan="3">Итого материалы к закупке (с учётом возврата)</td><td class="neg">${fmt(total)}</td><td></td><td></td></tr></tfoot></table></div></div>`;
}

function PlanTable({ d, c, override }) {
  const rows = useMemo(() => acquisitionRows(d, itemLabel), [d]);
  const done = rows.filter((r) => c.checks[r.key]).length;
  let total = 0;
  const view = rows.map((raw) => { const ov = override(raw.key); const r = ov ? withOverride(raw, ov) : raw; if (r.sum !== null) total += r.sum; return { r, own: ov ? ov.price : undefined }; });
  return html`<div class="card" style="margin-top:14px"><div class="tw"><table id="buy-table">
    <thead><tr><th>Что покупаем</th><th>Нужно</th><th>Где и по чём</th><th>Цена / шт</th><th>Своя цена</th><th>Сумма</th><th>Дней</th></tr></thead>
    <tbody>${view.map(({ r, own }) => html`<tr key=${r.key + r.why} class=${c.checks[r.key] ? 'done' : ''}>
      <td><div class="matrow"><input type="checkbox" class="ck" checked=${!!c.checks[r.key]} onChange=${(e) => calcStore.set({ checks: { ...c.checks, [r.key]: e.target.checked } })} aria-label=${`Куплено: ${r.name}`} />
        <${MaterialName} id=${r.id} name=${r.name} /></div>
        ${r.why ? html`<div class="muted" style="font-size:12.5px;margin-left:28px">${r.why}</div>` : null}</td>
      <td>${fmt(r.needed)}</td>
      <td class="plan-cities">${r.cities.length ? r.cities.map((x) => html`<div key=${x.city}><${CityPill} name=${x.city} /> <span class="muted">${fmt(x.qty)} шт по ${fmt(x.price, x.price < 100 ? 1 : 0)}</span></div>`) : html`<span class="pill w">нет данных</span>`}</td>
      <td class="neg">${r.unit === null || r.unit === undefined ? 'нет цены' : fmt(r.unit, r.unit < 100 ? 1 : 0)}${own !== undefined ? html` <small class="is-manual-note">своя</small>` : null}</td>
      <td><${OwnPrice} resKey=${r.key} market=${raw0(rows, r.key)} needed=${r.needed} scope="plan" /></td>
      <td class="neg">${r.sum === null || r.sum === undefined ? '—' : fmt(r.sum)}</td>
      <td>${r.days !== null && r.days !== undefined ? fmtDays(r.days) : '—'}</td></tr>`)}</tbody>
    <tfoot><tr class="materials-total"><td colspan="5">Итого на план закупки</td><td class="neg">${fmt(total)}</td><td></td></tr></tfoot></table></div>
    <div class="statusline">Куплено ${done} из ${rows.length} позиций · что и где покупать — с учётом возврата при переработке и при крафте</div></div>`;
}
const raw0 = (rows, key) => { const r = rows.find((x) => x.key === key); return r ? r.unit : null; };

// Дропдаун «какой рецепт считать» — варианты «после крафта»: база .0 и вся цепочка; смешанные рецепты (база сразу на уровне .L из
// зачарованного сырья, докрутка только оставшихся шагов); «купить готовый .L» (если включено «Покупка готового уровня» и цена есть).
// Значения: '' — автовыбор (самый дешёвый), `v<L>` — база на уровне L, `b<L>` — купить готовый .L. Пересчёт на месте (calc-store derive,
// logic/enchantChain.js pickVariant/applyChainChoice) — без нового запроса. Тумблер «Только основной рецепт» — строго база .0 и вся цепочка.
function ChainChoice({ c, eac, variantLevel }) {
  const ch = c.chainChoice;
  const forceMain = ch.forceMain;
  const opts = [];
  const zero = c.data;
  for (const [lvl, v] of [[0, zero], ...Object.entries(c.hybrids || {}).map(([l, d]) => [Number(l), d])]) {
    if (!v || v.error || !v.enchantAfterCraft) continue;
    const e = v.enchantAfterCraft;
    const ok = v.hasAllMaterialPrices !== false;
    opts.push({ value: `v${lvl}`, text: `${lvl === 0 ? 'База .0 из обычного сырья + вся цепочка (руны, души, реликты)' : `База .${lvl} из зачарованного сырья + докрутка до .${e.targetLevel}`}${ok ? ` — ${fmt(v.effectiveCostPerUnit)} / шт` : ' — нет цен'}`, ok });
    if (lvl === 0) for (const cand of e.candidates || []) if (cand.entryLevel > 0) opts.push({ value: `b${cand.entryLevel}`, text: `Купить готовый ${cand.entryLabel} и докрутить — ${fmt(cand.cost)} / шт`, ok: true });
  }
  const value = forceMain ? 'v0' : ch.entryLevel ? `b${ch.entryLevel}` : ch.baseLevel !== null && ch.baseLevel !== undefined ? `v${ch.baseLevel}` : '';
  const pick = (v) => { if (v === '') setChainChoice(null, null); else if (v[0] === 'b') setChainChoice(0, Number(v.slice(1))); else setChainChoice(Number(v.slice(1)), null); };
  return html`<div class="chain-choice" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:6px">
    ${opts.length > 1 ? html`<label class="f" style="width:auto"><span class="pl">Рецепт</span><select id="chain-recipe" value=${value} disabled=${forceMain} onChange=${(e) => pick(e.target.value)}>
      <option value="">Автовыбор (дешевле всего)</option>
      ${opts.map((o) => html`<option key=${o.value} value=${o.value} disabled=${!o.ok}>${o.text}</option>`)}</select></label>` : null}
    <${Switch} checked=${forceMain} onChange=${setForceMain} title="Игнорировать смешанные рецепты и покупку готового — считать строго базу .0 и всю цепочку рунами/душами/реликтами">Только основной рецепт</${Switch}>
  </div>`;
}

function Teleport({ d }) {
  const t = d.teleport;
  const wrap = (body) => html`<div class="card box teleport-plan" style="margin-top:14px">${body}</div>`;
  if (!t) return wrap(html`<div class="kv"><div><span>Телепорт</span><b>маршрут посчитать нельзя (нет цен в городах без Каэрлеона)</b></div></div>`);
  const opt = (label, o) => (o ? html`<div><span>${label}: везём в ${o.city} (${o.distance === 0 ? 'на месте' : `×${o.distance}`}, перевозка ${fmt(o.cost)})</span><b class=${tone(o.profitPerUnit)}>профит/шт ${fmt(o.profitPerUnit)}</b></div>` : html`<div><span>${label}</span><b>нет цен</b></div>`);
  return wrap(html`<h2 class="sec">Логистика (телепорт): собираем в ${t.homeCity}</h2>
    <div class="tw"><table><thead><tr><th>Материал</th><th>Покупаем в</th><th>Штук</th><th>Дистанция</th><th>Перевозка</th></tr></thead>
      <tbody>${t.materialLegs.map((l) => html`<tr key=${l.resource}><td>${l.resourceName}</td><td>${l.fromCity}</td><td>${fmt(l.needed)}</td><td>${l.distance === 0 ? 'на месте' : `×${l.distance}`}</td><td>${fmt(l.cost)}</td></tr>`)}</tbody></table></div>
    <div class="kv" style="margin-top:10px"><div><span>Перевозка материалов, всего</span><b>${fmt(t.legsCost)}</b></div>
      ${t.unweighted && t.unweighted.length ? html`<div><span class="scan-stale">⚠ Нет данных о весе, перевозка НЕ учтена: ${t.unweighted.join(', ')}</span><b></b></div>` : null}
      <div><span>Себестоимость с логистикой / шт</span><b>${fmt(t.costPerUnit)}</b></div>${opt('Продажа через Sell Order', t.patient)}${opt('Продажа в Buy Order', t.instant)}</div>`);
}

export function BuyTab({ c, d, lists, override, invalidate }) {
  const s = useStore(settings);
  const pr = useStore(prices);
  const eac = d.enchantAfterCraft;
  const b = d.baseChoice;
  return html`<div id="sub-buy">
    ${d.hasAllMaterialPrices === false ? html`<p class="calc-note warnline">⚠ По части материалов (например, чертежи и жетоны фракций) нет рыночных цен в выбранных городах — итоговая себестоимость занижена на их стоимость.</p>` : null}
    <${RecipeTable} d=${d} lists=${lists} invalidate=${invalidate} />
    <${PlanTable} d=${d} c=${c} override=${override} />
    ${d.manualPrices && hasAnyPrices(pr) ? html`<p class="note"><button type="button" class="btn sm manual-reset" onClick=${resetOwn}>Сбросить свои цены</button> Расчёт идёт по твоим ценам; «Сравнение по тирам» и качеству считает по рыночным.</p>` : null}
    <div class="card box" style="margin-top:14px"><div class="kv" id="cost-summary">
      <div><span>Себестоимость материала / шт (сырое)</span><b>${fmt(Math.round(d.materialCostPerUnit))}</b></div>
      <div><span title=${d.rrrPreset ? d.rrrPreset.label : ''}>Себестоимость с учётом возврата (в среднем ${fmt((d.rrrPreset ? d.rrrPreset.rrr : 0) * 100, 1)}%) / шт</span><b>${fmt(Math.round(d.effectiveCostPerUnit))}</b></div></div></div>
    ${b ? html`<div class="card box base-choice" style="margin-top:14px"><div class="kv">
      <div><strong>Базовый предмет (.0): выгоднее ${b.baseSource === 'buy' ? 'купить готовый' : 'скрафтить'}</strong><b>${fmt(b.baseCostPerUnit)} / шт</b></div>
      <div><span>Себестоимость крафта / шт</span><b>${b.baseCraftCostPerUnit !== null ? fmt(b.baseCraftCostPerUnit) : 'нет цен на материалы'}</b></div>
      <div><span>Цена покупки готового (Sell Order)</span><b>${b.baseBuy ? html`<${CityPill} name=${b.baseBuy.city} /> ${fmt(b.baseBuy.price)}` : 'нет предложений'}</b></div></div></div>` : null}
    ${eac ? html`<div class="card box enchant-after" style="margin-top:14px"><h2 class="sec">Зачарование после крафта: до .${eac.targetLevel}</h2>
      <${ChainChoice} c=${c} eac=${eac} />
      <div class="kv">
      ${eac.forced ? html`<div><span>Этот плащ в зачарованном виде не крафтится: сначала делается обычный, затем зачаровывается рунами и душами.</span><b></b></div>` : null}
      ${eac.capped ? html`<div><span class="scan-stale">⚠ Зачарование .4 (Awakening) не поддерживается — посчитано до .3</span><b></b></div>` : null}
      <div><span>Вход в цепочку</span><b>${eac.chainEntryLevel > 0
        ? html`куплен готовый ${eac.chainEntryLabel}: <${CityPill} name=${eac.chainEntryCity} /> ${fmt(entryPriceOf(eac))}`
        : eac.baseSource === 'buy' ? html`база .${eac.baseLevel || 0} — покупка дешевле крафта: <${CityPill} name=${eac.baseBuy.city} /> ${fmt(eac.baseBuy.price)}` : `база .${eac.baseLevel || 0} — крафт из материалов${eac.baseLevel ? ' (сырьё зачарованное до .' + eac.baseLevel + ')' : ''}: ${fmt(eac.baseCraftCostPerUnit)}`}</b></div>
      ${(eac.neededSteps || eac.steps).map((st) => html`<div key=${st.level}><span>.${st.level - 1} → .${st.level}: ${st.materialName} × ${fmt(st.count * d.quantity)} (${fmt(st.count)} на вещь)</span><b>${st.cost !== null ? `${fmt(st.cost)} / шт` : 'нет цены'}</b></div>`)}
      <div><span>Зачарование / шт (материалы — в таблице выше)</span><b>${fmt(eac.stepsCostPerUnit)}</b></div>
      <div><strong>Итого себестоимость с зачарованием / шт</strong><b>${fmt(d.effectiveCostPerUnit)}</b></div></div></div>` : null}
    ${s.teleport ? html`<${Teleport} d=${d} />` : null}
    <p class="note">Клик по названию копирует его для поиска на аукционе. Галочки — чек-лист закупки.</p></div>`;
}
