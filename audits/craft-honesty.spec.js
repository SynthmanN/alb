// Аудит честности в браузере: полный цикл игрока — скан маржи → «в калькулятор» → план продажи по городам → правки плана.
// Запуск: npm run audit:craft:e2e. Главная проверка — итоговые цифры интерфейса должны совпадать с независимым пересчётом
// из того, что игрок видит в таблице (цены, количества), а не только «выглядеть правдоподобно».
const { test, expect } = require('@playwright/test');

const TAX = 0.08;
const FEE = 0.025;
const COST = 3600;

const calcPayload = (qty) => ({
  itemId: 'T4_MAIN_SWORD', enchant: 0, quality: 1, quantity: qty, marketShare: 0.5, setupFeeRate: FEE, rrrPreset: { id: 'none', label: 'Без бонусов', bonus: 0, rrr: 0 },
  cities: ['Lymhurst', 'Martlock', 'Thetford'], hasAllMaterialPrices: true, materialCostPerUnit: COST, effectiveCostPerUnit: COST, totalCost: COST * qty, recipe: [], sellPrices: [],
  bestSell: null, taxRate: TAX, netSellPrice: null, profitPerUnit: null, totalProfit: null, enchantAfterCraft: null, teleport: null,
  acquire: { days: 2, cycleDays: null, bottleneckResource: 'X', byResource: [] },
  patientSell: {
    days: 7, marketShare: 0.5, setupFee: FEE, avgSellPrice: 8000, bestCity: { city: 'Lymhurst', avgPrice: 8000 }, avgDailyVolume: 100, daysToSellBatch: 8, netSellPrice: 7160, profitPerUnit: 3560,
    byCity: [
      { city: 'Lymhurst', avgSellPrice: 8000, avgDailyVolume: 40, profitPerUnit: 8000 * (1 - TAX - FEE) - COST },
      { city: 'Martlock', avgSellPrice: 7000, avgDailyVolume: 30, profitPerUnit: 7000 * (1 - TAX - FEE) - COST },
      { city: 'Thetford', avgSellPrice: 4000, avgDailyVolume: 30, profitPerUnit: 4000 * (1 - TAX - FEE) - COST },
    ],
    cities: [],
    plan: { bestPrice: 8000, avgPrice: 7500, overpayPct: 0, totalDays: 8, cycleDays: 8, effectiveDays: 8, cappedByMinDays: false, positionCost: 500000, excluded: [{ city: 'Thetford', reason: 'вне допуска' }],
      cities: [{ city: 'Lymhurst', avgPrice: 8000, avgDailyVolume: 40, tolerance: 0.02, qty: qty * 4 / 7, days: 8 }, { city: 'Martlock', avgPrice: 7000, avgDailyVolume: 30, tolerance: 0.02, qty: qty * 3 / 7, days: 8 }] },
  },
});

// независимый пересчёт итогов из того, что видно в таблице плана
async function readPlan(page) {
  const rows = await page.locator('#craft-result .by-city tbody tr').all();
  const out = [];
  for (const r of rows) {
    const cells = await r.locator('td').allTextContents();
    const num = (t) => Number(t.replace(/[^\d.,-]/g, '').replace(/\s/g, '').replace(',', '.'));
    out.push({ city: cells[1].trim(), price: num(cells[2]), vol: num(cells[3]), qty: Number(await r.locator('input.plan-qty').inputValue()), on: await r.locator('input.plan-toggle').isChecked() });
  }
  return out;
}
const numOf = (t) => Number(t.replace(/[^\d.,-]/g, '').replace(/\s/g, '').replace(',', '.'));

test('цикл игрока: числа итога совпадают с независимым пересчётом при любых правках плана', async ({ page }) => {
  await page.route('**/api/unified-scan*', (route) => route.fulfill({ json: { mode: 'patient', includeMaterials: false, enchantMode: 'direct', liquidity: 'sum', days: 7, capital: 500000, minDays: 1, quantity: 700, marketShare: 0.5, taxRate: TAX, setupFeeRate: FEE, premiumPrice: 28000000, scanned: 1, enchantRange: '.0–.3', includeAwakened: false, rrrOptions: { royalBonus: false, focus: false },
    jug: { lastPricePass: Date.now(), lastHistoryPass: Date.now(), lastFullPass: Date.now(), oldestPriceAgeMinutes: 1 }, results: [
    { kind: 'gear', itemId: 'T4_MAIN_SWORD', enchant: 0, quality: 1, tier: 4, cost: COST, avgSellPrice: 7500, dailyVolume: 70, yourDailyVolume: 35, marketDailyVolume: 100, sellCities: ['Lymhurst', 'Martlock'], profitPerUnit: 3000, profitPct: 80, dailyProfit: 105000, premiumDays: 266, daysToAcquire: 1, daysToSell: 20, totalDays: 21, cycleDays: 21, effectiveDays: 21, cappedByMinDays: false, positionCost: 500000, quantity: 700, freshMinutes: 10, rankScore: 100000, tradeHours: 120, confidence: 120 / 140 }] } }));
  await page.route('**/api/craft-calc*', (route) => route.fulfill({ json: calcPayload(Number(new URL(route.request().url()).searchParams.get('quantity') || 700)) }));

  await page.goto('/craft-classic.html');
  await page.locator('details.tool-accordion summary', { hasText: 'Скан маржи и ликвидности' }).click();
  await page.locator('#margin-run').click();
  await page.locator('#margin-result .scan-add-btn').first().click();          // «выбрал находку и отправил в калькулятор»
  await page.locator('#craft-quantity').fill('700');
  await page.locator('#craft-run').click();
  await expect(page.locator('#craft-result .plan-summary')).toBeVisible();

  const check = async () => {
    const rows = await readPlan(page);
    const total = rows.filter((r) => r.on).reduce((s, r) => s + r.qty, 0);
    const profit = rows.filter((r) => r.on).reduce((s, r) => s + r.qty * (r.price * (1 - TAX - FEE) - COST), 0);
    const summary = await page.locator('#craft-result .plan-summary').innerText();
    expect(numOf(summary.match(/Распределено:\s*([\d\s]+)\s*из/)[1])).toBe(Math.round(total));
    const shown = summary.match(/итого:\s*(-?[\d\s]+)/)[1];
    expect(Math.abs(numOf(shown) - profit)).toBeLessThanOrEqual(Math.max(1, Math.abs(profit) * 1e-4));   // итог интерфейса = сумма qty × (цена после налога и сбора − себестоимость)
    // срок = максимум по включённым городам qty / (оборот × доля рынка)
    const days = Math.max(...rows.filter((r) => r.on && r.qty > 0).map((r) => r.qty / (r.vol * 0.5)));
    expect(summary).toContain(`Срок распродажи по плану: ${days.toFixed(1)} дн.`);
  };

  await check();                                                                // автоплан
  await page.locator('input.plan-toggle[data-city="Thetford"]').check();       // включили убыточный Thetford — итог обязан честно упасть
  await check();
  await page.locator('input.plan-toggle[data-city="Lymhurst"]').uncheck();     // выключили лучший город
  await check();
  await page.locator('input.plan-qty[data-city="Martlock"]').fill('100');      // ручная правка количества («конкурент перебил, продаю меньше»)
  await page.waitForTimeout(500);                                               // перерисовка плана отложена на ~250 мс
  await check();
  await page.locator('.plan-reset').click();
  await check();
});

test('убыточный город в плане: профит партии уменьшается, а не «сглаживается» средним', async ({ page }) => {
  await page.route('**/api/craft-calc*', (route) => route.fulfill({ json: calcPayload(700) }));
  await page.goto('/craft-classic.html');
  await page.locator('#craft-search').fill('палаш');
  await page.locator('#craft-suggestions .suggestion-item').first().click();
  await page.locator('#craft-run').click();
  const totalOf = async () => numOf((await page.locator('#craft-result .plan-summary').innerText()).match(/итого:\s*(-?[\d\s]+)/)[1]);
  const before = await totalOf();
  await page.locator('input.plan-toggle[data-city="Thetford"]').check();
  const after = await totalOf();
  expect(after).toBeLessThan(before);
});
