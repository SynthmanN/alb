const { test, expect } = require('@playwright/test');

test.describe('Таблица → карточки на узком экране', () => {
  test('на десктопе шапка таблицы видна, панели сортировки нет', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/index.html');
    await expect(page.locator('#price-table thead')).toBeVisible();
    await expect(page.locator('.mobile-sort')).toBeHidden();
  });

  test('на 375px шапка скрыта, ячейки подписаны через ::before, есть панель сортировки', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto('/index.html');
    await expect(page.locator('#table-body tr').first()).toBeVisible();
    await expect(page.locator('#price-table thead')).toBeHidden();

    const row = page.locator('#table-body tr').first();
    // первая ячейка (название предмета) — заголовок карточки, без подписи; остальные подписаны по колонке
    const firstBefore = await row.locator('td').first().evaluate((el) => getComputedStyle(el, '::before').content);
    expect(firstBefore).toMatch(/none|normal/);
    const cell = row.locator('td').nth(1);
    expect(await cell.getAttribute('data-label')).toBeTruthy();
    const before = await cell.evaluate((el) => getComputedStyle(el, '::before').content);
    expect(before).not.toMatch(/none|normal/);

    await expect(page.locator('.mobile-sort')).toBeVisible();
  });

  test('на узком экране нет горизонтальной прокрутки страницы', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto('/index.html');
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('гамбургер-меню скрывает и показывает навигацию', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto('/index.html');
    await expect(page.locator('#nav-links')).toBeHidden();
    await page.locator('#nav-toggle').click();
    await expect(page.locator('#nav-links')).toBeVisible();
    await page.locator('#nav-toggle').click();
    await expect(page.locator('#nav-links')).toBeHidden();
  });
});
