const { test, expect } = require('@playwright/test');
const { sortBy, OPPORTUNITIES } = require('./helpers');

const spreadColumn = (page) => page.locator('#scan-result tbody tr td:nth-child(2)').allTextContents()
  .then((cells) => cells.map((t) => parseFloat(t.replace(/[^\d.,-]/g, '').replace(',', '.'))));

test('сканер флиппинга: сортировка по «Спред» меняет порядок строк', async ({ page }) => {
  await page.route('**/api/opportunities*', (route) => route.fulfill({ json: OPPORTUNITIES }));
  await page.goto('/scanners.html');
  await page.locator('#scan-run').click();
  await expect(page.locator('#scan-result tbody tr')).toHaveCount(3);

  await sortBy(page, '#scan-result', 'Спред');
  expect(await spreadColumn(page)).toEqual([176, 120.8, 19.6]); // 1-й клик — по убыванию

  await sortBy(page, '#scan-result', 'Спред');
  expect(await spreadColumn(page)).toEqual([19.6, 120.8, 176]); // 2-й — по возрастанию
});

test('сортировка по свежести идёт по числу минут, а не по тексту', async ({ page }) => {
  await page.route('**/api/opportunities*', (route) => route.fulfill({ json: OPPORTUNITIES }));
  await page.goto('/scanners.html');
  await page.locator('#scan-run').click();
  await expect(page.locator('#scan-result tbody tr')).toHaveCount(3);
  await sortBy(page, '#scan-result', 'Свежесть');
  const fresh = await page.locator('#scan-result tbody tr td:nth-child(6)').evaluateAll((tds) => tds.map((t) => Number(t.dataset.sortValue)));
  expect(fresh).toEqual([200, 90, 20]);
});

test('кнопка «+ добавить» из сканера кладёт предмет в список страницы «Цены»', async ({ page }) => {
  await page.route('**/api/opportunities*', (route) => route.fulfill({ json: OPPORTUNITIES }));
  await page.goto('/scanners.html');
  await page.locator('#scan-run').click();
  await expect(page.locator('#scan-result tbody tr')).toHaveCount(3);
  await page.locator('#scan-result .scan-add-btn').first().click();
  const tracked = await page.evaluate(() => JSON.parse(localStorage.getItem('albion_tracked_items')));
  expect(tracked).toContain('T6_WOOD');
  await page.goto('/index.html');
  await expect(page.locator('#table-body')).toContainText('Дерево');
});

test('сканер Чёрного рынка отправляет запрос только с выбранными городами (регрессия: раньше всегда тянул Brecilien)', async ({ page }) => {
  let url = null;
  await page.route('**/api/bm-opportunities*', (route) => { url = route.request().url(); route.fulfill({ json: [] }); });
  await page.goto('/scanners.html');
  await page.locator('#bm-scan-run').click();
  await expect.poll(() => url).not.toBeNull();
  const cities = () => new URL(url).searchParams.get('cities').split(',');
  expect(cities()).not.toContain('Brecilien');
  expect(cities()).toContain('Fort Sterling');

  url = null;
  await page.locator('#city-brecilien').check();
  await page.locator('#bm-scan-run').click();
  await expect.poll(() => url).not.toBeNull();
  expect(cities()).toContain('Brecilien');
});
