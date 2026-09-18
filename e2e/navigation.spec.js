const { test, expect } = require('@playwright/test');
const { PAGES, openNavIfCollapsed } = require('./helpers');

for (const p of PAGES) {
  test(`/${p} загружается без ошибок JS`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|render\.albiononline/.test(m.text())) errors.push(m.text()); });
    await page.goto(`/${p}`);
    await expect(page.locator('.site-nav')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });
}

test('навигация между страницами работает и подсвечивает активный пункт', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('.nav-links a.active')).toHaveText(/Цены/);
  await openNavIfCollapsed(page);
  await page.locator('.nav-links a', { hasText: 'Крафт' }).click();
  await expect(page).toHaveURL(/craft\.html/);
  await expect(page.locator('.nav-links a.active')).toHaveText(/Крафт/);
});

test('настройки (Premium/города) переживают переход между страницами', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#premium-toggle').check();
  await page.locator('#city-caerleon').check();
  await page.goto('/craft.html');
  await expect(page.locator('#premium-toggle')).toBeChecked();
  await expect(page.locator('#city-caerleon')).toBeChecked();
  await expect(page.locator('#city-brecilien')).not.toBeChecked();
});
