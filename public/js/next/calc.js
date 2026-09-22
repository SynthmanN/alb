// Калькулятор крафта одного предмета: вердикт сверху (профит, ROI, доходы и расходы), ниже вкладки «Закупка» и «Продажа» (в ней — свёрнутое «Ещё сравнения»: по качеству и по тирам).
// Свои цены, лог закупок и план продажи пересчитывают результат на месте (calc-store.js + logic/manual.js).
import { html, useStore, useState, useEffect, useMemo, Fragment, allItems, itemsReady, groupsReady, getWeaponGroups, findItem, itemLabel, itemTier, fmt, signed, tone, apiGet, fmtAge, fmtDays, QN } from './lib.js';
import { commonParams, settings } from './settings.js';
import { meta } from './params.js';
import { Glyph, Tags, CityPill, Switch, Icon, ICONS, Spinner } from './ui.js';
import { addToList, craftList } from './list.js';
import { navStore, nav } from './nav.js';
import { calcStore, emptyManual, derive, planOfStore } from './calc-store.js';
import { prices } from './prices.js';
import { ItemPicker, GEAR, familyOf } from './picker.js';
import { StackView, StackFocusBar } from './calc-stack.js';
import { stack } from './list.js';
import { BuyTab } from './calc-buy.js';
import { SellTab } from './calc-sell.js';

export { calcStore };
const maxEnchant = (id) => (itemTier(id) >= 4 ? 4 : 0);
let runId = 0;

export async function runCalc(sig) {
  const c = calcStore.get();
  if (!c.itemId) return;
  const id = ++runId;
  calcStore.set({ loading: true, error: '' });
  try {
    const params = { ...commonParams(), item: c.itemId, enchant: c.enchant, quality: c.quality, quantity: c.qty, ...(c.after ? { enchantAfterCraft: 'true' } : {}) };
    const fac = craftList.get().faction;
    if (c.faction && fac) {                                   // фракционный плащ из плана: герб и сердце за очки, если не куплены за серебро
      params.faction = fac.id; params.factionPoints = fac.points;
      const sp = [c.crestSilver ? 'crest' : null, c.heartSilver ? 'heart' : null].filter(Boolean);
      if (sp.length) params.partsSilver = sp.join(',');
    }
    const data = await apiGet('/api/craft-calc', params, { ttl: 90000 });
    if (id !== runId) return;
    if (data.jug && data.jug.lastPricePass) meta.set({ jugAt: data.jug.lastPricePass });
    calcStore.set({ data, sig, loading: false, checks: {}, toggles: null, manualQty: {} });      // план продажи сбрасывается с новым расчётом; свои цены остаются
  } catch (err) {
    if (id === runId) calcStore.set({ loading: false, error: err.message, sig });
  }
}
const pickItem = (id, extra = {}) => calcStore.set({ itemId: id, data: null, sig: '', error: '', ...emptyManual(), ...extra });

// «Открыть в калькуляторе» из других вкладок
navStore.subscribe(() => {
  const t = navStore.get().calc;
  if (!t || t.handled) return;
  navStore.set({ calc: { ...t, handled: true } });
  pickItem(t.itemId, { enchant: t.enchant || 0, quality: t.quality || 1, qty: t.quantity || 1, after: !!t.after, faction: !!t.faction, crestSilver: !!t.crestSilver, heartSilver: !!t.heartSilver, stackMode: false, stackFocus: null });
});

// ---------- где крафтить: город бонуса ----------
const BONUS_WEAPON = { COMBAT_SWORDS: 'Lymhurst', COMBAT_BOWS: 'Lymhurst', COMBAT_ARCANESTAFFS: 'Lymhurst', COMBAT_AXES: 'Martlock', COMBAT_QUARTERSTAFFS: 'Martlock', COMBAT_FROSTSTAFFS: 'Martlock', COMBAT_HAMMERS: 'Fort Sterling', COMBAT_SPEARS: 'Fort Sterling', COMBAT_HOLYSTAFFS: 'Fort Sterling', COMBAT_MACES: 'Thetford', COMBAT_FIRESTAFFS: 'Thetford', COMBAT_NATURESTAFFS: 'Thetford', COMBAT_CROSSBOWS: 'Bridgewatch', COMBAT_DAGGERS: 'Bridgewatch', COMBAT_CURSEDSTAFFS: 'Bridgewatch', COMBAT_SHAPESHIFTER: 'Caerleon', COMBAT_KNUCKLES: 'Caerleon', COMBAT_BOOKS: 'Martlock', COMBAT_TORCHES: 'Martlock', COMBAT_SHIELDS: 'Martlock' };
const BONUS_ARMOR = { ARMOR_CLOTH: 'Fort Sterling', HEAD_CLOTH: 'Thetford', SHOES_CLOTH: 'Bridgewatch', ARMOR_LEATHER: 'Thetford', HEAD_LEATHER: 'Lymhurst', SHOES_LEATHER: 'Lymhurst', ARMOR_PLATE: 'Bridgewatch', HEAD_PLATE: 'Fort Sterling', SHOES_PLATE: 'Martlock' };
export function gearBonusCity(item) {
  if (!item) return null;
  if (item.category === 'cape') return 'Brecilien';
  const fam = familyOf(item.id);
  if (item.category === 'armor') { const m = fam.match(/^(ARMOR|HEAD|SHOES)_(CLOTH|LEATHER|PLATE)/); return m ? BONUS_ARMOR[`${m[1]}_${m[2]}`] || null : null; }
  const group = getWeaponGroups().find((g) => g.families.includes(fam));
  return group ? BONUS_WEAPON[group.id] || null : null;
}

// ---------- вердикт ----------
function Verdict({ c, d, p, st }) {
  const ok = p && p.unit !== null && p.unit > 0;
  const it = findItem(c.itemId);
  const bonus = gearBonusCity(it);
  const add = () => addToList({ itemId: c.itemId, enchant: c.enchant, quality: c.quality, quantity: c.qty, cost: d.effectiveCostPerUnit, profit: p ? p.unit : 0, after: c.after && c.enchant > 0 });
  return html`<div class="card verdict" id="verdict">
    <div>
      <div class="v-head"><${Glyph} id=${c.itemId} tier=${itemTier(c.itemId)} enchant=${c.enchant} quality=${c.quality} size=${96} />
        <div><h2>${itemLabel(c.itemId)}</h2><${Tags} tier=${itemTier(c.itemId)} enchant=${c.enchant} quality=${c.quality} /> <span class="muted">· ${fmt(c.qty)} шт</span>
          ${bonus ? html`<div class="muted" style="font-size:13px;margin-top:4px" title="Город, где крафт этого предмета даёт бонус к возврату. Ставку выбираешь ты в панели параметров">бонус крафта: <${CityPill} name=${bonus} /></div>` : null}</div></div>
      <div class="v-pills">
        ${p && p.unit !== null ? html`<span class=${`pill ${ok ? 'g' : 'w'}`}>${ok ? 'Стоит крафтить' : 'Невыгодно'} · ${p.basis === 'sell' ? 'Sell Order' : 'Buy Order'}${d.manualPrices ? ' · по твоим ценам' : ''}</span>` : html`<span class="pill w">нет цены продажи</span>`}
        ${p && p.days !== null ? html`<span class="pill n">продажа партии ≈ ${fmtDays(p.days)}</span>` : null}
        ${d.faction ? html`<span class="pill n">очков: ${fmt(d.faction.pointsPerCape * c.qty)}</span>` : null}
        ${p && !p.complete ? html`<span class="pill w">нет цены части материалов</span>` : null}
      </div>
      <div class="pair"><div class="soft-good"><span>Доходы (после налога)</span><b class="pos">${p ? fmt(p.income) : '—'}</b></div><div class="soft-bad"><span>Расходы</span><b class="neg">${fmt(d.totalCost)}</b></div></div>
      <div class="v-actions"><button class="btn primary" type="button" id="calc-add" onClick=${add}><${Icon} d=${ICONS.plus} />В крафт-лист</button><button class="btn ghost" type="button" onClick=${() => nav.tab('scan')}>← К скану</button></div>
    </div>
    <div class="stats">
      <div class=${`stat lead ${ok ? '' : 'bad'}`}><span>Профит с одной штуки</span><b class=${tone(p && p.unit)}>${p ? signed(p.unit) : '—'}</b></div>
      <div class="stat"><span>ROI</span><b>${p && p.roi !== null ? `${fmt(p.roi, 0)}%` : '—'}</b></div>
      <div class="stat"><span>Профит всего</span><b class=${tone(p && p.total)}>${p ? signed(p.total) : '—'}</b></div>
      <div class="stat"><span>Вложения на штуку</span><b class="neg">${fmt(d.effectiveCostPerUnit)}</b></div>
      <div class="stat"><span>Оборот в день</span><b>${d.patientSell ? fmt(d.patientSell.marketDailyVolume, 1) : '—'}</b></div>
      <div class="stat"><span>Мгновенно (Buy Order)</span><b class=${tone(d.profitPerUnit)}>${signed(d.profitPerUnit)}</b></div>
    </div></div>`;
}

// Вкладка калькулятора: стек активных позиций (общий вид) или одна вещь (обычный расчёт; в режиме стека — позиция в фокусе)
export function CalcTab() {
  const c = useStore(calcStore);
  return c.stackMode && !c.stackFocus ? html`<${StackView} />` : html`<${SingleCalc} />`;
}

function SingleCalc() {
  const c = useStore(calcStore);
  const s = useStore(settings);
  const pr = useStore(prices);
  const [, force] = useState(0);
  useEffect(() => { Promise.all([itemsReady, groupsReady]).then(() => force((n) => n + 1)); }, []);
  const sig = JSON.stringify([c.itemId, c.enchant, c.quality, c.qty, c.after, c.faction, c.crestSilver, c.heartSilver, commonParams(s)]);
  useEffect(() => {
    if (!c.itemId || sig === c.sig) return undefined;
    const t = setTimeout(() => runCalc(sig), 350);
    return () => clearTimeout(t);
  }, [sig, c.itemId]);
  useEffect(() => {                                              // правки позиции в фокусе (тир, чары, качество, количество) идут в стек
    if (c.stackMode && c.stackFocus && c.itemId) stack.patch(c.stackFocus, { itemId: c.itemId, enchant: c.enchant, quality: c.quality, quantity: c.qty, after: c.after, plan: planOfStore(c) });
  }, [c.stackFocus, c.itemId, c.enchant, c.quality, c.qty, c.after, c.toggles, c.manualQty, c.cityPrices, c.strategy]);
  const set = (p) => calcStore.set(p);
  const { d, st, p, override, lists } = useMemo(() => derive(c, s, pr), [c.data, pr, c.sellPrice, c.cityPrices, c.toggles, c.manualQty, c.strategy, s.purchaseLog]);
  const maxE = c.itemId ? maxEnchant(c.itemId) : 4;
  const family = c.itemId ? allItems().filter((i) => GEAR(i) && i.category === (findItem(c.itemId) || {}).category && familyOf(i.id) === familyOf(c.itemId)).sort((a, b) => a.tier - b.tier) : [];
  const subs = [['buy', 'Закупка'], ['sell', 'Продажа']];   // «Сравнение по тирам» и по качеству — свёрнутым блоком «Ещё сравнения» внутри «Продажа» (calc-sell.js)
  const invalidate = () => set({ sig: '' });
  return html`<section class="panel" id="panel-calc">
    ${c.stackMode && c.stackFocus ? html`<${StackFocusBar} />` : null}
    <div class="filters">
      <${ItemPicker} value=${c.itemId} onPick=${(id) => pickItem(id, { enchant: Math.min(c.enchant, maxEnchant(id)) })} />
      <label class="f" style="width:120px">Зачарование<select id="c-ench" value=${c.enchant} onChange=${(e) => set({ enchant: +e.target.value })}>${[0, 1, 2, 3, 4].map((e) => html`<option value=${e} selected=${c.enchant === e} disabled=${e > maxE}>.${e}</option>`)}</select></label>
      <label class="f" style="width:150px">Качество<select id="c-q" value=${c.quality} onChange=${(e) => set({ quality: +e.target.value })}>${[1, 2, 3, 4, 5].map((q) => html`<option value=${q} selected=${c.quality === q}>${QN[q]}</option>`)}</select></label>
      <label class="f" style="width:110px">Количество<input id="c-qty" type="number" min="1" value=${c.qty} onInput=${(e) => set({ qty: Math.max(1, parseInt(e.target.value, 10) || 1) })} /></label>
      <${Switch} checked=${c.after} onChange=${(v) => set({ after: v })} title="Считать чары как «плащ .0 + руны, души, реликты»">Чары после крафта</${Switch}>
    </div>
    ${family.length > 1 ? html`<div class="tiers-switch"><span class="pl">Тир</span>${family.map((i) => html`<button type="button" key=${i.id} class=${`tag t${i.tier} tierbtn ${i.id === c.itemId ? 'on' : ''}`} onClick=${() => pickItem(i.id, { enchant: Math.min(c.enchant, maxEnchant(i.id)) })}>T${i.tier}</button>`)}</div>` : null}
    ${!c.itemId ? html`<div class="card empty">Выбери предмет в поиске или открой его из скана — здесь появится расчёт: вердикт, закупка, продажа и сравнение по тирам.</div>` : null}
    ${c.error ? html`<div class="card err" role="alert">Ошибка: ${c.error}</div>` : null}
    ${c.itemId && !d && c.loading ? html`<div class="card empty"><${Spinner} />Считаю…</div>` : null}
    ${d ? html`<div class=${c.loading ? 'is-loading' : ''}>
      <div class="statusnote" style="margin:0 2px 10px;text-align:left" id="calc-source">${d.dataSource === 'aodp' ? 'Данные: AODP напрямую' : `Данные: краулер${d.jug && d.jug.lastPricePass ? ` · цены обновлены ${fmtAge((Date.now() - d.jug.lastPricePass) / 60000)}` : ''}`}${d.blackMarket ? ' · Чёрный Рынок — живым запросом (краулер его не собирает)' : ''}${c.loading ? ' · пересчитываю…' : ''}</div>
      <${Verdict} c=${c} d=${d} p=${p} st=${st} />
      <div class="subtabs" role="tablist">${subs.map(([id, t]) => html`<button type="button" role="tab" key=${id} aria-selected=${String(c.sub === id)} onClick=${() => set({ sub: id })}>${t}</button>`)}</div>
      ${c.sub === 'buy' ? html`<${BuyTab} c=${c} d=${d} lists=${lists} override=${override} invalidate=${invalidate} />` : html`<${SellTab} c=${c} d=${d} p=${p} st=${st} />`}</div>` : null}
  </section>`;
}
