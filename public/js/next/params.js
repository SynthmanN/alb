// Панель параметров: всегда на виду, всё правится на месте. Профиль → ставки возврата; рынок и история; города; «Ещё» — редкие настройки.
import { html, useStore, useState, MAIN_CITIES, OPTIONAL_CITIES, fmtAge, createStore } from './lib.js';
import { settings, setProfile, setRrr, toggleCity, PROFILES, activeCities } from './settings.js';
import { Switch, Icon, ICONS } from './ui.js';

// свежесть кувшина запоминают вкладки после ответов сервера
export const meta = createStore({ jugAt: null });

const SHARES = [[0.1, '10%'], [0.25, '25%'], [0.5, '50%'], [1, '100%']];
const HISTS = [[1, '1 день'], [3, '3 дня'], [7, '7 дней']];
const MHISTS = [[12, '12 ч'], [24, '24 ч'], [72, '3 дня'], [168, '7 дней'], [240, '10 дней']];

function Select({ id, label, value, options, onChange }) {
  return html`<div class="pg"><span class="pl">${label}</span>
    <select id=${id} value=${String(value)} onChange=${(e) => onChange(parseFloat(e.target.value))}>${options.map(([v, t]) => html`<option value=${String(v)} selected=${String(v) === String(value)}>${t}</option>`)}</select></div>`;
}

function RrrInput({ id, prefix, value, onChange, title }) {
  return html`<label title=${title}><span class="pfx">${prefix}</span>
    <input id=${id} type="number" min="0" max="95" step="0.1" value=${value} onInput=${(e) => onChange(e.target.value)} aria-label=${title} /><span class="sfx">%</span></label>`;
}

function CityToggle({ name, fixed, on }) {
  const cls = `city ${({ Lymhurst: 'lym', Martlock: 'mar', Thetford: 'the', Bridgewatch: 'bri', 'Fort Sterling': 'fst', Caerleon: 'cae', Brecilien: 'bre' })[name]} ${fixed ? 'fixed' : on ? '' : 'off'}`;
  return html`<button type="button" class=${cls} aria-pressed=${String(on)} tabindex=${fixed ? -1 : 0} title=${fixed ? 'Основной город — включён всегда' : on ? 'Выключить город' : 'Включить город'} onClick=${fixed ? null : () => toggleCity(name)}>${name}</button>`;
}

export function ParamsBar() {
  const s = useStore(settings);
  const m = useStore(meta);
  const [more, setMore] = useState(false);
  const status = s.source === 'jug'
    ? `Краулер · ${m.jugAt ? `цены обновлены ${fmtAge((Date.now() - m.jugAt) / 60000)}` : 'цены загружаются'}`
    : 'AODP напрямую · живой запрос';
  return html`<section class="card pbar" aria-label="Параметры расчёта">
    <div class="prow">
      <div class="pg"><span class="pl">Профиль</span>
        <div class="pseg" role="group" aria-label="Профиль">${Object.entries(PROFILES).map(([id, p]) => html`<button type="button" key=${id} aria-pressed=${String(s.profile === id)} title=${p.note} onClick=${() => setProfile(id)}>${p.name}</button>`)}</div></div>
      <div class="pg"><span class="pl">Возврат ресурсов</span>
        <div class="pin"><${RrrInput} id="rr-craft" prefix="Крафт" value=${s.rrrCraft} onChange=${(v) => setRrr('craft', v)} title="Возврат ресурсов при крафте гира, %" />
          <${RrrInput} id="rr-refine" prefix="Перераб." value=${s.rrrRefine} onChange=${(v) => setRrr('refine', v)} title="Возврат при переработке сырья, %" /></div></div>
      <${Select} id="share" label="Доля рынка" value=${s.share} options=${SHARES} onChange=${(v) => settings.set({ share: v })} />
      <${Select} id="hist" label="История гира" value=${s.hist} options=${HISTS} onChange=${(v) => settings.set({ hist: v })} />
      <${Select} id="mhist" label="История сырья" value=${s.mhist} options=${MHISTS} onChange=${(v) => settings.set({ mhist: v })} />
      <button type="button" class="more" aria-expanded=${String(more)} onClick=${() => setMore(!more)}>Ещё<${Icon} d=${ICONS.chevron} /></button>
    </div>
    <div class="pcities"><span class="pl">Города</span><span class="citylist" id="cities">
      ${MAIN_CITIES.map((c) => html`<${CityToggle} key=${c} name=${c} fixed=${true} on=${true} />`)}
      ${OPTIONAL_CITIES.map((c) => html`<${CityToggle} key=${c} name=${c} fixed=${false} on=${s.optional.includes(c)} />`)}</span></div>
    ${more ? html`<div class="adv" id="adv">
      <${Switch} checked=${s.blackMarket} onChange=${(v) => settings.set({ blackMarket: v })} title="Чёрный Рынок краулер не собирает — он идёт живым запросом">Учитывать Чёрный Рынок</${Switch}>
      <label class="f">Допуск цены закупки, %<input type="number" min="0" max="50" step="1" value=${s.tolerance} onInput=${(e) => settings.set({ tolerance: parseFloat(e.target.value) || 0 })} /></label>
    </div>` : null}
  </section>
  <div class="statusnote" id="status-note">${status} · налог ${s.premium ? 4 : 8}% · городов ${activeCities(s).length}</div>`;
}
