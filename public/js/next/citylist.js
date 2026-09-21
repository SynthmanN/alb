// Панель «Все города» материала: рынки со всеми ценами, у каждого поле для своей цены (серым — рыночная). Лучший город подсвечен.
// Один компонент на калькулятор и крафт-лист: цены и правки приходят снаружи (list — рыночные цены, own — свои, onSet — правка).
import { html, useStore, fmt } from './lib.js';
import { settings, activeCities, ALL_CITIES } from './settings.js';
import { CityPill } from './ui.js';
import { cityRows, SETUP_FEE } from './logic/cityPrices.js';

const ph = (p) => (p === null || p === undefined ? 'своя цена' : String(Math.round(p * (p < 100 ? 10 : 1)) / (p < 100 ? 10 : 1)));

export function CityPriceList({ resKey, list, own, onSet, fee = SETUP_FEE, label = 'Все города' }) {
  const s = useStore(settings);
  const rows = cityRows(list, own, activeCities(s), fee, ALL_CITIES);
  if (!rows.length) return null;
  const mine = Object.keys(own || {}).length;
  return html`<details class="cityprices" data-res=${resKey}>
    <summary><span>${label}</span><span class="cp-count">${rows.filter((r) => r.market !== null).length}${mine ? html` · <b>своих ${mine}</b>` : null}</span></summary>
    <div class="cp-list" role="table" aria-label=${`Цены по городам: ${resKey}`}>
      ${rows.map((r) => html`<div class=${`cp-row ${r.isBest ? 'is-best' : ''} ${r.inactive ? 'is-inactive' : ''}`} role="row" key=${r.city}>
        <${CityPill} name=${r.city} />${r.inactive ? html`<small class="cp-off" title="Город вне расчёта: цена для справки. Впиши свою цену — город войдёт в расчёт; или включи город в параметрах">вне расчёта</small>` : null}
        <span class="cp-price" role="cell">${r.market === null ? html`<span class="muted">нет цены</span>` : fmt(r.market, r.market < 100 ? 1 : 0)}${r.isBest ? html` <span class="cp-best" title="Самая выгодная закупка с учётом комиссии 2.5% и твоих цен">лучший</span>` : null}</span>
        <input type="number" min="0" step="1" data-city=${r.city} class=${r.own !== undefined ? 'is-manual' : ''} placeholder=${ph(r.market)} value=${r.own ?? ''} onInput=${(e) => onSet(r.city, e.target.value)} aria-label=${`Своя цена в ${r.city}`} title="Серым — рыночная цена. Видишь в игре другую или платишь иначе — впиши свою: выбор города и себестоимость пересчитаются сразу" />
      </div>`)}
      <p class="cp-note">Рыночные цены без комиссии; для сравнения к ним добавляется 2.5% за свой Buy Order, а своя цена считается как есть. Города «вне расчёта» показаны для справки: впиши в них свою цену или включи город в параметрах — и он войдёт в выбор.</p>
    </div></details>`;
}
