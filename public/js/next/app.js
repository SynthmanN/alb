// Каркас страницы: верхняя панель, параметры, вкладки инструментов, док крафт-листа.
import { html, useStore, useEffect } from './lib.js';
import { settings } from './settings.js';
import { navStore, nav } from './nav.js';
import { ParamsBar } from './params.js';
import { Icon, ICONS, Toast, Seg, Switch } from './ui.js';
import { ScanTab } from './scan.js';
import { CalcTab } from './calc.js';
import { FactionTab } from './faction.js';
import { LazyTab } from './lazy.js';
import { Dock, ListDrawer, drawerStore } from './dock.js';

const TABS = [['scan', 'Скан', ICONS.search], ['calc', 'Калькулятор', ICONS.calc], ['faction', 'Фракционный план', ICONS.shield], ['lazy', 'Ленивый', ICONS.couch]];
const PAGES = [['index.html', 'Цены'], ['scanners.html', 'Флиппинг'], ['craft-next.html', 'Крафт', true], ['refine.html', 'Рефайн'], ['fitting-room.html', 'Примерочная'], ['masteries.html', 'Мастерки']];

export function App() {
  const { tab } = useStore(navStore);
  const s = useStore(settings);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') drawerStore.set({ open: false }); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return html`<div>
    <header class="top">
      <div class="brand"><b>A</b> Albion Market Table</div>
      <nav class="nav" aria-label="Разделы">${PAGES.map(([href, label, on]) => html`<a href=${href} class=${on ? 'on' : ''} key=${href}>${label}</a>`)}</nav>
      <span class="sp"></span>
      <${Seg} label="Источник данных" value=${s.source} onChange=${(v) => settings.set({ source: v })} options=${[['jug', 'Краулер'], ['aodp', 'AODP']]} cls="src" />
      <${Switch} checked=${s.premium} onChange=${(v) => settings.set({ premium: v })} title="Налог с продажи 4% вместо 8%">Премиум</${Switch}>
    </header>
    <div class="layout"><div class="wrap">
      <${ParamsBar} />
      <div class="tabs"><div class="seg" role="tablist">${TABS.map(([id, label, icon]) => html`<button type="button" role="tab" key=${id} data-tab=${id} aria-selected=${String(tab === id)} onClick=${() => nav.tab(id)}><${Icon} d=${icon} />${label}</button>`)}</div></div>
      ${tab === 'scan' ? html`<${ScanTab} />` : tab === 'calc' ? html`<${CalcTab} />` : tab === 'faction' ? html`<${FactionTab} />` : html`<${LazyTab} />`}
    </div></div>
    <${Dock} /><${ListDrawer} /><${Toast} />
  </div>`;
}
