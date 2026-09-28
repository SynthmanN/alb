// Сводная закупка стека: одинаковые материалы включённых позиций просто складываются (с возвратом ресурсов); убрал позицию — её материалы уходят из списка.
// У каждого материала — где покупать, своя цена (или лог закупок по лотам, если он включён в параметрах) и панель «Все города»: каждый активный город, даже без данных, со своей ценой.
// Цены общие для калькулятора, листа и стека (prices.js): вписал здесь — пересчитались позиции и итоги.
import { html, useStore, useMemo, fmt, itemLabel, itemTier } from './lib.js';
import { drawerStore } from './nav.js';
import { prices, setCityOwn, pickCity } from './prices.js';
import { CityPriceList } from './citylist.js';
import { OwnPrice } from './calc-buy.js';
import { CityPill, MaterialName, Glyph, Tags } from './ui.js';
import { MyMaterials, Readiness, useInventory } from './inventory-ui.js';
import { allocateStack } from './logic/inventory.js';
import { mergeRows, withOverride, sortByCity } from './logic/acquire.js';
import { makeOverride } from './logic/adjust.js';
import { priceLists, SETUP_FEE } from './logic/cityPrices.js';

export function StackShopping({ data }) {
  const { checks } = useStore(drawerStore);
  const { items, results, prices: pr, cities, settings: s } = data;
  const active = items.filter((i) => i.on !== false && results.get(i.uid) && !results.get(i.uid).error);
  const lists = {};
  let fee = SETUP_FEE;
  for (const i of active) { const d = results.get(i.uid); fee = d.setupFeeRate ?? fee; for (const [k, v] of Object.entries(priceLists(d))) if (!lists[k] || (!lists[k].length && v.length)) lists[k] = v; }
  const m = makeOverride(lists, pr, { purchaseLog: s.purchaseLog, cities, fee });
  const have = useInventory();
  const alloc = useMemo(() => allocateStack(items, results, have, itemLabel), [items, results, have]);
  const raw = mergeRows(active.map((i) => alloc.byUid.get(i.uid).rows));
  const rows = sortByCity(raw.map((r) => ({ base: r, row: withOverride(r, m.override(r.key)) })), (x) => x.row);       // по городам: что купить здесь — подряд
  if (!rows.length) return null;
  const done = rows.filter(({ row }) => checks[row.id]).length;
  const total = rows.reduce((sum, { row }) => sum + (row.sum || 0), 0);
  const anyHave = Object.keys(have).length > 0;
  return html`<div id="shopping">
    <${MyMaterials} allocs=${[...alloc.byUid.values()]} nameOf=${itemLabel} />
    ${anyHave ? html`<div class="grouphead" style="margin-top:18px">Рецепты и наличие <span class="muted" style="text-transform:none;letter-spacing:0">· по порядку позиций</span></div>
      <div class="ready-list">${active.map((i) => html`<${Readiness} key=${i.uid} title=${itemLabel(i.itemId)} alloc=${alloc.byUid.get(i.uid)} head=${html`<${Glyph} id=${i.itemId} tier=${itemTier(i.itemId)} enchant=${i.enchant} quality=${i.quality} size=${40} /><${Tags} tier=${itemTier(i.itemId)} enchant=${i.enchant} quality=${i.quality} />`} />`)}</div>` : null}
    <div class="grouphead" style="margin-top:18px">Закупить для всех активных позиций <span class="muted" style="text-transform:none;letter-spacing:0">· куплено ${done} из ${rows.length}</span></div>
    <div class="shop-list">${rows.map(({ base, row: r }) => {
      const unit = base.toBuy > 0 && base.sum ? base.sum / base.toBuy : null;                    // рыночная цена за штуку — серая подсказка в поле своей цены
      return html`<div class=${`shop ${checks[r.id] ? 'done' : ''}`} key=${r.id} data-res=${r.key}>
        <div class="shop-l"><input type="checkbox" class="ck" checked=${!!checks[r.id]} onChange=${(e) => drawerStore.set({ checks: { ...checks, [r.id]: e.target.checked } })} aria-label=${`Куплено: ${r.name}`} />
          <div class="shop-body"><${MaterialName} id=${r.id} name=${r.name} />${r.manual ? html` <small class="is-manual-note">своя цена</small>` : null}
            <span class="shop-c">${r.have > 0 && r.toBuy === 0 ? html`<span class="pill g">хватает своих</span>` : r.cities.length ? r.cities.map((c) => html`<span key=${c.city}><${CityPill} name=${c.city} /> <small class="muted">${fmt(c.qty)} шт по ${fmt(c.price, c.price < 100 ? 1 : 0)}</small></span>`) : html`<span class="pill w">нет цены на рынке — впиши свою</span>`}${r.missing && r.cities.length ? html`<span class="pill w" title="У части позиций нет цены на рынке — впиши свою, и она закроет все позиции">у части позиций нет цены</span>` : null}</span>
            <div class="shop-own"><span class="muted">Своя цена за шт</span> <${OwnPrice} resKey=${r.key} market=${unit} needed=${r.toBuy ?? r.needed} scope="stack" /></div>
            <${CityPriceList} resKey=${r.key} list=${lists[r.key] || []} own=${pr.cityOwn[r.key]} fee=${fee} picked=${(pr.cityPick || {})[r.key]} onPick=${(city) => pickCity(r.key, city)} onSet=${(city, v) => setCityOwn(r.key, city, v)} />
          </div></div>
        <span class="shop-n"><b>${fmt(r.toBuy ?? r.needed)}</b> шт${r.have > 0 ? html`<br /><small class="muted">нужно ${fmt(r.needed)}, есть ${fmt(r.have)}</small>` : null}<br /><span class="neg">${r.sum === null || r.sum === undefined ? '—' : fmt(r.sum)}</span></span></div>`;
    })}</div>
    <div class="statusline" style="padding:10px 0 0;border:0">Итого докупить: <b class="neg">${fmt(total)}</b>. Складываются результаты по отдельно посчитанным позициям: общий оптимум по городам может быть чуть выгоднее. Свои цены общие для калькулятора, листа и стека.</div></div>`;
}
