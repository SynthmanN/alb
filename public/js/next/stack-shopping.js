// Сводная закупка стека: одинаковые материалы позиций складываются. У каждого материала — для каких позиций и сколько, где покупать,
// своя цена (или лог закупок по лотам, если он включён в параметрах) и панель «Все города»: каждый активный город, даже без данных, со своей ценой.
// Цены общие для калькулятора, листа и стека (prices.js): вписал здесь — пересчитались позиции и итоги.
import { html, useStore, fmt, itemLabel, itemTier, copyText, auctionName } from './lib.js';
import { drawerStore } from './nav.js';
import { prices, setCityOwn } from './prices.js';
import { CityPriceList } from './citylist.js';
import { OwnPrice } from './calc-buy.js';
import { CityPill, Tags, toast } from './ui.js';
import { acquisitionRows, mergeRows, withOverride } from './logic/acquire.js';
import { makeOverride } from './logic/adjust.js';
import { priceLists, SETUP_FEE } from './logic/cityPrices.js';

const dedupe = (uses) => {
  const m = new Map();
  for (const u of uses) {
    const k = `${u.owner.uid}|${u.why}`;
    const cur = m.get(k) || { ...u, needed: 0 };
    cur.needed += u.needed;
    m.set(k, cur);
  }
  return [...m.values()];
};

// «Нужно для»: каждая позиция стека отдельной строкой — название, метки, сколько штук; почему материал нужен — под названием
function Uses({ uses }) {
  if (!uses.length) return null;
  return html`<div class="shop-uses" aria-label="Для каких позиций"><span class="pl">Нужно для</span>${dedupe(uses).map((u) => html`<div class="use-row" key=${u.owner.uid + u.why}>
    <div class="use-main"><b class="use-name">${itemLabel(u.owner.itemId)}</b><${Tags} tier=${itemTier(u.owner.itemId)} enchant=${u.owner.enchant} quality=${u.owner.quality} /></div>
    <div class="use-qty"><b>${fmt(u.needed)}</b> шт</div>
    ${u.why ? html`<div class="use-why muted">${u.why}</div>` : null}</div>`)}</div>`;
}

export function StackShopping({ data }) {
  const { checks } = useStore(drawerStore);
  const { items, results, prices: pr, cities, settings: s } = data;
  const active = items.filter((i) => i.on !== false && results.get(i.uid) && !results.get(i.uid).error);
  const lists = {};
  let fee = SETUP_FEE;
  for (const i of active) { const d = results.get(i.uid); fee = d.setupFeeRate ?? fee; for (const [k, v] of Object.entries(priceLists(d))) if (!lists[k] || (!lists[k].length && v.length)) lists[k] = v; }
  const m = makeOverride(lists, pr, { purchaseLog: s.purchaseLog, cities, fee });
  const raw = mergeRows(active.map((i) => acquisitionRows(results.get(i.uid), itemLabel)), active.map((i) => ({ uid: i.uid, itemId: i.itemId, enchant: i.enchant, quality: i.quality })));
  const rows = raw.map((r) => ({ base: r, row: withOverride(r, m.override(r.key)) }));
  if (!rows.length) return null;
  const done = rows.filter(({ row }) => checks[row.id]).length;
  const total = rows.reduce((sum, { row }) => sum + (row.sum || 0), 0);
  const copy = async (r) => toast((await copyText(auctionName(r.name))) ? `Скопировано: ${auctionName(r.name)}` : 'Не удалось скопировать');
  return html`<div id="shopping"><div class="grouphead">Закупить для всех активных позиций <span class="muted" style="text-transform:none;letter-spacing:0">· куплено ${done} из ${rows.length}</span></div>
    <div class="shop-list">${rows.map(({ base, row: r }) => {
      const unit = base.needed > 0 && base.sum ? base.sum / base.needed : null;                    // рыночная цена за штуку — серая подсказка в поле своей цены
      return html`<div class=${`shop ${checks[r.id] ? 'done' : ''}`} key=${r.id} data-res=${r.key}>
        <div class="shop-l"><input type="checkbox" class="ck" checked=${!!checks[r.id]} onChange=${(e) => drawerStore.set({ checks: { ...checks, [r.id]: e.target.checked } })} aria-label=${`Куплено: ${r.name}`} />
          <div class="shop-body"><button type="button" class="namebtn" title="Скопировать название для поиска на аукционе" onClick=${() => copy(r)}>${r.name}</button>${r.manual ? html` <small class="is-manual-note">своя цена</small>` : null}
            <${Uses} uses=${r.uses || []} />
            <span class="shop-c">${r.cities.length ? r.cities.map((c) => html`<span key=${c.city}><${CityPill} name=${c.city} /> <small class="muted">${fmt(c.qty)} шт по ${fmt(c.price, c.price < 100 ? 1 : 0)}</small></span>`) : html`<span class="pill w">нет цены на рынке — впиши свою</span>`}${r.missing && r.cities.length ? html`<span class="pill w" title="У части позиций нет цены на рынке — впиши свою, и она закроет все позиции">у части позиций нет цены</span>` : null}</span>
            <div class="shop-own"><span class="muted">Своя цена за шт</span> <${OwnPrice} resKey=${r.key} market=${unit} needed=${r.needed} scope="stack" /></div>
            <${CityPriceList} resKey=${r.key} list=${lists[r.key] || []} own=${pr.cityOwn[r.key]} fee=${fee} onSet=${(city, v) => setCityOwn(r.key, city, v)} />
          </div></div>
        <span class="shop-n"><b>${fmt(r.needed)}</b> шт<br /><span class="neg">${r.sum === null || r.sum === undefined ? '—' : fmt(r.sum)}</span></span></div>`;
    })}</div>
    <div class="statusline" style="padding:10px 0 0;border:0">Итого на закупку: <b class="neg">${fmt(total)}</b>. Складываются результаты по отдельно посчитанным позициям: общий оптимум по городам может быть чуть выгоднее. Свои цены общие для калькулятора, листа и стека.</div></div>`;
}
