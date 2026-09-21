// Страница «Крафт» (/craft.html, новая): параметры, скан, калькулятор, крафт-лист, фракционный план, ленивый крафтер. Ответы расчётов подменены, список предметов — настоящий. Прежняя версия — /craft-classic.html (e2e/craft-and-masteries.spec.js).
const { test, expect } = require('@playwright/test');

const SCAN = { faction: null, mode: 'patient', enchantMode: 'after', taxRate: 0.08, setupFeeRate: 0.025, jug: { lastPricePass: Date.now() - 180000 }, results: [
  { kind: 'gear', itemId: 'T4_2H_BOW', enchant: 2, quality: 4, tier: 4, cost: 40000, avgSellPrice: 60000, sellCities: ['Martlock', 'Caerleon', 'Lymhurst'], dailyVolume: 12.5, profitPerUnit: 15200, profitPct: 38, marketProfitPerDay: 190000, freshMinutes: 12, confidence: 0.6 },
  { kind: 'gear', itemId: 'T4_CAPE', enchant: 1, quality: 4, tier: 4, cost: 2700, avgSellPrice: 22000, sellCities: ['Thetford'], dailyVolume: 300, profitPerUnit: 17000, profitPct: 600, marketProfitPerDay: 5100000, freshMinutes: 400, confidence: 0.9 },
] };

const calc = (q) => ({
  dataSource: q.get('source'), jug: q.get('source') === 'jug' ? { lastPricePass: Date.now() - 180000 } : null, names: { T4_RUNE: 'Руна (знаток)', T4_CLOTH: 'T4 Изысканная ткань' },
  itemId: q.get('item'), enchant: Number(q.get('enchant')), quality: Number(q.get('quality')), quantity: Number(q.get('quantity')), taxRate: 0.08, setupFeeRate: 0.025, marketShare: 0.25,
  rrrOptions: { gearRate: 0.248 }, rrrPreset: { rrr: 0.248 }, hasAllMaterialPrices: true, effectiveCostPerUnit: 1860, materialCostPerUnit: 2480, totalCost: 1860 * Number(q.get('quantity')),
  recipe: [
    { resource: 'T4_CLOTH', queryId: 'T4_CLOTH', materialSource: 'buy', count: 20, rrr: 0.25, returnable: true, neededToBuy: 20, cheapestPrice: 100, cheapestCity: 'Martlock', buyPrice: 100, cityPrices: [{ city: 'Martlock', price: 100 }, { city: 'Lymhurst', price: 110 }] },
    { resource: 'T4_RUNE', queryId: 'T4_RUNE', materialSource: 'buy', count: 96, rrr: 0.25, returnable: true, neededToBuy: 96, cheapestPrice: 5, cheapestCity: 'Lymhurst', buyPrice: 5, cityPrices: [] },
  ],
  acquire: { byResource: [], days: 0.4 }, enchantAfterCraft: null, bestSell: { city: 'Martlock', price: 1500, taxRate: 0.08 }, netSellPrice: 1380, profitPerUnit: -480, totalProfit: -4800, sellPrices: [{ city: 'Martlock', sellMin: 1600, buyMax: 1500 }],
  patientSell: { days: 3, avgSellPrice: 2500, netSellPrice: 2240, marketDailyVolume: 8, avgDailyVolume: 8, marketShare: 0.25, daysToSellBatch: 3, profitPerUnit: 380, bestCity: { city: 'Lymhurst', avgPrice: 2500 },
    ...(q.get('sellThreshold') ? { threshold: { value: Number(q.get('sellThreshold')), cities: [{ city: 'Lymhurst', avgPrice: 2500, avgDailyVolume: 8 }], totalDailyVolume: 8, daysToSellBatch: 5 } } : {}),
    byCity: [{ city: 'Lymhurst', avgSellPrice: 2500, avgDailyVolume: 8, taxRate: 0.105, netPrice: 2237, profitPerUnit: 377, profitIndex: 20 }, { city: 'Bridgewatch', avgSellPrice: null, avgDailyVolume: 0, taxRate: 0.105, noData: true, profitPerUnit: null }],
    plan: { cities: [{ city: 'Lymhurst', qty: Number(q.get('quantity')), days: 3 }], excluded: [], totalDays: 3, profitPerUnit: 380 } },
  ...(q.get('ceiling') ? { sellPlan: { ceiling: Number(q.get('ceiling')), withinCeiling: false, sellLow: 2000, sellHigh: 2600, profitLow: 100, profitHigh: 700, totalLow: 1000, totalHigh: 7000 } } : {}),
  ...(q.get('teleport') ? { teleport: { homeCity: 'Fort Sterling', materialLegs: [{ resource: 'T4_CLOTH', resourceName: 'Ткань', fromCity: 'Martlock', needed: 20, distance: 2, cost: 400 }], legsCost: 400, costPerUnit: 2260, instant: { city: 'Martlock', distance: 2, cost: 100, profitPerUnit: -300 }, patient: null, unweighted: [] } } : {}),
  qualityComparison: [], tierComparison: [{ itemId: 'T4_2H_BOW', tier: 4, enchant: 0, hasPrice: true, cost: 1000, bestQuality: 4, bestSell: { city: 'Martlock', price: 1500 }, profitPerUnit: 380, profitPct: 38, patient: { quality: 4, profitPerUnit: 1240, profitPct: 124, avgDailyVolume: 8 }, isCurrent: true }],
});

async function mock(page, log) {
  await page.route('**/api/unified-scan*', (route) => { log.scan.push(new URL(route.request().url()).searchParams); route.fulfill({ json: SCAN }); });
  await page.route('**/api/craft-calc*', (route) => { const q = new URL(route.request().url()).searchParams; log.calc.push(q); route.fulfill({ json: calc(q) }); });
}

test('параметры: профиль выставляет возврат, правка возврата переводит в «Свой», все поля панели лежат в одной линии', async ({ page }, info) => {
  await page.goto('/craft.html');
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
  await page.goto('/craft.html');
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
  await expect(page.locator('#dock-pr')).toContainText('+1 900');                                        // сначала цифры из скана (5 × 15 200), затем — расчёт позиции калькулятором: 5 × 380
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
  await page.goto('/craft.html');
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

// ---------- фракционный план и крафт-лист ----------
const PTS = { 4: 400, 5: 2250, 6: 3000 };
const planRow = (tier, enchant, capePrice, sale, vol) => ({
  itemId: `T${tier}_CAPEITEM_FW_MARTLOCK`, finishedId: `T${tier}_CAPEITEM_FW_MARTLOCK${enchant ? `@${enchant}` : ''}`, tier, enchant, quality: 1, source: 'data', pointsPerCape: 3000 + PTS[tier],
  crestId: `T${tier}_CAPEITEM_FW_MARTLOCK_BP`, heartId: 'T1_FACTION_HIGHLAND_TOKEN_1',
  capeDirect: { id: `T${tier}_CAPE${enchant ? `@${enchant}` : ''}`, label: 'Плащ', price: capePrice }, cape0: { id: `T${tier}_CAPE`, label: 'Плащ .0', price: capePrice },
  runes: [], maxAfter: true, crest: { id: `T${tier}_CAPEITEM_FW_MARTLOCK_BP`, price: 500 }, heart: { id: 'T1_FACTION_HIGHLAND_TOKEN_1', price: 1000 },
  sale: { avgPrice: sale, dailyVolume: vol, manual: false }, manualSaleKey: { id: `T${tier}_CAPEITEM_FW_MARTLOCK`, quality: 1 },
});
const PLAN = { faction: { id: 'MARTLOCK', name: 'Мартлок' }, days: 3, taxRate: 0.08, setupFeeRate: 0.025, manualTtlDays: 10, jug: { lastPricePass: Date.now() - 120000 },
  rows: [planRow(6, 3, 2000, 100000, 1), planRow(5, 2, 2000, 100000, 1), planRow(4, 0, null, 30000, 1)] };

async function mockFaction(page, log) {
  await page.route('**/api/faction-plan*', (route) => { log.plan.push(new URL(route.request().url()).searchParams); route.fulfill({ json: PLAN }); });
  await page.route('**/api/manual-price', (route) => { log.saved.push(route.request().postDataJSON()); route.fulfill({ json: { ok: true } }); });
  await page.route('**/api/craft-calc*', (route) => {
    const q = new URL(route.request().url()).searchParams;
    log.calc.push(q);
    const tier = Number(q.get('item')[1]);
    const qty = Number(q.get('quantity'));
    const after = q.get('enchantAfterCraft') === 'true';
    const silver = (q.get('partsSilver') || '').split(',').filter(Boolean);
    const unit = (tier === 6 ? (after ? 40000 : 50000) : tier === 5 ? (after ? 49000 : 50000) : 3000) + (silver.includes('heart') ? 1025 : 0) + (silver.includes('crest') ? 500 : 0);
    const perCape = (silver.includes('heart') ? 0 : 3000) + (silver.includes('crest') ? 0 : PTS[tier]);
    route.fulfill({ json: {
      dataSource: 'jug', jug: { lastPricePass: Date.now() - 60000 }, faction: q.get('faction') ? { id: 'MARTLOCK', name: 'Мартлок', pointsPerCape: perCape, availablePoints: 90000 } : null,
      names: { T6_RUNE: 'Руна (мастер)' }, itemId: q.get('item'), enchant: Number(q.get('enchant')), quality: 1, quantity: qty, taxRate: 0.08, setupFeeRate: 0, hasAllMaterialPrices: true,
      effectiveCostPerUnit: unit, totalCost: unit * qty, acquire: { byResource: [] }, patientSell: null, profitPerUnit: null,
      recipe: [{ resource: 'T6_RUNE', queryId: 'T6_RUNE', materialSource: 'buy', neededToBuy: qty, cheapestPrice: 100, cheapestCity: 'Martlock', buyPrice: 100 }],
      enchantAfterCraft: after ? { baseSource: 'craft', steps: [], targetLevel: Number(q.get('enchant')) } : null,
    } });
  });
}

test('фракционный план: зелёные позиции, недостающая цена вписывается и позиция сразу входит в план; цена сохраняется на сервере', async ({ page }) => {
  const log = { plan: [], calc: [], saved: [], scan: [] };
  await mockFaction(page, log);
  await page.goto('/craft.html');
  await page.locator('[data-tab="faction"]').click();
  await page.locator('#f-points').fill('90000');
  await expect(page.locator('#plan-table tbody tr.on-plan')).toHaveCount(2);
  await expect(page.locator('#plan-table tr[data-row="4|0|1"]')).toHaveClass(/off/);
  await expect(page.locator('#plan-table')).toContainText('нужна цена');
  expect(log.plan[0].get('faction')).toBe('LYMHURST');
  await page.locator('#plan-table tr[data-row="4|0|1"] .pill.w').click();
  await page.locator('.editbox .chipin', { hasText: /^Плащ\s*$/ }).locator('input').fill('1000');
  await expect(page.locator('#plan-table tr[data-row="4|0|1"]')).toHaveClass(/on-plan/);
  await expect.poll(() => log.saved.length).toBeGreaterThan(0);
  expect(log.saved[0]).toMatchObject({ id: 'T4_CAPE', quality: 1, price: 1000 });
  await page.locator('#f-mode, [aria-label="Детали"] button', { hasText: 'Всё за очки' }).click();
  await expect(page.locator('#f-send')).toContainText('Крафтить план');
});

test('крафт-лист из плана: позиции с количеством, детали за серебро, автовыбор «после крафта» 7%, итоги, сводная закупка с названиями, исключение позиции', async ({ page }) => {
  const log = { plan: [], calc: [], saved: [], scan: [] };
  await mockFaction(page, log);
  await page.goto('/craft.html');
  await page.locator('[data-tab="faction"]').click();
  await page.locator('#f-points').fill('90000');
  await page.getByRole('button', { name: 'Всё за очки' }).click();
  await expect(page.locator('#plan-table tbody tr.on-plan')).toHaveCount(2);
  await page.locator('#f-send').click();
  const cards = page.locator('#drawer-list .li-card');
  await expect(cards).toHaveCount(2);
  const t6 = cards.filter({ hasText: 'T6' });
  const t5 = cards.filter({ hasText: 'T5' });
  // T6 .3: чары после крафта выигрывают 20% дешевле (+24% к профиту ≥ 7%); T5 .2: 2% — прямой путь
  await expect(t6.locator('.li-line')).toContainText('чары после крафта (+24% к профиту)');
  await expect(t5.locator('.li-line')).not.toContainText('чары после крафта');
  expect(log.calc.some((q) => q.get('item') === 'T6_CAPEITEM_FW_MARTLOCK' && q.get('enchantAfterCraft') === 'true' && q.get('faction') === 'LYMHURST')).toBe(true);
  await expect(t6.locator('.li-line')).toContainText('профит +');
  await expect(page.locator('#shopping')).toContainText('Руна (мастер)');
  await expect(page.locator('#shopping')).not.toContainText('T6_RUNE');
  // герб за серебро → запрос с partsSilver, очков меньше
  await t6.locator('label', { hasText: 'герб за серебро' }).locator('input').check();
  await expect.poll(() => log.calc.some((q) => q.get('partsSilver') === 'crest')).toBe(true);
  // своя цена продажи меняет профит сразу, без запроса
  const before = log.calc.length;
  await t5.locator('.chipin', { hasText: 'цена продажи' }).locator('input').fill('60000');
  await expect(t5.locator('.li-line')).toContainText('профит +');
  expect(log.calc.length).toBe(before);
  // исключить позицию из расчёта и убрать
  const profitBefore = await page.locator('#dock-pr').innerText();
  await t5.locator('.li-pick').click();
  await expect(t5).toHaveClass(/off/);
  await expect.poll(() => page.locator('#dock-pr').innerText()).not.toBe(profitBefore);
  await t5.locator('.x').click();
  await expect(cards).toHaveCount(1);
  await page.locator('#drawer-list .li-pick').click();                                              // единственная позиция вернулась в расчёт
  await expect(page.locator('#dock-count')).toHaveText('1');
});

test('ленивый крафтер: бюджет и стратегия уходят в запрос вместе с параметрами панели; план целиком — в крафт-лист', async ({ page }) => {
  const seen = [];
  await page.route('**/api/lazy-crafter*', (route) => {
    seen.push(new URL(route.request().url()).searchParams);
    route.fulfill({ json: { budget: 3000000, spent: 900000, remaining: 2100000, totalProfit: 500000, profitPct: 55.5, candidates: 9, dataSource: 'jug', jug: { lastPricePass: Date.now() - 60000 }, items: [
      { itemId: 'T4_CAPE', costPerUnit: 2000, profitPerUnit: 1500, qty: 100, costUsed: 200000, profitEarned: 150000, bestSellCity: { city: 'Martlock', avgPrice: 4000 }, daysToAcquireBatch: 0.2, daysToSellBatch: 1, bottleneckResource: 'T4_LEATHER' },
      { itemId: 'T4_2H_BOW', costPerUnit: 7000, profitPerUnit: 9000, qty: 20, costUsed: 140000, profitEarned: 180000, bestSellCity: { city: 'Lymhurst', avgPrice: 17000 }, daysToAcquireBatch: 0.5, daysToSellBatch: 2, bottleneckResource: null },
    ] } });
  });
  await page.goto('/craft.html');
  await page.locator('[data-tab="lazy"]').click();
  await page.locator('#l-budget').fill('3 000 000');
  await page.locator('#l-strategy').selectOption('mass');
  await page.locator('#lazy-run').click();
  await expect(page.locator('#lazy-table tbody tr')).toHaveCount(2);
  expect(seen[0].get('budget')).toBe('3000000');
  expect(seen[0].get('strategy')).toBe('mass');
  expect(seen[0].get('gearRrrCustom')).toBe('24.8');
  expect(seen[0].get('source')).toBe('jug');
  await expect(page.locator('#l-profit')).toContainText('+500 000');
  await page.locator('#lazy-add-all').click();
  await expect(page.locator('#dock-count')).toHaveText('2');
});


// ---------- перенесённое из старой страницы: свои цены, лог закупок, план продажи, потолок/полоса/порог, телепорт, «Своё…», выбор по категориям ----------
async function openCalc(page, log) {
  await mock(page, log);
  await page.goto('/craft.html');
  await page.locator('[data-tab="calc"]').click();
  await page.locator('#c-search').fill('лук');
  await page.locator('.suggest button').first().click();
  await expect(page.locator('#verdict')).toBeVisible();
}
const cost = (page) => page.locator('#cost-summary');

test('свои цены на материалы: себестоимость пересчитывается на месте, «Сбросить свои цены» возвращает рыночные', async ({ page }) => {
  const log = { scan: [], calc: [] };
  await openCalc(page, log);
  await expect(page.locator('#craft-recipe-table')).toContainText('Изысканная ткань');
  await expect(cost(page)).toContainText('1 860');
  const before = log.calc.length;
  await page.locator('#craft-recipe-table input.manual-price[data-res="T4_CLOTH"]').fill('200');       // (200 − 100) × 20 × (1 − 0.25) = +1 500
  await expect(cost(page)).toContainText('3 360');
  await expect(page.locator('#verdict')).toContainText('по твоим ценам');
  await expect(page.locator('#buy-table input.manual-price[data-res="T4_CLOTH"]')).toHaveValue('200');   // та же цена и в плане закупки
  expect(log.calc.length).toBe(before);                                                                    // без запроса к серверу
  await page.locator('.manual-reset').click();
  await expect(cost(page)).toContainText('1 860');
});

test('лог закупок по лотам: средняя цена стаков подставляется вместо рыночной, показано «куплено X из Y»', async ({ page }) => {
  const log = { scan: [], calc: [] };
  await openCalc(page, log);
  await page.getByRole('button', { name: 'Ещё' }).click();
  await page.getByText('Лог закупок по лотам').click();
  const plan = page.locator('#buy-table [data-res="T4_CLOTH"].lot-add');
  await plan.click();
  await page.locator('#buy-table .lot-log').first().locator('.lot-qty').fill('100');
  await page.locator('#buy-table .lot-log').first().locator('.lot-price').fill('150');                    // средняя 150: (150 − 100) × 20 × 0.75 = +750
  await expect(cost(page)).toContainText('2 610');
  await expect(page.locator('#buy-table .lot-sum').first()).toContainText('куплено 100 из 20');
});

test('продажа: своя цена в Buy Order, план по городам — включение города, своё количество, сброс к автоплану, своя цена города', async ({ page }) => {
  const log = { scan: [], calc: [] };
  await openCalc(page, log);
  await page.getByRole('tab', { name: 'Продажа' }).click();
  await page.locator('#manual-sell-price').fill('3000');
  await expect(page.locator('#sell-instant')).toContainText('своя цена: 3 000');
  await expect(page.locator('#sell-instant')).toContainText('+900');                                       // 3000 × 0.92 − 1860
  await expect(page.locator('#city-plan')).toContainText('10 из 10 шт');
  await page.locator('#city-table input.plan-toggle[data-city="Lymhurst"]').uncheck();
  await expect(page.locator('#city-plan')).toContainText('0 из 10 шт');
  await page.locator('#city-table input.plan-qty[data-city="Lymhurst"]').fill('4');
  await expect(page.locator('#city-plan')).toContainText('4 из 10 шт');
  await expect(page.locator('#city-plan')).toContainText('сумма плана не равна партии');
  await page.locator('.plan-reset').click();
  await expect(page.locator('#city-plan')).toContainText('10 из 10 шт');
  await page.locator('#city-table input.plan-city-price[data-city="Bridgewatch"]').fill('2000');           // город без сделок со своей ценой: чистая цена и профит считаются
  await expect(page.locator('#city-table tr', { hasText: 'Bridgewatch' })).toContainText('2 000');
  await page.locator('#sale-strategy').selectOption('even');
  await expect(page.locator('#city-plan')).toContainText('10 из 10 шт');
});

test('потолок, полоса цены, порог продажи и телепорт: уходят в запрос и показываются в результате', async ({ page }) => {
  const log = { scan: [], calc: [] };
  await openCalc(page, log);
  await page.getByRole('button', { name: 'Ещё' }).click();
  await page.locator('#ceiling').fill('3000');
  await page.locator('#sell-low').fill('2000');
  await page.locator('#sell-high').fill('2600');
  await page.locator('#sell-threshold').fill('2400');
  await page.getByText('Учитывать телепорт').click();
  await expect.poll(() => log.calc[log.calc.length - 1].get('teleport')).toBe('true');
  const q = log.calc[log.calc.length - 1];
  expect(q.get('ceiling')).toBe('3000');
  expect(q.get('sellLow')).toBe('2000');
  expect(q.get('sellHigh')).toBe('2600');
  expect(q.get('sellThreshold')).toBe('2400');
  await page.getByRole('tab', { name: 'Продажа' }).click();
  await expect(page.locator('#sell-patient')).toContainText('Потолок себестоимости 3 000: проходит?');
  await expect(page.locator('#sell-patient')).toContainText('2 000—2 600');
  await expect(page.locator('#sell-patient')).toContainText('Города с ценой не ниже 2 400');
  await page.getByRole('tab', { name: 'Закупка' }).click();
  await expect(page.locator('.teleport-plan')).toContainText('Логистика (телепорт): собираем в Fort Sterling');
});

test('«Своё…»: доля рынка в процентах, история гира и сырья — с единицей (12ч, 2д)', async ({ page }) => {
  const log = { scan: [], calc: [] };
  await openCalc(page, log);
  await page.locator('#share').selectOption('__custom__');
  await page.locator('#share-custom').fill('15');
  await expect.poll(() => log.calc[log.calc.length - 1].get('marketShare')).toBe('0.15');
  await page.locator('#hist').selectOption('__custom__');
  await page.locator('#hist-custom').fill('12ч');
  await expect.poll(() => log.calc[log.calc.length - 1].get('days')).toBe('0.5');
  await page.locator('#mhist').selectOption('__custom__');
  await page.locator('#mhist-custom').fill('2д');
  await expect.poll(() => log.calc[log.calc.length - 1].get('materialHours')).toBe('48');
  await page.locator('#mhist-custom').fill('2');                                                            // без единицы — отклоняется, значение прежнее
  await expect(page.locator('#mhist-custom')).toHaveClass(/invalid/);
  expect(log.calc[log.calc.length - 1].get('materialHours')).toBe('48');
});

test('выбор предмета по категории и тиру: колонки по группам, клик по предмету запускает расчёт', async ({ page }) => {
  const log = { scan: [], calc: [] };
  await mock(page, log);
  await page.goto('/craft.html');
  await page.locator('[data-tab="calc"]').click();
  await page.locator('#c-cat').selectOption('weapon');
  await page.locator('#c-tier').selectOption('4');
  await page.locator('#c-search').click();
  await expect(page.locator('.suggest.columns .suggest-col').first()).toBeVisible();
  await expect(page.locator('.suggest.columns')).toContainText('Арбалеты');
  await page.locator('.suggest.columns button').first().click();
  await expect(page.locator('#verdict')).toBeVisible();
  expect(log.calc.length).toBeGreaterThan(0);
});


test('/craft.html загружается без ошибок JS и с общей навигацией сайта', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|render\.albiononline/.test(m.text())) errors.push(m.text()); });
  await page.goto('/craft.html');
  await expect(page.locator('.pbar')).toBeVisible();
  await expect(page.locator('.nav a')).toHaveCount(6);
  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);
});

// ---------- цены материала по городам ----------
test('панель «Все города» материала: серая рыночная цена, своя цена города меняет выбор города и себестоимость, «Сбросить» возвращает рынок', async ({ page }) => {
  const log = { scan: [], calc: [] };
  await openCalc(page, log);
  const panel = page.locator('#craft-recipe-table details.cityprices[data-res="T4_CLOTH"]');
  await panel.locator('summary').click();
  await expect(panel.locator('.cp-row')).toHaveCount(5);                                                    // все пять основных городов (у трёх нет рыночной цены — своя вписывается)
  await expect(panel.locator('.cp-row.is-best')).toContainText('Martlock');
  await expect(panel.locator('input[data-city="Martlock"]')).toHaveAttribute('placeholder', '100');           // серым — рыночная цена
  await expect(panel.locator('.cp-row', { hasText: 'Bridgewatch' })).toContainText('нет цены');
  const before = log.calc.length;
  await panel.locator('input[data-city="Lymhurst"]').fill('50');                                             // (50 − 100) × 20 × (1 − 0.25) = −750
  await expect(panel.locator('.cp-row.is-best')).toContainText('Lymhurst');
  await expect(page.locator('#cost-summary')).toContainText('1 110');
  await expect(page.locator('#buy-table')).toContainText('своя');
  expect(log.calc.length).toBe(before);                                                                       // без запроса к серверу
  await panel.locator('input[data-city="Bridgewatch"]').fill('40');                                          // город без рыночной цены со своей ценой
  await expect(panel.locator('.cp-row.is-best')).toContainText('Bridgewatch');
  await expect(panel.locator('summary')).toContainText('своих 2');
  await page.locator('.manual-reset').click();
  await expect(page.locator('#cost-summary')).toContainText('1 860');
});

test('крафт-лист: панель «Все города» в сводной закупке, своя цена города пересчитывает итоги листа', async ({ page }) => {
  const log = { scan: [], calc: [] };
  await openCalc(page, log);
  await page.locator('#calc-add').click();
  await page.locator('#open-list').click();
  const row = page.locator('#shopping .shop', { hasText: 'Изысканная ткань' });
  await expect(row).toContainText('2 000');                                                                   // 20 шт × 100
  await row.locator('details.cityprices summary').click();
  await row.locator('input[data-city="Martlock"]').fill('50');
  await expect(row).toContainText('1 000');                                                                   // 20 шт × 50
  await expect(page.locator('#drawer-list .totals')).toContainText('11 100');                                    // (1860 − 750) × 10 шт
  await expect(page.locator('#dock-inv')).toContainText('11 100');
});

// ---------- стек калькулятора ----------
async function twoItemsInList(page, log) {
  await mock(page, log);
  await page.goto('/craft.html');
  await page.locator('#scan-run').click();
  await expect(page.locator('#scan-rows .row')).toHaveCount(2);
  await page.locator('#scan-rows .row').nth(0).locator('button[title="В крафт-лист"]').click();
  await page.locator('#scan-rows .row').nth(1).locator('button[title="В крафт-лист"]').click();
  await expect(page.locator('#dock-count')).toHaveText('2');
  await page.locator('#open-list').click();
}

test('крафт-лист → калькулятор стеком: активные позиции копируются, серые выпадают из расчёта, лист не меняется', async ({ page }) => {
  const log = { scan: [], calc: [] };
  await twoItemsInList(page, log);
  await expect(page.locator('#open-in-calc')).toContainText('(2)');
  await page.locator('#drawer-list .li-card').first().locator('.li-pick').click();                        // первая позиция — серая
  await expect(page.locator('#open-in-calc')).toContainText('(1)');
  await page.locator('#drawer-list .li-card').first().locator('.li-pick').click();                        // снова активная
  await expect(page.locator('#open-in-calc')).toContainText('(2)');
  await page.locator('#open-in-calc').click();
  await expect(page.locator('#stack-verdict')).toBeVisible();
  const cards = page.locator('#panel-calc .li-card');
  await expect(cards).toHaveCount(2);
  await expect(page.locator('#stack-verdict')).toContainText('2');                                        // позиций в расчёте
  // сводная закупка складывает одинаковые материалы двух позиций
  await expect(page.locator('#shopping')).toContainText('Изысканная ткань');
  await expect(page.locator('#shopping .shop', { hasText: 'Изысканная ткань' })).toContainText('40');
  // серая позиция выпадает из расчёта
  await cards.first().locator('.li-pick').click();
  await expect(cards.first()).toHaveClass(/off/);
  await expect(page.locator('#shopping .shop', { hasText: 'Изысканная ткань' })).toContainText('20');
  await expect(page.locator('#stack-verdict')).toContainText('1');
  await cards.first().locator('.li-pick').click();
  // своё количество: пересчёт этой позиции запросом
  await cards.first().locator('.qty input').fill('7');
  await cards.first().locator('.qty input').blur();
  await expect.poll(() => log.calc.some((q) => q.get('quantity') === '7')).toBe(true);
  // добавление и удаление позиции
  await page.locator('#stack-add').click();
  await page.locator('#c-search').fill('лук');
  await page.locator('.suggest button').first().click();
  await expect(cards).toHaveCount(3);
  await cards.last().locator('.x').click();
  await expect(cards).toHaveCount(2);
  // таблица продаж и переход к одной позиции
  await page.getByRole('tab', { name: 'Продажа' }).click();
  await expect(page.locator('#stack-sales tbody tr')).toHaveCount(2);
  await page.locator('#stack-sales tbody tr').first().click();
  await expect(page.locator('#verdict')).toBeVisible();
  await expect(page.locator('#stack-focus-bar')).toBeVisible();
  await page.locator('#c-qty').fill('9');                                                                  // правка позиции в фокусе идёт в стек
  await page.locator('#stack-back').click();
  await expect(page.locator('#panel-calc .li-card').first().locator('.qty input')).toHaveValue('9');
  // выход из стека; лист остался прежним (копия)
  await page.locator('#stack-exit').click();
  await expect(page.locator('#stack-verdict')).toHaveCount(0);
  await page.locator('#open-list').click();
  await expect(page.locator('#drawer-list .li-card')).toHaveCount(2);
  await expect(page.locator('#drawer-list .li-card').first().locator('.qty input')).toHaveValue('1');
});

test('свои цены материалов общие: вписанная в стеке цена города видна в калькуляторе одной позиции и в листе', async ({ page }) => {
  const log = { scan: [], calc: [] };
  await twoItemsInList(page, log);
  await page.locator('#open-in-calc').click();
  const row = page.locator('#shopping .shop', { hasText: 'Изысканная ткань' });
  await expect(row).toContainText('4 000');                                                                 // 40 шт × 100
  await row.locator('details.cityprices summary').click();
  await row.locator('input[data-city="Martlock"]').fill('50');
  await expect(row).toContainText('2 000');
  await page.locator('#panel-calc .li-card').first().locator('.linkbtn').click();                          // «подробнее» — та же цена в таблице материалов
  const panel = page.locator('#craft-recipe-table details.cityprices[data-res="T4_CLOTH"]');
  await panel.locator('summary').click();
  await expect(panel.locator('input[data-city="Martlock"]')).toHaveValue('50');
  await expect(page.locator('.manual-reset')).toBeVisible();
});

test('фракционный план: «Сразу в калькулятор» открывает стек, минуя крафт-лист', async ({ page }) => {
  const log = { plan: [], calc: [], saved: [], scan: [] };
  await mockFaction(page, log);
  await page.goto('/craft.html');
  await page.locator('[data-tab="faction"]').click();
  await page.locator('#f-points').fill('90000');
  await page.getByRole('button', { name: 'Всё за очки' }).click();
  await expect(page.locator('#plan-table tbody tr.on-plan')).toHaveCount(2);
  await page.locator('#f-send-calc').click();
  await expect(page.locator('#stack-verdict')).toBeVisible();
  await expect(page.locator('#panel-calc .li-card')).toHaveCount(2);
  await expect(page.locator('#dock-count')).toHaveText('0');                                              // лист не тронут
  await expect.poll(() => log.calc.some((q) => q.get('faction') === 'LYMHURST')).toBe(true);
});

// ---------- лимит запросов сервера (60 в минуту на /api) ----------
test('открытие стека и повторные расчёты не плодят запросы: одинаковые расчёты берутся из кэша страницы', async ({ page }) => {
  const log = { scan: [], calc: [] };
  await twoItemsInList(page, log);
  await expect(page.locator('#drawer-list .li-card').first()).toContainText('профит');
  await expect.poll(() => log.calc.length).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(1500);                                                                         // движок листа закончил
  const afterList = log.calc.length;
  await page.locator('#open-in-calc').click();
  await expect(page.locator('#stack-verdict')).toBeVisible();
  await expect(page.locator('#panel-calc .li-card').first()).toContainText('профит');
  await page.waitForTimeout(1500);
  expect(log.calc.length).toBe(afterList);                                                                 // стек взял результаты листа из кэша, ни одного нового запроса
});

test('ответ 429 «слишком много запросов»: страница сама ждёт и повторяет, вместо ошибки в калькуляторе', async ({ page }) => {
  let tries = 0;
  await page.route('**/api/craft-calc*', (route) => {
    tries++;
    if (tries === 1) return route.fulfill({ status: 429, headers: { 'retry-after': '1' }, json: { error: 'слишком много запросов, попробуйте через минуту' } });
    return route.fulfill({ json: calc(new URL(route.request().url()).searchParams) });
  });
  await page.goto('/craft.html');
  await page.locator('[data-tab="calc"]').click();
  await page.locator('#c-search').fill('лук');
  await page.locator('.suggest button').first().click();
  await expect(page.locator('#verdict')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.err')).toHaveCount(0);
  expect(tries).toBe(2);
});

// ---------- оборот плащей ----------
// очки вводятся как человек: выделить всё и набрать (fill() добавил бы цифры к прежнему значению)
async function setPoints(page, value) {
  await page.locator('#f-points').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(value);
  await page.locator('#f-points').blur();
}

test('план: колонка «Оборот/день» и метка «потолок»; «Игнорировать потолок» тратит очки дальше и предупреждает о сроке продажи', async ({ page }) => {
  const log = { plan: [], calc: [], saved: [], scan: [] };
  await mockFaction(page, log);
  await page.goto('/craft.html');
  await page.locator('[data-tab="faction"]').click();
  await setPoints(page, '90000');
  await expect(page.locator('#plan-table thead')).toContainText('Оборот/день');
  const top = page.locator('#plan-table tr[data-row="6|3|1"]');
  await expect(top).toContainText('потолок 3');            // оборот 1 шт/день × окно 3 дня
  await expect(top).toContainText('× 3');
  await expect(top.locator('.pill.w', { hasText: 'потолок' })).toBeVisible();
  await expect(page.locator('#f-capes')).toHaveText('6');
  await expect(page.locator('#f-ceil-note')).toHaveCount(0);
  await page.locator('[aria-label="Потолок оборота"] button', { hasText: 'Игнорировать' }).click();
  await expect(page.locator('#f-ceil-note')).toContainText('Потолок оборота выключен');
  await expect.poll(async () => Number(await page.locator('#f-capes').innerText())).toBeGreaterThan(6);
  await expect(page.locator('#plan-table tr.on-plan small.scan-stale').first()).toContainText('на продажу');
  await page.locator('[aria-label="Потолок оборота"] button', { hasText: 'Учитывать' }).click();
  await expect(page.locator('#f-capes')).toHaveText('6');
});

test('крафт-лист и стек калькулятора: у позиций из плана виден оборот и срок продажи партии', async ({ page }) => {
  const log = { plan: [], calc: [], saved: [], scan: [] };
  await mockFaction(page, log);
  await page.goto('/craft.html');
  await page.locator('[data-tab="faction"]').click();
  await setPoints(page, '90000');
  await expect(page.locator('#plan-table tbody tr.on-plan')).toHaveCount(2);
  await page.locator('#f-send-calc').click();
  const cards = page.locator('#panel-calc .li-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.first().locator('.li-turn')).toContainText('оборот 1,0 шт/день');
  await expect(cards.first().locator('.li-turn')).toContainText('3 шт ≈');
  await page.locator('.subtabs button', { hasText: 'Продажа' }).click();
  await expect(page.locator('#stack-sales thead')).toContainText('Оборот / день');
});

// ---------- справочники предметов ----------
test('справочники при «слишком много запросов»: страница ждёт и повторяет — названия предметов и категории не остаются пустыми', async ({ page }) => {
  const tries = { items: 0, groups: 0 };
  const limited = (kind) => (route) => {
    tries[kind]++;
    if (tries[kind] === 1) return route.fulfill({ status: 429, headers: { 'retry-after': '1' }, json: { error: 'слишком много запросов, попробуйте через минуту' } });
    return route.continue();
  };
  await page.route('**/api/items*', limited('items'));
  await page.route('**/api/item-groups*', limited('groups'));
  await page.route('**/api/unified-scan*', (route) => route.fulfill({ json: SCAN }));
  await page.goto('/craft.html');
  await page.locator('#scan-run').click();
  await expect(page.locator('#scan-rows > *').first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#ref-error')).toHaveCount(0);
  expect(tries.items).toBe(2);
  await page.locator('[data-tab="calc"]').click();
  await page.locator('#c-cat').selectOption('weapon');
  await page.locator('#c-search').focus();
  await expect(page.locator('.suggest-col').first()).toBeVisible({ timeout: 10000 });          // колонки по группам оружия — из справочника групп
});

test('справочник не загрузился: предупреждение с кнопкой «Повторить», после неё названия появляются без перезагрузки страницы', async ({ page }) => {
  let broken = true;
  await page.route('**/api/items*', (route) => (broken ? route.fulfill({ status: 500, contentType: 'text/html', body: 'ошибка' }) : route.continue()));
  await page.goto('/craft.html');
  await expect(page.locator('#ref-error')).toContainText('справочник предметов');
  broken = false;
  await page.locator('#ref-retry').click();
  await expect(page.locator('#ref-error')).toHaveCount(0);
  await page.locator('[data-tab="calc"]').click();
  await page.locator('#c-search').fill('лук');
  await expect(page.locator('.suggest button').first()).toBeVisible();
});
