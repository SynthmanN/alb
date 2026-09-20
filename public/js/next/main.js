import { html, render, itemsReady } from './lib.js';
import { App } from './app.js';

itemsReady.finally(() => render(html`<${App} />`, document.getElementById('app')));
