const { test, expect } = require('@playwright/test');

test('рефайн: доля рынка уходит в запрос скана, «в калькулятор» переносит тип и тир и считает', async ({ page }) => {
  let scanQuery = null;
  let calcQuery = null;
  await page.route('**/api/refining-opportunities*', (route) => {
    scanQuery = new URL(route.request().url()).searchParams;
    route.fulfill({ json: [{ itemId: 'T5_METALBAR', type: 'ORE', tier: 5, cost: 900, bestSell: { city: 'Martlock', price: 1300, date: '2026-01-01T00:00:00' }, taxRate: 0.08, profit: 296, profitPct: 32.9, freshMinutes: 20, volume: 400, yourVolume: 100, score: 120 }] });
  });
  await page.route('**/api/refining-calc*', (route) => { calcQuery = new URL(route.request().url()).searchParams; route.fulfill({ status: 404, json: { error: 'нет' } }); });
  await page.goto('/refine.html');
  await page.locator('#refine-market-share').selectOption('0.5');
  await page.locator('#refine-scan-run').click();
  await expect(page.locator('#refine-scan-result tbody tr')).toHaveCount(1);
  expect(scanQuery.get('marketShare')).toBe('0.5');
  await page.locator('#refine-scan-result .scan-add-btn').click();
  await expect.poll(() => calcQuery).not.toBeNull();
  expect(calcQuery.get('type')).toBe('ORE');
  expect(calcQuery.get('tier')).toBe('5');
});
