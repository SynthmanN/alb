const { test, expect } = require('@playwright/test');

test('«Добавить всё по фильтру» на большом списке спрашивает подтверждение стилизованным диалогом, а не confirm()', async ({ page }) => {
  let nativeDialog = false;
  page.on('dialog', (d) => { nativeDialog = true; d.dismiss(); });
  await page.goto('/index.html');
  await page.locator('#category-filter').selectOption('weapon'); // сотни предметов — больше порога в 100
  await page.locator('#add-filtered').click();
  await expect(page.locator('.dialog')).toBeVisible();
  await expect(page.locator('.dialog')).toContainText('предметов в таблицу');
  await page.locator('.dialog-cancel').click();
  await expect(page.locator('.dialog')).toHaveCount(0);
  expect(nativeDialog).toBe(false);
});

test('ошибка сохранения уровня мастерок показывается уведомлением, а не считается успехом', async ({ page }) => {
  await page.route('**/api/masteries', (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 500, body: 'oops' }) : route.continue()));
  await page.goto('/masteries.html');
  await page.locator('#mastery-search').fill('клеймор');
  const input = page.locator('input[data-id="COMBAT_SWORDS_CLAYMORE"]');
  await input.fill('5');
  await input.dispatchEvent('change');
  await expect(page.locator('.toast-error')).toContainText('Уровень не сохранён');
  await expect(page.locator('#mastery-status')).toContainText('Ошибка сохранения');
});
