// Новая страница «Крафт» (/craft-next.html): параметры, скан, калькулятор, крафт-лист. Ответы расчётов подменены, список предметов — настоящий.
const { test, expect } = require('@playwright/test');

const SCAN = { faction: null, mode: 'patient', enchantMode: 'after', taxRate: 0.08, setupFeeRate: 0.025, jug: { lastPricePass: Date.now() - 180000 }, results: [
  { kind: 'gear', itemId: 'T4_2H_BOW', enchant: 2, quality: 4, tier: 4, cost: 40000, avgSellPrice: 60000, sellCities: ['Martlock', 'Caerleon', 'Lymhurst'], dailyVolume: 12.5, profitPerUnit: 15200, profitPct: 38, marketProfitPerDay: 190000, freshMinutes: 12, confidence: 0.6 },
  { kind: 'gear', itemId: 'T4_CAPE', enchant: 1, quality: 4, tier: 4, cost: 2700, avgSellPrice: 22000, sellCities: ['Thetford'], dailyVolume: 300, profitPerUnit: 17000, profitPct: 600, marketProfitPerDay: 5100000, freshMinutes: 400, confidence: 0.9 },
] };

const calc = (q) => ({
  dataSource: q.get('source'), jug: q.get('source') === 'jug' ? { lastPricePass: Date.now() - 180000 } : null, names: { T4_RUNE: 'Руна (знаток)', T4_CLOTH: 'T4 Изысканная ткань' },
  itemId: q.get('item'), enchant: Number(q.get('enchant')), quality: Number(q.get('quality')), quantity: Number(q.get('quantity')), taxRate: 0.08, setupFeeRate: 0.025,
  rrrOptions: { gearRate: 0.248 }, rrrPreset: { rrr: 0.248 }, hasAllMaterialPrices: true, effectiveCostPerUnit: 1000, totalCost: 1000 * Number(q.get('quantity')),
  recipe: [
    { resource: 'T4_CLOTH', queryId: 'T4_CLOTH', materialSource: 'buy', neededToBuy: 20, cheapestPrice: 100, cheapestCity: 'Martlock', buyPrice: 100 },
    { resource: 'T4_RUNE', queryId: 'T4_RUNE', materialSource: 'buy', neededToBuy: 96, cheapestPrice: 5, cheapestCity: 'Lymhurst', buyPrice: 5 },
  ],
  acquire: { byResource: [] }, enchantAfterCraft: null, bestSell: { city: 'Martlock', price: 1500, taxRate: 0.08 }, netSellPrice: 1380, profitPerUnit: 380, sellPrices: [],
  patientSell: { avgSellPrice: 2500, netSellPrice: 2240, marketDailyVolume: 8, daysToSellBatch: 3, profitPerUnit: 1240, byCity: [{ city: 'Lymhurst', avgSellPrice: 2500, avgDailyVolume: 8, profitPerUnit: 1240 }, { city: 'Bridgewatch', avgSellPrice: null, avgDailyVolume: 0, profitPerUnit: null }], plan: { cities: [{ city: 'Lymhurst', qty: Number(q.get('quantity')), days: 3 }], totalDays: 3, profitPerUnit: 1240 } },
  qualityComparison: [], tierComparison: [{ itemId: 'T4_2H_BOW', tier: 4, hasPrice: true, cost: 1000, bestQuality: 4, bestSell: { city: 'Martlock', price: 1500 }, profitPerUnit: 380, patient: { profitPerUnit: 1240, profitPct: 124, avgDailyVolume: 8 }, isCurrent: true }],
});

async function mock(page, log) {
  await page.route('**/api/unified-scan*', (route) => { log.scan.push(new URL(route.request().url()).searchParams); route.fulfill({ json: SCAN }); });
  await page.route('**/api/craft-calc*', (route) => { const q = new URL(route.request().url()).searchParams; log.calc.push(q); route.fulfill({ json: calc(q) }); });
}

test('параметры: профиль выставляет возврат, правка возврата переводит в «Свой», все поля панели лежат в одной линии', async ({ page }, info) => {
  await page.goto('/craft-next.html');
  await expect(page.locator('#rr-craft')).toHaveValue('24.8');
  await page.getByRole('button', { name: 'Обычный' }).click();
  await expect(page.locator('#rr-craft')).toHaveValue('15.3');
  await expect(page.getByRole('button', { name: 'Обычный' })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#rr-craft').fill('30');
  await expect(page.getByRole('button', { name: 'Свой' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Бонус' }).click();
  await expect(page.locator('#rr-refine')).toHaveValue('36.7');
  if (info.project.name !== 'mobile') {                                                        // на телефоне поля переносятся по строкам — линия только на широком экране
    const centers = [];
    for (const sel of ['#rr-craft', '#rr-refine', '#share', '#hist', '#mhist']) {
      const box = await page.locator(sel).boundingBox();
      centers.push(box.y + box.height / 2);
    }
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(2);
  }
  await page.getByRole('button', { name: 'Ещё' }).click();
  await expect(page.locator('#adv')).toBeVisible();
  await page.locator('#cities .city', { hasText: 'Caerleon' }).click();
  await expect(page.locator('#status-note')).toContainText('городов 6');
});

test('скан → раскрыть строку → в крафт-лист → калькулятор; запрос несёт настройки панели', async ({ page }) => {
  const log = { scan: [], calc: [] };
  await mock(page, log);
  await page.goto('/craft-next.html');
  await page.getByRole('button', { name: 'Обычный' }).click();
  await page.locator('#scan-run').click();
  await expect(page.locator('#scan-rows .row')).toHaveCount(2);
  expect(log.scan[0].get('gearRrrCustom')).toBe('15.3');
  expect(log.scan[0].get('source')).toBe('jug');
  expect(log.scan[0].get('enchantMode')).toBe('after');
  await expect(page.locator('#scan-rows .row').first()).toContainText('5 100 000');                    // по умолчанию — по марже рынка в день
  await page.locator('#scan-rows .row').nth(1).click();
  await expect(page.locator('.detail')).toContainText('Свежесть цен');
  await page.locator('.detail .qty input').fill('5');
  await page.locator('.detail .btn.primary').click();
  await expect(page.locator('#dock-count')).toHaveText('1');
  await expect(page.locator('#dock-pr')).toContainText('+76 000');                                       // 5 шт × 15 200
  await page.locator('#open-list').click();
  await expect(page.locator('#drawer-list')).toContainText('Лук');
  await page.locator('#drawer-list .x').click();
  await expect(page.locator('#dock-count')).toHaveText('0');
  await page.getByRole('button', { name: 'Закрыть' }).click();                                  // строка осталась раскрытой
  await page.locator('.detail .btn', { hasText: 'Открыть в калькуляторе' }).click();
  await expect(page.locator('#verdict')).toContainText('Стоит крафтить');
  expect(log.calc[log.calc.length - 1].get('item')).toBe('T4_2H_BOW');
  expect(log.calc[log.calc.length - 1].get('enchant')).toBe('2');
  expect(log.calc[log.calc.length - 1].get('enchantAfterCraft')).toBe('true');
});

test('калькулятор: правильные названия материалов и копирование, продажа и тиры; источник данных пересчитывает на месте', async ({ page }) => {
  const log = { scan: [], calc: [] };
  await mock(page, log);
  await page.goto('/craft-next.html');
  await page.locator('[data-tab="calc"]').click();
  await page.locator('#c-search').fill('лук');
  await page.locator('.suggest button').first().click();
  await expect(page.locator('#verdict')).toBeVisible();
  await expect(page.locator('#calc-source')).toContainText('краулер');
  await expect(page.locator('#buy-table')).toContainText('Руна (знаток)');
  await expect(page.locator('#buy-table')).not.toContainText('T4_RUNE');
  await page.locator('#buy-table .namebtn', { hasText: 'Руна (знаток)' }).click();
  await expect(page.locator('.toast')).toContainText('Скопировано: Руна (знаток)');
  await page.getByRole('tab', { name: 'Продажа' }).click();
  await expect(page.locator('#city-table')).toContainText('Lymhurst');
  await expect(page.locator('#city-table')).toContainText('нет данных');
  await page.getByRole('tab', { name: 'Сравнение по тирам' }).click();
  await expect(page.locator('#sub-tiers')).toContainText('T4');
  const before = log.calc.length;
  await page.getByRole('button', { name: 'AODP' }).click();                                    // тумблер источника — пересчёт без «Посчитать»
  await expect.poll(() => log.calc.length).toBeGreaterThan(before);
  expect(log.calc[log.calc.length - 1].get('source')).toBe('aodp');
  await expect(page.locator('#calc-source')).toContainText('AODP напрямую');
  await page.locator('#c-qty').fill('25');
  await expect.poll(() => log.calc[log.calc.length - 1].get('quantity')).toBe('25');
});
