// Общие помощники e2e-тестов.
const PAGES = ['index.html', 'scanners.html', 'craft.html', 'refine.html', 'fitting-room.html', 'masteries.html'];

// На узком экране навигация спрятана за гамбургером — раскрываем её, если он виден.
async function openNavIfCollapsed(page) {
  const toggle = page.locator('#nav-toggle');
  if (await toggle.isVisible()) {
    const links = page.locator('#nav-links');
    if (!(await links.isVisible())) await toggle.click();
  }
}

// Один шаг сортировки по колонке. Десктоп: клик по заголовку (1-й — по убыванию, 2-й — по возрастанию).
// Телефон (карточки): панель "Сортировка" — выбор колонки, а повторный шаг по той же колонке меняет направление.
async function sortBy(page, container, label) {
  const bar = page.locator(`${container} .mobile-sort`);
  if (await bar.isVisible()) {
    const select = bar.locator('select');
    if ((await select.inputValue()) === label) await bar.locator('button').click();
    else await select.selectOption(label);
  } else {
    await page.locator(`${container} thead th`, { hasText: label }).click();
  }
}

// Ответы API для сканеров: e2e проверяет интерфейс, а не внешний AODP, поэтому данные фиксированы.
const OPPORTUNITIES = [
  { itemId: 'T6_WOOD', bestBuy: { city: 'Thetford', price: 100 }, bestSell: { city: 'Lymhurst', price: 300 }, grossSellPrice: 300, taxRate: 0.08, spread: 176, spreadPct: 176, freshMinutes: 20, volume24h: 500, score: 900 },
  { itemId: 'T7_ORE', bestBuy: { city: 'Martlock', price: 200 }, bestSell: { city: 'Bridgewatch', price: 260 }, grossSellPrice: 260, taxRate: 0.08, spread: 39.2, spreadPct: 19.6, freshMinutes: 200, volume24h: 90, score: 60 },
  { itemId: 'T6_PLANKS', bestBuy: { city: 'Fort Sterling', price: 50 }, bestSell: { city: 'Thetford', price: 120 }, grossSellPrice: 120, taxRate: 0.08, spread: 60.4, spreadPct: 120.8, freshMinutes: 90, volume24h: 300, score: 400 },
];

module.exports = { PAGES, openNavIfCollapsed, sortBy, OPPORTUNITIES };
