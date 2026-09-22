// Панель параметров: всегда на виду, всё правится на месте. Профиль → ставки возврата; рынок и история; города; «Ещё» — редкие настройки.
import { html, useStore, useState, MAIN_CITIES, OPTIONAL_CITIES, fmtAge, createStore } from './lib.js';
import { settings, setProfile, setRrr, toggleCity, PROFILES, activeCities } from './settings.js';
import { Switch, Icon, ICONS } from './ui.js';

// свежесть кувшина запоминают вкладки после ответов сервера
export const meta = createStore({ jugAt: null });

const SHARES = [[0.1, '10%'], [0.25, '25%'], [0.5, '50%'], [1, '100%']];
const HISTS = [[1, '1 день'], [3, '3 дня'], [7, '7 дней']];
const MHISTS = [[12, '12 ч'], [24, '24 ч'], [72, '3 дня'], [168, '7 дней'], [240, '10 дней']];

// Время вписывается С ЕДИНИЦЕЙ: «12ч» или «2д» — голое число не говорит, час это или день
const TIME_HINT = 'Укажи единицу: ч — часы, д — дни (например, 12ч или 2д)';
export function parseTimeToHours(text) {
  const m = String(text || '').trim().toLowerCase().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*(ч|час|часа|часов|h|д|дн|дня|дней|день|d)$/);
  if (!m) return null;
  return parseFloat(m[1]) * (/^(ч|h)/.test(m[2]) ? 1 : 24);
}
// kind: 'percent' (значение — доля 0.01–1), 'days' (значение — дни 1/24–30), 'hours' (значение — часы 1–240)
const CUSTOM = {
  percent: { hint: '1–100 %', parse: (t) => { const v = parseFloat(String(t).replace(',', '.')); return Number.isFinite(v) ? Math.min(Math.max(v, 1), 100) / 100 : null; }, show: (v) => String(Math.round(v * 1000) / 10), placeholder: '15' },
  days: { hint: TIME_HINT, parse: (t) => { const h = parseTimeToHours(t); return h === null ? null : Math.min(Math.max(h / 24, 1 / 24), 30); }, show: (v) => (v >= 1 ? `${Math.round(v * 100) / 100}д` : `${Math.round(v * 24)}ч`), placeholder: '12ч или 2д' },
  hours: { hint: TIME_HINT, parse: (t) => { const h = parseTimeToHours(t); return h === null ? null : Math.min(Math.max(h, 1), 240); }, show: (v) => (v >= 24 && v % 24 === 0 ? `${v / 24}д` : `${Math.round(v * 10) / 10}ч`), placeholder: '36ч или 2д' },
};
// Пресет + «Своё…» (текст с единицей: 12ч/2д — parseTimeToHours) — используется и в окне «Свежесть данных» (freshness.js), не только тут
export function Select({ id, label, value, options, onChange, kind }) {
  const isPreset = options.some(([v]) => String(v) === String(value));
  const [forced, setForced] = useState(false);
  const custom = forced || !isPreset;
  const c = CUSTOM[kind];
  const [text, setText] = useState(() => c.show(value));
  const [bad, setBad] = useState(false);
  return html`<div class="pg"><span class="pl">${label}</span><span class="selwrap">
    <select id=${id} value=${custom ? '__custom__' : String(value)} onChange=${(e) => { if (e.target.value === '__custom__') { setForced(true); setText(c.show(value)); } else { setForced(false); setBad(false); onChange(parseFloat(e.target.value)); } }}>
      ${options.map(([v, t]) => html`<option value=${String(v)} selected=${!custom && String(v) === String(value)}>${t}</option>`)}<option value="__custom__" selected=${custom}>Своё…</option></select>
    ${custom ? html`<input id=${`${id}-custom`} class=${`customval ${bad ? 'invalid' : ''}`} type="text" autocomplete="off" title=${c.hint} placeholder=${c.placeholder} value=${text} onInput=${(e) => { setText(e.target.value); const v = c.parse(e.target.value); if (v === null) setBad(true); else { setBad(false); onChange(v); } }} />` : null}</span></div>`;
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
      <${Select} id="share" label="Доля рынка" kind="percent" value=${s.share} options=${SHARES} onChange=${(v) => settings.set({ share: v })} />
      <${Select} id="hist" label="История гира" kind="days" value=${s.hist} options=${HISTS} onChange=${(v) => settings.set({ hist: v })} />
      <${Select} id="mhist" label="История сырья" kind="hours" value=${s.mhist} options=${MHISTS} onChange=${(v) => settings.set({ mhist: v })} />
      <button type="button" class="more" aria-expanded=${String(more)} onClick=${() => setMore(!more)}>Ещё<${Icon} d=${ICONS.chevron} /></button>
    </div>
    <div class="pcities"><span class="pl">Города</span><span class="citylist" id="cities">
      ${MAIN_CITIES.map((c) => html`<${CityToggle} key=${c} name=${c} fixed=${true} on=${true} />`)}
      ${OPTIONAL_CITIES.map((c) => html`<${CityToggle} key=${c} name=${c} fixed=${false} on=${s.optional.includes(c)} />`)}</span></div>
    ${more ? html`<div class="adv" id="adv">
      <${Switch} checked=${s.blackMarket} onChange=${(v) => settings.set({ blackMarket: v })} title="Показать цену Чёрного Рынка (свой налог: налог + Setup Fee всегда) в таблицах — вне расчёта, пока не включишь галочкой отдельно. Краулер его не собирает — он идёт живым запросом">Показывать Чёрный Рынок</${Switch}>
      <${Switch} checked=${s.teleport} onChange=${(v) => settings.set({ teleport: v })} title="Материалы покупаются в разных городах и едут в город сборки, готовый предмет — в город продажи: логистика по весу и дистанции">Учитывать телепорт</${Switch}>
      <${Switch} checked=${s.purchaseLog} onChange=${(v) => settings.set({ purchaseLog: v })} title="Купил сырьё стаками — впиши каждый стак (количество и цену за штуку): калькулятор посчитает среднюю цену и покажет, сколько ещё докупить">Лог закупок по лотам</${Switch}>
      <label class="f" title="Ценовой допуск плана закупки по городам, %">Допуск цены закупки, %<input id="tolerance" type="number" min="0" max="50" step="1" value=${s.tolerance} onInput=${(e) => settings.set({ tolerance: parseFloat(e.target.value) || 0 })} /></label>
      <label class="f" title="Sell Order: показать все города, где средняя цена не ниже порога, с суммарным спросом">Порог продажи<input id="sell-threshold" type="number" min="0" placeholder="нет" value=${s.sellThreshold} onInput=${(e) => settings.set({ sellThreshold: e.target.value })} /></label>
      <label class="f" title="Схема «закупаю по Buy Order, продаю партией»: проверить, укладывается ли себестоимость в потолок">Потолок себестоимости/шт<input id="ceiling" type="number" min="0" placeholder="без потолка" value=${s.ceiling} onInput=${(e) => settings.set({ ceiling: e.target.value })} /></label>
      <label class="f">Продажа от<input id="sell-low" type="number" min="0" placeholder="рынок" value=${s.sellLow} onInput=${(e) => settings.set({ sellLow: e.target.value })} /></label>
      <label class="f">Продажа до<input id="sell-high" type="number" min="0" placeholder="рынок" value=${s.sellHigh} onInput=${(e) => settings.set({ sellHigh: e.target.value })} /></label>
    </div>` : null}
  </section>
  <div class="statusnote" id="status-note">${status} · налог ${s.premium ? 4 : 8}% · городов ${activeCities(s).length}</div>`;
}
