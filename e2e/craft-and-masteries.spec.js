const { test, expect } = require('@playwright/test');

test('крафт-калькулятор: выбор предмета и расчёт показывают итог с налогом', async ({ page }) => {
  await page.route('**/api/craft-calc*', (route) => route.fulfill({ json: {
    itemId: 'T4_MAIN_SWORD', enchant: 0, quality: 1, quantity: 1, rrrPreset: { id: 'none', label: 'Без бонусов', bonus: 0, rrr: 0 },
    cities: ['Martlock'], hasAllMaterialPrices: true, materialCostPerUnit: 8000, effectiveCostPerUnit: 8000, totalCost: 8000,
    recipe: [{ resource: 'T4_METALBAR', resourceName: 'T4 Слитки (IV)', queryId: 'T4_METALBAR', enchanted: false, count: 16, cheapestCity: 'Martlock', cheapestPrice: 500 }],
    sellPrices: [{ city: 'Martlock', sellMin: 12000, buyMax: 10000 }], bestSell: { city: 'Martlock', price: 10000 },
    taxRate: 0.08, netSellPrice: 9200, profitPerUnit: 1200, totalProfit: 1200,
    patientSell: { days: 7, avgSellPrice: 11000, bestCity: { city: 'Lymhurst', avgPrice: 12000 }, avgDailyVolume: 20, daysToSellBatch: 0.05, netSellPrice: 10120, profitPerUnit: 2120 },
  } }));
  await page.goto('/craft.html');
  await page.locator('#craft-search').fill('меч');
  await page.locator('#craft-suggestions .suggestion-item').first().click();
  await page.locator('#craft-run').click();
  await expect(page.locator('#craft-result .craft-summary').first()).toContainText('После налога с продажи (8%)');
  await expect(page.locator('#craft-result .craft-summary').first()).toContainText('1 200');
  await expect(page.locator('#craft-result .patient-sell')).toContainText('Продажа через Sell Order');
  await expect(page.locator('#craft-result .patient-sell')).toContainText('2 120');
});

test('уровень специализации сохраняется на сервере и переживает перезагрузку', async ({ page }) => {
  await page.goto('/masteries.html');
  await page.locator('#mastery-search').fill('клеймор');
  const input = page.locator('input[data-id="COMBAT_SWORDS_CLAYMORE"]');
  await expect(input).toBeVisible();
  await input.fill('77');
  await input.dispatchEvent('change');
  await expect(page.locator('#mastery-status')).toHaveText('Сохранено');

  await page.reload();
  await page.locator('#mastery-search').fill('клеймор');
  await expect(page.locator('input[data-id="COMBAT_SWORDS_CLAYMORE"]')).toHaveValue('77');

  // уборка: сбрасываем уровень, чтобы не влиять на другие тесты
  await page.locator('input[data-id="COMBAT_SWORDS_CLAYMORE"]').fill('0');
  await page.locator('input[data-id="COMBAT_SWORDS_CLAYMORE"]').dispatchEvent('change');
  await expect(page.locator('#mastery-status')).toHaveText('Сохранено');
});

test('примерочная: для достижимого IP показывает варианты, для двуручного левая рука отключается', async ({ page }) => {
  const slot = (tier, enchant, quality, price) => ({ itemId: `T${tier}_X`, tier, enchant, quality, ip: 700, masteryBonus: 0, price, city: 'Martlock' });
  await page.route('**/api/fitting-room*', (route) => route.fulfill({ json: {
    targetIP: 900, tolMinus: 30, tolPlus: 100, maxAchievableIP: 1500, unreachable: false, emptyWindow: false, twoHanded: true,
    variants: [{ totalPrice: 40000, avgIP: 905, slots: { weapon: slot(4, 1, 1, 8000), head: slot(5, 0, 2, 6000), chest: slot(5, 0, 1, 9000), shoes: slot(4, 2, 1, 7000), cape: slot(4, 1, 3, 10000) } }],
  } }));
  await page.goto('/fitting-room.html');
  const pick = async (key, text, chipText) => {
    await page.locator(`#fit-input-${key}`).fill(text);
    await page.locator(`#fit-suggestions-${key} .suggestion-item`, { hasText: chipText }).first().click();
  };
  await pick('weapon', 'клеймор', 'Клеймор');
  await expect(page.locator('#fit-input-offhand')).toBeDisabled();
  await pick('head', 'шлем', 'Шлем солдата');
  await pick('chest', 'брон', 'Броня солдата');
  await pick('shoes', 'ботин', 'Ботинки наемника');
  await pick('cape', 'плащ', 'Плащ');
  await page.locator('#fit-run').click();
  await expect(page.locator('#fit-result tbody tr')).toHaveCount(1);
  await expect(page.locator('#fit-result')).toContainText('40 000');
});

test('ленивый крафтер: по бюджету строит план и показывает итог', async ({ page }) => {
  let query = null;
  await page.route('**/api/lazy-crafter*', (route) => {
    query = new URL(route.request().url()).searchParams;
    route.fulfill({ json: {
      budget: 1000000, spent: 990000, remaining: 10000, totalProfit: 300000, profitPct: 30.3, strategy: 'balanced',
      marketSharePct: 25, sellDays: 1, taxRate: 0.08, candidates: 5,
      items: [{ itemId: 'T4_MAIN_SWORD', qty: 10, costPerUnit: 99000, profitPerUnit: 30000, costUsed: 990000, profitEarned: 300000,
        avgDailySellVolume: 50, bestSellCity: { city: 'Martlock', avgPrice: 140000 }, bottleneckResource: 'T4_METALBAR', daysToAcquireBatch: 0.5, daysToSellBatch: 1 }],
    } });
  });
  await page.goto('/craft.html');
  await page.locator('#lazy-budget').fill('1000000');
  await page.locator('#lazy-strategy').selectOption('mass');
  await page.locator('#lazy-run').click();
  await expect(page.locator('#lazy-result .craft-summary')).toContainText('Ожидаемая прибыль');
  await expect(page.locator('#lazy-result tbody tr')).toHaveCount(1);
  expect(query.get('budget')).toBe('1000000');
  expect(query.get('strategy')).toBe('mass');
});

test('доля рынка: селектор уходит в запрос калькулятора', async ({ page }) => {
  let query = null;
  await page.route('**/api/craft-calc*', (route) => { query = new URL(route.request().url()).searchParams; route.fulfill({ status: 404, json: { error: 'нет' } }); });
  await page.goto('/craft.html');
  await page.locator('#craft-search').fill('меч');
  await page.locator('#craft-suggestions .suggestion-item').first().click();
  await page.locator('#craft-market-share').selectOption('0.5');
  await page.locator('#craft-run').click();
  await expect.poll(() => query).not.toBeNull();
  expect(query.get('marketShare')).toBe('0.5');
});

test('телепорт: галочка добавляет параметр в запрос и показывает логистику', async ({ page }) => {
  let query = null;
  await page.route('**/api/craft-calc*', (route) => {
    query = new URL(route.request().url()).searchParams;
    route.fulfill({ json: {
      itemId: 'T4_MAIN_SWORD', enchant: 0, quality: 1, quantity: 100, rrrPreset: { id: 'none', label: 'Без бонусов', bonus: 0, rrr: 0 },
      cities: ['Martlock'], hasAllMaterialPrices: true, materialCostPerUnit: 8000, effectiveCostPerUnit: 8000, totalCost: 800000,
      recipe: [{ resource: 'T4_METALBAR', resourceName: 'T4 Слитки (IV)', queryId: 'T4_METALBAR', enchanted: false, count: 16, cheapestCity: 'Martlock', cheapestPrice: 500 }],
      sellPrices: [{ city: 'Martlock', sellMin: 12000, buyMax: 10000 }], bestSell: { city: 'Martlock', price: 10000 },
      taxRate: 0.08, netSellPrice: 9200, profitPerUnit: 1200, totalProfit: 120000, patientSell: null,
      teleport: {
        homeCity: 'Lymhurst', legsCost: 30600, costPerUnit: 8306,
        materialLegs: [{ resource: 'T4_METALBAR', resourceName: 'T4 Слитки (IV)', fromCity: 'Martlock', price: 500, needed: 1600, distance: 2, cost: 30600 }],
        instant: { city: 'Lymhurst', price: 10000, distance: 0, cost: 0, net: 920000, profitPerUnit: 894 }, patient: null,
      },
    } });
  });
  await page.goto('/craft.html');
  await page.locator('#craft-search').fill('меч');
  await page.locator('#craft-suggestions .suggestion-item').first().click();
  await page.locator('#craft-teleport').check();
  await page.locator('#craft-run').click();
  await expect(page.locator('#craft-result .teleport-plan')).toContainText('собираем в Lymhurst');
  await expect(page.locator('#craft-result .teleport-plan')).toContainText('30 600');
  expect(query.get('teleport')).toBe('true');
});

test('зачарование после крафта и порог продажи: параметры уходят в запрос, блоки показываются', async ({ page }) => {
  let query = null;
  await page.route('**/api/craft-calc*', (route) => {
    query = new URL(route.request().url()).searchParams;
    route.fulfill({ json: {
      itemId: 'T4_CAPEITEM_AVALON', enchant: 2, quality: 1, quantity: 5000, rrrPreset: { id: 'none', label: 'Без бонусов', bonus: 0, rrr: 0 },
      cities: ['Brecilien'], hasAllMaterialPrices: true, materialCostPerUnit: 90000, effectiveCostPerUnit: 106903, totalCost: 534515000,
      recipe: [], sellPrices: [], bestSell: null, taxRate: 0.08, netSellPrice: null, profitPerUnit: null, totalProfit: null,
      patientSell: { days: 7, avgSellPrice: 121070, bestCity: { city: 'Fort Sterling', avgPrice: 125000 }, avgDailyVolume: 5, daysToSellBatch: 1000, netSellPrice: 111384, profitPerUnit: 4481,
        threshold: { value: 110000, cities: [{ city: 'Fort Sterling', avgPrice: 125000, avgDailyVolume: 1.6 }, { city: 'Martlock', avgPrice: 118000, avgDailyVolume: 1 }], totalDailyVolume: 2.6, daysToSellBatch: 1923 } },
      enchantAfterCraft: { targetLevel: 2, capped: false, baseSource: 'buy', baseBuy: { city: 'Brecilien', price: 99991 }, baseCraftCostPerUnit: 120000, baseCostPerUnit: 99991, stepsCostPerUnit: 6912,
        steps: [{ level: 1, materialId: 'T4_RUNE', materialName: 'Руна (знаток)', count: 96, cheapestCity: 'Brecilien', cheapestPrice: 5, cost: 480 }, { level: 2, materialId: 'T4_SOUL', materialName: 'Душа (знаток)', count: 96, cheapestCity: 'Brecilien', cheapestPrice: 67, cost: 6432 }] },
      teleport: null,
    } });
  });
  await page.goto('/craft.html');
  await page.locator('#craft-search').fill('авалонский плащ');
  await page.locator('#craft-suggestions .suggestion-item').first().click();
  await page.locator('#craft-enchant').selectOption('2');
  await page.locator('#craft-enchant-after').check();
  await page.locator('#craft-sell-threshold').fill('110000');
  await page.locator('#craft-run').click();
  await expect(page.locator('#craft-result .enchant-after')).toContainText('Руна (знаток) × 480 000'); // 96 на вещь × 5000 шт
  // материалы зачарования — в общей таблице материалов рядом с сырьём рецепта
  await expect(page.locator('#craft-result table.craft-recipe-table').first()).toContainText('Руна (знаток)');
  await expect(page.locator('#craft-result .enchant-after')).toContainText('покупка дешевле крафта');
  await expect(page.locator('#craft-result .patient-sell')).toContainText('Города с ценой не ниже 110 000');
  expect(query.get('enchantAfterCraft')).toBe('true');
  expect(query.get('sellThreshold')).toBe('110000');
});

test('качество: сравнение всех 5 качеств и разбивка по городам видны без порога', async ({ page }) => {
  await page.route('**/api/craft-calc*', (route) => route.fulfill({ json: {
    itemId: 'T4_CAPEITEM_AVALON', enchant: 2, quality: 1, quantity: 100, rrrPreset: { id: 'none', label: 'Без бонусов', bonus: 0, rrr: 0 },
    cities: ['Fort Sterling', 'Thetford'], hasAllMaterialPrices: true, materialCostPerUnit: 90000, effectiveCostPerUnit: 90000, totalCost: 9000000,
    recipe: [], sellPrices: [], bestSell: null, taxRate: 0.08, netSellPrice: null, profitPerUnit: null, totalProfit: null, enchantAfterCraft: null, teleport: null,
    patientSell: { days: 7, avgSellPrice: 95058, bestCity: { city: 'Fort Sterling', avgPrice: 95058 }, avgDailyVolume: 1.6, daysToSellBatch: 62, netSellPrice: 87453, profitPerUnit: -2500,
      byCity: [{ city: 'Fort Sterling', avgSellPrice: 95058, avgDailyVolume: 1.6, profitPerUnit: -2500 }, { city: 'Thetford', avgSellPrice: 90000, avgDailyVolume: 0.5, profitPerUnit: -7000 }], cities: [] },
    qualityComparison: [1, 2, 3, 4, 5].map((q) => ({ quality: q, avgSellPrice: 90000 + q * 1000, avgDailyVolume: q === 4 ? 204.7 : 1.5, daysToSellBatch: q === 4 ? 0.5 : 66, profitPerUnit: q * 1000 })),
  } }));
  await page.goto('/craft.html');
  await page.locator('#craft-search').fill('авалонский плащ');
  await page.locator('#craft-suggestions .suggestion-item').first().click();
  await page.locator('#craft-run').click();
  await expect(page.locator('#craft-result .by-city tbody tr')).toHaveCount(2);
  await expect(page.locator('#craft-result .quality-comparison tbody tr')).toHaveCount(5);
  await expect(page.locator('#craft-result .quality-comparison')).toContainText('Отличное ⚡');
});

test('сравнение по тирам: строка переключает тир без нового поиска, зачарование и качество сохраняются', async ({ page }) => {
  const queries = [];
  const tierRow = (id, tier, cost, profit, current) => ({ itemId: id, tier, enchant: 2, enchantCapped: false, hasPrice: true, cost, bestQuality: 4, bestSell: { city: 'Martlock', price: cost + profit }, netSellPrice: cost + profit, profitPerUnit: profit, profitPct: (profit / cost) * 100, isCurrent: current });
  await page.route('**/api/craft-calc*', (route) => {
    const q = new URL(route.request().url()).searchParams;
    queries.push(q);
    const id = q.get('item');
    route.fulfill({ json: {
      itemId: id, enchant: Number(q.get('enchant')), quality: Number(q.get('quality')), quantity: 1, rrrPreset: { id: 'none', label: 'Без бонусов', bonus: 0, rrr: 0 },
      cities: ['Martlock'], hasAllMaterialPrices: true, materialCostPerUnit: 1000, effectiveCostPerUnit: 1000, totalCost: 1000, recipe: [], sellPrices: [], bestSell: null,
      taxRate: 0.08, netSellPrice: null, profitPerUnit: null, totalProfit: null, patientSell: null, enchantAfterCraft: null, teleport: null,
      tierComparison: [tierRow('T4_MAIN_SWORD', 4, 8000, -1500, id === 'T4_MAIN_SWORD'), tierRow('T5_MAIN_SWORD', 5, 25000, 4000, id === 'T5_MAIN_SWORD')],
    } });
  });
  await page.goto('/craft.html');
  await page.locator('#craft-search').fill('палаш');
  await page.locator('#craft-suggestions .suggestion-item', { hasText: 'T4' }).first().click();
  await page.locator('#craft-enchant').selectOption('2');
  await page.locator('#craft-quality').selectOption('4');
  await page.locator('#craft-run').click();
  await expect(page.locator('#craft-result .tier-comparison tbody tr')).toHaveCount(2);

  await page.locator('#craft-result tr.tier-row[data-item-id="T5_MAIN_SWORD"]').click();
  await expect.poll(() => queries.length).toBe(2);
  expect(queries[1].get('item')).toBe('T5_MAIN_SWORD');
  expect(queries[1].get('enchant')).toBe('2');
  expect(queries[1].get('quality')).toBe('4');
  await expect(page.locator('#craft-tier-switch')).toHaveValue('T5_MAIN_SWORD');

  await page.locator('#craft-tier-switch').selectOption('T4_MAIN_SWORD');
  await expect.poll(() => queries.length).toBe(3);
  expect(queries[2].get('item')).toBe('T4_MAIN_SWORD');
});

test('скан маржи и ликвидности: параметры в запросе, результаты в таблице, «в калькулятор» переносит связку', async ({ page }) => {
  let scanQuery = null;
  let calcQuery = null;
  await page.route('**/api/craft-margin-opportunities*', (route) => {
    scanQuery = new URL(route.request().url()).searchParams;
    route.fulfill({ json: { enchantMode: 'after', liquidity: 'best', days: 7, taxRate: 0.08, premiumPrice: 28000000, scanned: 2365, results: [
      { itemId: 'T4_2H_BOW', enchant: 2, quality: 4, cost: 40000, avgSellPrice: 60000, dailyVolume: 12.5, sellCities: ['Martlock'], profitPerUnit: 15200, profitPct: 38, dailyProfit: 190000, premiumDays: 147, score: 200 },
      { itemId: 'T4_CAPE', enchant: 0, quality: 1, cost: 2700, avgSellPrice: 22000, dailyVolume: 300, sellCities: ['Martlock', 'Lymhurst'], profitPerUnit: 17000, profitPct: 600, dailyProfit: 5100000, premiumDays: 5, score: 900 },
    ] } });
  });
  await page.route('**/api/craft-calc*', (route) => { calcQuery = new URL(route.request().url()).searchParams; route.fulfill({ status: 404, json: { error: 'нет' } }); });
  await page.goto('/craft.html');
  await page.locator('#margin-enchant-mode').selectOption('after');
  await page.locator('#margin-liquidity').selectOption('best');
  await page.locator('#margin-run').click();
  await expect(page.locator('#margin-result tbody tr')).toHaveCount(2);
  expect(scanQuery.get('enchantMode')).toBe('after');
  expect(scanQuery.get('liquidity')).toBe('best');
  await page.locator('#margin-result .scan-add-btn').first().click();
  await expect.poll(() => calcQuery).not.toBeNull();
  expect(calcQuery.get('item')).toBe('T4_2H_BOW');
  expect(calcQuery.get('enchant')).toBe('2');
  expect(calcQuery.get('quality')).toBe('4');
  expect(calcQuery.get('enchantAfterCraft')).toBe('true');
});
