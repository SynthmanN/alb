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
  await expect(page.locator('#dock-pr')).toContainText('+6 200');                                        // сначала цифры из скана (5 × 15 200), затем — расчёт позиции калькулятором: 5 × 1 240
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
  await page.goto('/craft-next.html');
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
  await page.goto('/craft-next.html');
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
  await page.goto('/craft-next.html');
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
