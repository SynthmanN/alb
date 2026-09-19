const { test, expect } = require('@playwright/test');

const scanPayload = (over = {}) => ({
  mode: 'patient', days: 7, quantity: 1000, minDays: 1, taxRate: 0.08, setupFeeRate: 0.025, premiumPrice: 28000000, scanned: 35,
  rrrOptions: { royalBonus: true, focus: false },
  jug: { lastPricePass: Date.now() - 60000, lastHistoryPass: Date.now() - 120000, lastFullPass: Date.now(), oldestPriceAgeMinutes: 1 },
  results: [
    { kind: 'material', itemId: 'T4_METALBAR', type: 'ORE', tier: 4, cost: 204, avgSellPrice: 260, sellCities: ['Martlock'], dailyVolume: 378799, profitPerUnit: 50, profitPct: 24.5,
      quantity: 1000, batchProfit: 50000, daysToAcquire: 0.0, daysToSell: 0.003, cycleDays: 0.003, effectiveDays: 1, cappedByMinDays: true, dailyProfit: 50000, premiumDays: 560,
      rawRrr: 0.367, prevRrr: 0.153, cityBonus: true, tradeHours: 150, confidence: 150 / 170, freshMinutes: 12, rankScore: 50000 },
    { kind: 'material', itemId: 'T5_PLANKS', type: 'WOOD', tier: 5, cost: 900, avgSellPrice: 1300, sellCities: ['Fort Sterling'], dailyVolume: 800, profitPerUnit: 250, profitPct: 28,
      quantity: 1000, batchProfit: 250000, daysToAcquire: 3, daysToSell: 1.4, cycleDays: 4.4, effectiveDays: 4.4, cappedByMinDays: false, dailyProfit: 56800, premiumDays: 490,
      rawRrr: 0.153, prevRrr: 0.153, cityBonus: false, tradeHours: 4, confidence: 4 / 24, freshMinutes: 30, rankScore: 56000 },
  ],
  ...over,
});

test('скан рефайна: живёт на странице «Рефайн», параметры (партия, минимум дней, возврат) уходят в запрос, доли рынка нет', async ({ page }) => {
  let scanQuery = null;
  await page.route('**/api/refine-scan*', (route) => { scanQuery = new URL(route.request().url()).searchParams; route.fulfill({ json: scanPayload() }); });
  await page.goto('/refine.html');
  await expect(page.locator('#refine-market-share')).toHaveCount(0);
  await page.locator('#refine-scan-quantity').fill('5000');
  await page.locator('#refine-scan-min-days').fill('2');
  await page.locator('#refine-scan-focus').check();
  await page.locator('#refine-scan-run').click();
  await expect(page.locator('#refine-scan-result tbody tr')).toHaveCount(2);
  expect(scanQuery.get('quantity')).toBe('5000');
  expect(scanQuery.get('minDays')).toBe('2');
  expect(scanQuery.get('focus')).toBe('true');
  expect(scanQuery.get('royalBonus')).toBe('true');
  expect(scanQuery.has('marketShare')).toBe(false);
  await expect(page.locator('#refine-scan-result')).toContainText('Партия 1');                 // «Партия 1 000 шт»
  await expect(page.locator('#refine-scan-result')).toContainText('(минимум)');               // потолок по дням виден в строке
  await expect(page.locator('#refine-scan-result .city-bonus')).toHaveCount(1);
});

test('скан рефайна: индекс доверия цветом (шаткая цифра — оранжевая), режим «мгновенно» меняет заголовки', async ({ page }) => {
  await page.route('**/api/refine-scan*', (route) => route.fulfill({ json: scanPayload(new URL(route.request().url()).searchParams.get('mode') === 'instant' ? { mode: 'instant', setupFeeRate: 0 } : {}) }));
  await page.goto('/refine.html');
  await page.locator('#refine-scan-run').click();
  const conf = page.locator('#refine-scan-result tbody tr td[title*="разных часах"]');
  await expect(conf.nth(0)).toHaveClass(/scan-spread-hot/);
  await expect(conf.nth(1)).toHaveClass(/scan-stale/);
  await expect(page.locator('#refine-scan-result thead')).toContainText('Ср. цена продажи');
  await page.locator('#refine-scan-mode').selectOption('instant');
  await page.locator('#refine-scan-run').click();
  await expect(page.locator('#refine-scan-result thead')).toContainText('Buy Order');
});

test('скан рефайна: «в калькулятор» переносит тип, тир и возврат в калькулятор рядом и считает на месте, без перезагрузки', async ({ page }) => {
  let calcQuery = null;
  await page.route('**/api/refine-scan*', (route) => route.fulfill({ json: scanPayload() }));
  await page.route('**/api/refining-calc*', (route) => { calcQuery = new URL(route.request().url()).searchParams; route.fulfill({ status: 404, json: { error: 'нет' } }); });
  await page.goto('/refine.html');
  await page.evaluate(() => { window.__marker = 'same-page'; });
  await page.locator('#refine-scan-focus').check();
  await page.locator('#refine-scan-run').click();
  await page.locator('#refine-scan-result .scan-add-btn').first().click();
  await expect.poll(() => calcQuery).not.toBeNull();
  expect(calcQuery.get('type')).toBe('ORE');
  expect(calcQuery.get('tier')).toBe('4');
  expect(calcQuery.get('focus')).toBe('true');
  expect(await page.evaluate(() => window.__marker)).toBe('same-page');                        // страница не перезагружалась
});

test('рефайн: калькулятор считает по выбранному типу и тиру', async ({ page }) => {
  let calcQuery = null;
  await page.route('**/api/refining-calc*', (route) => { calcQuery = new URL(route.request().url()).searchParams; route.fulfill({ status: 404, json: { error: 'нет' } }); });
  await page.goto('/refine.html');
  await page.locator('#calc-type').selectOption('FIBER');
  await page.locator('#calc-tier').selectOption('6');
  await page.locator('#calc-run').click();
  await expect.poll(() => calcQuery).not.toBeNull();
  expect(calcQuery.get('type')).toBe('FIBER');
  expect(calcQuery.get('tier')).toBe('6');
});

test('рефайн: переход с ?type=&tier= сразу подставляет и считает; посторонние параметры игнорируются', async ({ page }) => {
  let calcQuery = null;
  await page.route('**/api/refining-calc*', (route) => { calcQuery = new URL(route.request().url()).searchParams; route.fulfill({ status: 404, json: { error: 'нет' } }); });
  await page.goto('/refine.html?type=ORE&tier=5');
  await expect.poll(() => calcQuery).not.toBeNull();
  expect(calcQuery.get('type')).toBe('ORE');
  expect(calcQuery.get('tier')).toBe('5');
  calcQuery = null;
  await page.goto('/refine.html?type=DROP_TABLE&tier=99');
  await expect(page.locator('#calc-tier')).toHaveValue('5');
  await page.waitForTimeout(300);
  expect(calcQuery).toBeNull();
});
