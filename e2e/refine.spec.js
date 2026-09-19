const { test, expect } = require('@playwright/test');

test('рефайн: калькулятор считает по выбранному типу и тиру (скан переехал в общий скан на «Крафте»)', async ({ page }) => {
  let calcQuery = null;
  await page.route('**/api/refining-calc*', (route) => { calcQuery = new URL(route.request().url()).searchParams; route.fulfill({ status: 404, json: { error: 'нет' } }); });
  await page.goto('/refine.html');
  await expect(page.locator('#refine-scan-run')).toHaveCount(0);
  await page.locator('#calc-type').selectOption('FIBER');
  await page.locator('#calc-tier').selectOption('6');
  await page.locator('#calc-run').click();
  await expect.poll(() => calcQuery).not.toBeNull();
  expect(calcQuery.get('type')).toBe('FIBER');
  expect(calcQuery.get('tier')).toBe('6');
});

test('рефайн: переход с ?type=&tier= (кнопка «в калькулятор» из объединённого скана) сразу подставляет и считает', async ({ page }) => {
  let calcQuery = null;
  await page.route('**/api/refining-calc*', (route) => { calcQuery = new URL(route.request().url()).searchParams; route.fulfill({ status: 404, json: { error: 'нет' } }); });
  await page.goto('/refine.html?type=ORE&tier=5');
  await expect.poll(() => calcQuery).not.toBeNull();
  expect(calcQuery.get('type')).toBe('ORE');
  expect(calcQuery.get('tier')).toBe('5');
  await expect(page.locator('#calc-type')).toHaveValue('ORE');
  await expect(page.locator('#calc-tier')).toHaveValue('5');
});

test('рефайн: посторонние параметры в адресе игнорируются, ничего не считается само', async ({ page }) => {
  let called = false;
  await page.route('**/api/refining-calc*', (route) => { called = true; route.fulfill({ status: 404, json: { error: 'нет' } }); });
  await page.goto('/refine.html?type=DROP_TABLE&tier=99');
  await expect(page.locator('#calc-tier')).toHaveValue('5');
  await page.waitForTimeout(300);
  expect(called).toBe(false);
});
