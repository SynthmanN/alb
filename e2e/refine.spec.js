const { test, expect } = require('@playwright/test');

// Ответ калькулятора: ORE T5 слиток (3 × руда + 1 × слиток T4), три компонента-города, продажа в двух городах + один без данных
const calcPayload = (over = {}) => ({
  itemId: 'T5_METALBAR', refinedId: 'T5_METALBAR', tier: 5, type: 'ORE', enchant: 0, ratio: { raw: 3, prevRefined: 1 }, hours: 24, taxRate: 0.08, setupFeeRate: 0.025,
  refineRate: 0.367, refineCity: 'Thetford', bonusCity: 'Thetford', jug: { lastPricePass: Date.now() },
  components: [
    { id: 'T5_ORE', role: 'raw', count: 3, buy: { city: 'Lymhurst', price: 100, cities: [{ city: 'Lymhurst', price: 100, dailyVolume: 5000, reliable: true }, { city: 'Thetford', price: 110, dailyVolume: 4000, reliable: true }, { city: 'Bridgewatch', price: 60, dailyVolume: 2, reliable: false }] } },
    { id: 'T4_METALBAR', role: 'prev', count: 1, buy: { city: 'Martlock', price: 200, cities: [{ city: 'Martlock', price: 200, dailyVolume: 900, reliable: true }] } },
  ],
  cost: (3 * 100 + 200) * (1 - 0.367), nominalCost: 500,
  sellByCity: [
    { city: 'Fort Sterling', avgPrice: 700, dailyVolume: 300, netSell: 626.5, profit: 626.5 - 316.5 },
    { city: 'Martlock', avgPrice: 650, dailyVolume: 500, netSell: 581.75, profit: 581.75 - 316.5 },
    { city: 'Lymhurst', avgPrice: null, dailyVolume: 0, netSell: null, profit: null, noData: true },
  ],
  best: { city: 'Fort Sterling', netSell: 626.5 },
  ...over,
});

test('калькулятор рефайна: пикер с иконками зачарований, город переработки, закупка под продажей, общая сумма; количество и ставка — на месте', async ({ page }) => {
  const queries = [];
  await page.route('**/api/refining-calc*', (route) => { queries.push(new URL(route.request().url()).searchParams); route.fulfill({ json: calcPayload() }); });
  await page.route('**/api/refine-scan*', (route) => route.fulfill({ json: { hours: 24, taxRate: 0.08, setupFeeRate: 0.025, refineRate: 0.367, results: [], scanned: 0, jug: {} } }));
  await page.goto('/refine.html');
  await expect(page.locator('#refine-picker .pk-btn').first()).toBeVisible();
  await expect(page.locator('#refine-picker .pk-btn.pk-ench').first()).toBeVisible();          // рядом с .0 — кнопки-иконки зачарований
  await expect(page.locator('#refine-picker details.pk-plain')).toContainText('Без зачарования');   // T2–T3 и камень — в одном свёрнутом блоке
  await page.locator('#refine-picker .pk-btn[data-type="ORE"][data-tier="5"][data-enchant="2"]').click();
  await expect.poll(() => queries.length).toBeGreaterThan(1);
  const last = queries[queries.length - 1];
  expect(last.get('type')).toBe('ORE');
  expect(last.get('tier')).toBe('5');
  expect(last.get('enchant')).toBe('2');
  expect(last.get('hours')).toBe('24');                                                           // окно по умолчанию — 24 ч
  const n = queries.length;
  await expect(page.locator('#calc-result')).toContainText('Рефайнить в Thetford');
  // порядок на странице: описание города → продажа → закупка
  const html = await page.locator('#calc-result').innerHTML();
  expect(html.indexOf('Рефайнить в')).toBeLessThan(html.indexOf('refine-sell-table'));
  expect(html.indexOf('refine-sell-table')).toBeLessThan(html.indexOf('refine-buy-table'));
  await expect(page.locator('#calc-result .sb-cost')).toContainText('316');                     // себестоимость штуки после переработки: 500 × (1 − 36.7%)
  await expect(page.locator('#refine-buy-table tfoot')).toContainText('Общая сумма закупки');
  await expect(page.locator('#refine-buy-table tfoot')).toContainText('400');                     // партия 1 шт: ceil(3 × 0.633) = 2 руды × 100 + ceil(0.633) = 1 слиток × 200
  await page.locator('#calc-quantity').fill('100');
  await expect(page.locator('#refine-buy-table')).toContainText('190');                           // ceil(100 × 3 × 0.633) = 190 руды
  await expect(page.locator('#refine-buy-table')).toContainText('64');                            // ceil(100 × 1 × 0.633) = 64 слитка
  await expect(page.locator('#refine-buy-table tfoot')).toContainText('31 800');                  // 190 × 100 + 64 × 200
  await page.locator('#calc-rrr').selectOption('none');                                          // без возврата: 300 руды, 100 слитков
  await expect(page.locator('#refine-buy-table')).toContainText('300');
  expect(queries.length).toBe(n);                                                                 // количество и ставка — без запроса
});

test('калькулятор рефайна: своя цена закупки и своя цена продажи по городу пересчитывают себестоимость и профит на месте; в городе без данных цену вписать можно', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/refining-calc*', (route) => { requests++; route.fulfill({ json: calcPayload() }); });
  await page.goto('/refine.html');
  await expect(page.locator('#calc-result .sb-cost')).toContainText('316');
  const before = requests;
  await page.locator('#refine-buy-table input.own-buy[data-id="T5_ORE"]').fill('50');            // руда в игре по 50: (3 × 50 + 200) × (1 − 36.7%) = 221,5
  await expect(page.locator('#calc-result .sb-cost')).toContainText('222');
  await expect(page.locator('#refine-sell-table')).toContainText('Lymhurst');                     // город без данных виден
  await expect(page.locator('#refine-sell-table tr', { hasText: 'Lymhurst' })).toContainText('нет данных');
  await page.locator('#refine-sell-table input.own-sell[data-city="Lymhurst"]').fill('800');       // в Lymhurst видишь 800 чистыми — он лучший
  await expect(page.locator('#calc-result .sb-cell').nth(1)).toContainText('Lymhurst');
  await expect(page.locator('#calc-result .sb-cell').nth(2)).toContainText('578');               // 800 − 221,5
  expect(requests).toBe(before);                                                                  // всё — на месте, без запроса
  await page.locator('#refine-own-reset').click();
  await expect(page.locator('#calc-result .sb-cost')).toContainText('316');
});

test('скан рефайна: все типы и тиры по умолчанию, возврат 36.7% и окно 24ч, свой % и «10ч» уходят в запрос; зачарованные — по галочке; «в калькулятор» переносит и зачарование', async ({ page }) => {
  let scanQuery = null;
  const calcQueries = [];
  await page.route('**/api/refine-scan*', (route) => {
    scanQuery = new URL(route.request().url()).searchParams;
    route.fulfill({ json: { hours: 24, taxRate: 0.08, setupFeeRate: 0.025, refineRate: 0.367, minDaily: 1, enchanted: true, scanned: 40, jug: { lastPricePass: Date.now() }, results: [
      { itemId: 'T5_METALBAR_LEVEL2@2', type: 'ORE', tier: 5, enchant: 2, cost: 316.5, avgSellPrice: 700, netSell: 626.5, profitPerUnit: 310, profitPct: 98, sellCity: 'Fort Sterling', dailyVolume: 300, totalDailyVolume: 800,
        rawCity: 'Lymhurst', prevCity: 'Martlock', refineCity: 'Thetford', tradeHours: 6, confidence: 0.23, freshMinutes: 12, rankScore: 900 },
    ] } });
  });
  await page.route('**/api/refining-calc*', (route) => { calcQueries.push(new URL(route.request().url()).searchParams); route.fulfill({ json: calcPayload() }); });
  await page.goto('/refine.html');
  await page.locator('#refine-scan-run').click();
  await expect(page.locator('#refine-scan-result tbody tr')).toHaveCount(1);
  expect(scanQuery.get('refineRrr')).toBe('city_bonus');                                          // возврат по умолчанию — 36.7%
  expect(scanQuery.get('hours')).toBe('24');
  expect(scanQuery.get('enchanted')).toBe('false');
  expect(scanQuery.has('type')).toBe(false);                                                      // по умолчанию — все типы и тиры
  await page.locator('#refine-scan-rrr').selectOption('custom');
  await page.locator('#refine-scan-rrr-custom').fill('45');
  await page.locator('#refine-scan-hours').selectOption('__custom__');
  await page.locator('#refine-scan-hours + .custom-value input').fill('10ч');
  await page.locator('#refine-scan-enchanted').check();
  await page.locator('#refine-scan-run').click();
  await expect.poll(() => scanQuery.get('refineRrrCustom')).toBe('45');
  expect(scanQuery.get('hours')).toBe('10');
  expect(scanQuery.get('enchanted')).toBe('true');
  await expect(page.locator('#refine-scan-result tbody tr').first()).toContainText('Thetford');   // где перерабатывать
  await expect(page.locator('#refine-scan-result')).toContainText('Свежесть');
  await page.locator('#refine-scan-result .scan-add-btn').first().click();
  await expect.poll(() => calcQueries[calcQueries.length - 1].get('enchant')).toBe('2');           // зачарование переехало в калькулятор
  await expect(page.locator('#refine-picker .pk-btn.active')).toHaveAttribute('data-enchant', '2');
});

test('рефайн: переход с ?type=&tier=&enchant= сразу подставляет и считает; камень не зачаровывается — лишнее игнорируется', async ({ page }) => {
  const calcQueries = [];
  await page.route('**/api/refining-calc*', (route) => { calcQueries.push(new URL(route.request().url()).searchParams); route.fulfill({ json: calcPayload() }); });
  await page.goto('/refine.html?type=FIBER&tier=6&enchant=1&junk=1');
  await expect.poll(() => calcQueries.length).toBeGreaterThan(0);
  expect(calcQueries[0].get('type')).toBe('FIBER');
  expect(calcQueries[0].get('tier')).toBe('6');
  expect(calcQueries[0].get('enchant')).toBe('1');
  expect(calcQueries[0].has('junk')).toBe(false);
  await page.goto('/refine.html?type=ROCK&tier=5&enchant=2');
  await expect.poll(() => calcQueries[calcQueries.length - 1].get('type')).toBe('ORE');           // недопустимая комбинация — умолчание (руда T5)
});
