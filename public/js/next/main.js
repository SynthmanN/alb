import { html, render, itemsReady } from './lib.js';
import { App } from './app.js';

itemsReady.finally(() => {
  const root = document.getElementById('app');
  root.textContent = '';                    // убрать статическую заглушку «Загрузка…» из craft.html — иначе она остаётся в DOM рядом с приложением навсегда
  render(html`<${App} />`, root);
});
