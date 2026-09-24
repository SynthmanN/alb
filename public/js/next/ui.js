// Общие компоненты: метки предмета (тир, зачарование, качество), значок предмета, города, переключатели, уведомления.
import { html, createStore, useStore, useState, QN, CITY_CLS, iconUrl, fmt, fmtDays, copyText } from './lib.js';
import { splitMaterialId, materialTitle, auctionSearchText } from './logic/material.js';

export const toastStore = createStore({ msg: '', id: 0 });
let toastTimer = null;
export function toast(msg) {
  toastStore.set({ msg, id: toastStore.get().id + 1 });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastStore.set({ msg: '' }), 2400);
}
export function Toast() {
  const { msg } = useStore(toastStore);
  return msg ? html`<div class="toast" role="status">${msg}</div>` : null;
}

// Тир, зачарование, качество — всегда цветные метки
export function Tags({ tier, enchant = 0, quality = 0 }) {
  return html`<span class="tags">
    ${tier ? html`<span class=${`tag t${tier}`}>T${tier}</span>` : null}
    ${enchant ? html`<span class=${`tag e e${enchant}`}>.${enchant}</span>` : null}
    ${quality ? html`<span class=${`tag q${quality}`}>${QN[quality]}</span>` : null}
  </span>`;
}

// Значок предмета из игры; пока не загрузился (или нет сети) — цветной знак тира
export function Glyph({ id, tier, enchant = 0, quality = 1, size = 64 }) {
  const [broken, setBroken] = useState(false);
  return html`<span class=${`glyph t${tier || 4} ${broken ? '' : 'hasimg'}`}>
    ${broken ? `T${tier}` : html`<img src=${iconUrl(id, size, enchant, quality)} alt="" loading="lazy" onError=${() => setBroken(true)} />`}
  </span>`;
}

// Материал закупки: значок из игры, название (клик копирует его для поиска на аукционе — вместе с [тир.зачарование],
// см. auctionSearchText, чтобы в игре не пришлось доводить зачарование руками) и цветные метки тира и зачарования.
// quality — необязательно: у материалов её нет (сайт всегда торгует ими по Обычному, метка не несла бы смысла), у самого
// предмета (окно «Свежесть данных», kind: 'self') — есть, и без неё через это окно неотличимы разные качества одного гира.
export function MaterialName({ id, name, quality = 0 }) {
  const { base, tier, enchant } = splitMaterialId(id, name);
  const doCopy = async () => {
    const text = auctionSearchText(id, name);
    toast((await copyText(text)) ? `Скопировано: ${text}` : 'Не удалось скопировать');
  };
  return html`<div class="item mat"><${Glyph} id=${base} tier=${tier} enchant=${enchant} quality=${quality || 1} size=${48} />
    <div><button type="button" class="namebtn" title="Скопировать для поиска на аукционе — с тиром и зачарованием, доводить руками не придётся" onClick=${doCopy}>${materialTitle(name)}</button>
      <div style="margin-top:3px"><${Tags} tier=${tier} enchant=${enchant} quality=${quality} /></div></div></div>`;
}

export function CityPill({ name }) {
  return html`<span class=${`city ${CITY_CLS[name] || ''}`}>${name}</span>`;
}
export function CityPills({ list, max = 3 }) {
  return html`<span class="citylist">${list.slice(0, max).map((c) => html`<${CityPill} key=${c} name=${c} />`)}${list.length > max ? html`<span class="muted" style="font-size:12px">+${list.length - max}</span>` : null}</span>`;
}

export function Seg({ options, value, onChange, label, cls = '' }) {
  return html`<div class=${`seg ${cls}`} role="group" aria-label=${label}>${options.map(([v, text]) => html`<button type="button" key=${v} aria-pressed=${String(value === v)} onClick=${() => onChange(v)}>${text}</button>`)}</div>`;
}
export function Switch({ checked, onChange, children, title }) {
  return html`<label class="switch" title=${title}><input type="checkbox" checked=${checked} onChange=${(e) => onChange(e.target.checked)} /> ${children}</label>`;
}
export const Icon = ({ d, size }) => html`<svg class="i" viewBox="0 0 24 24" style=${size ? `width:${size}px;height:${size}px` : ''} dangerouslySetInnerHTML=${{ __html: d }} />`;
export const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2M12 12h2M8 16h2M12 16h2"/>',
  shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>',
  couch: '<path d="M4 14h16M6 14V9a3 3 0 013-3h6a3 3 0 013 3v5M5 14v4M19 14v4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16m0 5v-5h5"/>',
};
export const Spinner = () => html`<span class="spin" aria-hidden="true"></span>`;

// Оборот плаща: «~1,3 шт/день · 8 шт ≈ 6 дн». info — результат logic/turnover.js → turnoverInfo; slow подсвечивается предупреждением
export function Turnover({ info, qty, short = false }) {
  if (!info || info.perDay === null) return html`<span class="turn none" title="Нет сделок за окно истории — оборот неизвестен">оборот неизвестен</span>`;
  const sell = info.days !== null && qty > 0 ? html` · ${fmt(qty)} шт ≈ <b>${fmtDays(info.days)}</b>` : null;
  return html`<span class=${`turn ${info.slow ? 'slow' : ''}`} title=${info.slow ? 'Рынок выкупит партию дольше окна истории — цена может просесть' : 'Сколько штук в день покупает рынок'}>оборот <b>${fmt(info.perDay, 1)}</b> шт/день${short ? null : sell}</span>`;
}
