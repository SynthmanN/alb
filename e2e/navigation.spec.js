const { test, expect } = require('@playwright/test');
const { PAGES, openNavIfCollapsed } = require('./helpers');
PAGES.push('craft-classic.html');

for (const p of PAGES.filter((x) => x !== 'craft.html')) {
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
  await expect(page.locator('.nav a.on')).toHaveText(/Крафт/);              // новая страница «Крафт» со своей шапкой
});

test('настройки (Premium/города) переживают переход между страницами', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#premium-toggle').check();
  await page.locator('#city-caerleon').check();
  await page.goto('/craft-classic.html');
  await expect(page.locator('#premium-toggle')).toBeChecked();
  await expect(page.locator('#city-caerleon')).toBeChecked();
  await expect(page.locator('#city-brecilien')).not.toBeChecked();
  await page.goto('/craft.html');                                              // и новая страница «Крафт» читает те же настройки
  await expect(page.locator('.switch', { hasText: 'Премиум' }).locator('input')).toBeChecked();
  await expect(page.locator('#cities .city', { hasText: 'Caerleon' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#cities .city', { hasText: 'Brecilien' })).toHaveAttribute('aria-pressed', 'false');
});
