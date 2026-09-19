const { test, expect } = require('@playwright/test');
const { openTool } = require('./helpers');

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
  await expect(page.locator('#craft-result li.craft-step:nth-child(2) .craft-summary').first()).toContainText('После налога с продажи (8%)');
  await expect(page.locator('#craft-result li.craft-step:nth-child(2) .craft-summary').first()).toContainText('1 200');
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
  await openTool(page, 'Ленивый крафтер');
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

test('время закупки сырья: колонка «Дней на закупку» и весь цикл рядом со временем продажи', async ({ page }) => {
  await page.route('**/api/craft-calc*', (route) => route.fulfill({ json: {
    itemId: 'T4_CAPEITEM_AVALON', enchant: 0, quality: 1, quantity: 100, marketShare: 0.25, rrrPreset: { id: 'none', label: 'Без бонусов', bonus: 0, rrr: 0 },
    cities: ['Martlock'], hasAllMaterialPrices: true, materialCostPerUnit: 90000, effectiveCostPerUnit: 90000, totalCost: 9000000,
    recipe: [{ resource: 'T4_CAPEITEM_AVALON_BP', resourceName: 'Герб Авалона', queryId: 'T4_CAPEITEM_AVALON_BP', enchanted: false, count: 1, cheapestCity: 'Martlock', cheapestPrice: 20000, cityPrices: [] },
             { resource: 'T4_CAPE', resourceName: 'Плащ', queryId: 'T4_CAPE', enchanted: false, count: 1, cheapestCity: 'Martlock', cheapestPrice: 2000, cityPrices: [] }],
    sellPrices: [], bestSell: null, taxRate: 0.08, netSellPrice: null, profitPerUnit: null, totalProfit: null, enchantAfterCraft: null, teleport: null,
    patientSell: { days: 7, marketShare: 0.25, avgSellPrice: 125000, bestCity: { city: 'Martlock', avgPrice: 125000 }, avgDailyVolume: 20, daysToSellBatch: 20.3, netSellPrice: 115000, profitPerUnit: 25000, byCity: [], cities: [] },
    acquire: { days: 22.5, cycleDays: 42.8, bottleneckResource: 'T4_CAPEITEM_AVALON_BP', byResource: [
      { resource: 'T4_CAPEITEM_AVALON_BP', resourceName: 'Герб Авалона', needed: 100, avgDailyVolume: 4.4, daysToAcquire: 22.5 },
      { resource: 'T4_CAPE', resourceName: 'Плащ', needed: 100, avgDailyVolume: 200, daysToAcquire: 0.5 }] },
  } }));
  await page.goto('/craft.html');
  await page.locator('#craft-search').fill('авалонский плащ');
  await page.locator('#craft-suggestions .suggestion-item').first().click();
  await page.locator('#craft-run').click();
  await expect(page.locator('#craft-result .craft-recipe-table').first()).toContainText('Дней на закупку');
  await expect(page.locator('#craft-result .craft-recipe-table').first()).toContainText('22.5 дн. 🐢');
  await expect(page.locator('#craft-result .patient-sell')).toContainText('Весь цикл: закупка + продажа');
  await expect(page.locator('#craft-result .patient-sell')).toContainText('42.8 дн.');
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
  await page.route('**/api/unified-scan*', (route) => {
    scanQuery = new URL(route.request().url()).searchParams;
    route.fulfill({ json: { mode: 'patient', includeMaterials: false, enchantMode: 'after', liquidity: 'best', days: 7, capital: 500000, minDays: 1, quantity: 1000, taxRate: 0.08, setupFeeRate: 0.025, premiumPrice: 28000000, scanned: 2365,
      enchantRange: '.0–.3', rrrOptions: { gearRate: 0.248, gearRrr: null, gearRrrCustom: null },
      jug: { lastPricePass: Date.now() - 120000, lastHistoryPass: Date.now() - 300000, lastFullPass: null, oldestPriceAgeMinutes: 5 }, results: [
      { kind: 'gear', itemId: 'T4_2H_BOW', enchant: 2, quality: 4, tier: 4, cost: 40000, avgSellPrice: 60000, dailyVolume: 12.5, yourDailyVolume: 3.1, sellCities: ['Martlock'], profitPerUnit: 15200, profitPct: 38, dailyProfit: 47000, premiumDays: 147, daysToAcquire: 2, daysToSell: 8, totalDays: 10, cycleDays: 10, effectiveDays: 10, cappedByMinDays: false, positionCost: 500000, quantity: 1000, freshMinutes: 12, rankScore: 47000, tradeHours: 6, confidence: 6 / 26 },
      { kind: 'gear', itemId: 'T4_CAPE', enchant: 0, quality: 1, tier: 4, cost: 2700, avgSellPrice: 22000, dailyVolume: 300, yourDailyVolume: 75, sellCities: ['Martlock', 'Lymhurst'], profitPerUnit: 17000, profitPct: 600, dailyProfit: 1275000, premiumDays: 22, daysToAcquire: 1, daysToSell: 13, totalDays: 14, cycleDays: 14, effectiveDays: 14, cappedByMinDays: false, positionCost: 500000, quantity: 1000, freshMinutes: 30, rankScore: 900000, tradeHours: 300, confidence: 300 / 320 },
    ] } });
  });
  await page.route('**/api/craft-calc*', (route) => { calcQuery = new URL(route.request().url()).searchParams; route.fulfill({ status: 404, json: { error: 'нет' } }); });
  await page.goto('/craft.html');
  await openTool(page, 'Скан маржи и ликвидности');
  await expect(page.locator('#margin-enchant-after')).toBeChecked();                 // «зачаровать после крафта» — галочка, по умолчанию включена
  await expect(page.locator('#margin-liquidity')).toHaveCount(0);                    // выпадающего «ликвидность» больше нет
  await page.locator('#margin-run').click();
  await expect(page.locator('#margin-result tbody tr')).toHaveCount(2);
  expect(scanQuery.get('mode')).toBe('patient');                                   // по умолчанию терпеливая продажа
  expect(scanQuery.get('enchantMode')).toBe('after');
  expect(scanQuery.get('liquidity')).toBe('sum');                                  // оборот — всегда сумма по всем городам
  await expect(page.locator('#margin-result')).toContainText('Кувшин: цены обновлены');
  await page.locator('#margin-result .scan-add-btn').first().click();
  await expect.poll(() => calcQuery).not.toBeNull();
  expect(calcQuery.get('item')).toBe('T4_2H_BOW');
  expect(calcQuery.get('enchant')).toBe('2');
  expect(calcQuery.get('quality')).toBe('4');
  expect(calcQuery.get('quantity')).toBe('1');                                     // скан считает одну штуку — количество вводится в калькуляторе
  expect(calcQuery.get('enchantAfterCraft')).toBe('true');
});

test('скан маржи: без капитала, минимума дней и доли рынка — профит/шт; мгновенный режим прячет ликвидность, в запросе нет сырья (оно ушло в скан рефайна на странице «Рефайн»)', async ({ page }) => {
  let scanQuery = null;
  await page.route('**/api/unified-scan*', (route) => {
    scanQuery = new URL(route.request().url()).searchParams;
    route.fulfill({ json: { mode: 'instant', enchantMode: 'direct', liquidity: 'sum', days: 7, capital: 500000, minDays: 1, quantity: null, taxRate: 0.08, setupFeeRate: 0, premiumPrice: 28000000, scanned: 40,
      enchantRange: '.0–.3', rrrOptions: { gearRate: 0.248, gearRrr: null, gearRrrCustom: null },
      jug: { lastPricePass: Date.now() - 60000, lastHistoryPass: null, lastFullPass: null, oldestPriceAgeMinutes: 1 }, results: [
      { kind: 'gear', itemId: 'T4_2H_BOW', enchant: 0, quality: 1, tier: 4, cost: 900, avgSellPrice: 1300, dailyVolume: 400, yourDailyVolume: 100, sellCities: ['Martlock'], profitPerUnit: 250, profitPct: 28, dailyProfit: 25000, premiumDays: 1120, daysToAcquire: null, daysToSell: null, totalDays: null, cycleDays: 1, effectiveDays: 1, cappedByMinDays: true, positionCost: 500000, quantity: 400, freshMinutes: 20, rankScore: 25000, tradeHours: 80, confidence: 0.8 },
    ] } });
  });
  await page.goto('/craft.html');
  await openTool(page, 'Скан маржи и ликвидности');
  await expect(page.locator('#margin-capital')).toHaveCount(0);                    // ни капитала, ни минимума дней, ни «часов в день», ни доли рынка
  await expect(page.locator('#margin-min-days')).toHaveCount(0);
  await expect(page.locator('#margin-market-share')).toHaveCount(0);
  await page.locator('#margin-mode').selectOption('instant');
  await expect(page.locator('#margin-include-materials')).toHaveCount(0);          // сырьё и рефайн — на странице «Рефайн»
  await page.locator('#margin-run').click();
  await expect(page.locator('#margin-result tbody tr')).toHaveCount(1);
  expect(scanQuery.get('mode')).toBe('instant');
  expect(scanQuery.has('capital')).toBe(false);
  expect(scanQuery.has('minDays')).toBe(false);
  expect(scanQuery.has('marketShare')).toBe(false);
  expect(scanQuery.has('includeMaterials')).toBe(false);
});

test('потолок и полоса цены живут в калькуляторе: поля уходят в запрос, результат — в блоке Sell Order', async ({ page }) => {
  let query = null;
  await page.route('**/api/craft-calc*', (route) => {
    query = new URL(route.request().url()).searchParams;
    route.fulfill({ json: {
      itemId: 'T4_MAIN_SWORD', enchant: 0, quality: 1, quantity: 1000, marketShare: 0.25, rrrPreset: { id: 'none', label: 'Без бонусов', bonus: 0, rrr: 0 },
      cities: ['Martlock'], hasAllMaterialPrices: true, materialCostPerUnit: 60000, effectiveCostPerUnit: 68000, totalCost: 68000000,
      recipe: [], sellPrices: [], bestSell: null, taxRate: 0.08, netSellPrice: null, profitPerUnit: null, totalProfit: null, enchantAfterCraft: null, teleport: null,
      patientSell: { days: 7, marketShare: 0.25, avgSellPrice: 121000, bestCity: { city: 'Thetford', avgPrice: 124000 }, avgDailyVolume: 3.8, daysToSellBatch: 1000, netSellPrice: 111320, profitPerUnit: 43320, byCity: [], cities: [] },
      sellPlan: { ceiling: 90000, withinCeiling: true, sellLow: 110000, sellHigh: 130000, netLow: 101200, netHigh: 119600, profitLow: 33200, profitHigh: 51600, totalLow: 33200000, totalHigh: 51600000 },
    } });
  });
  await page.goto('/craft.html');
  await expect(page.locator('#bulk-panel')).toHaveCount(0);       // отдельного «Плана крупной партии» больше нет
  await page.locator('#craft-search').fill('палаш');
  await page.locator('#craft-suggestions .suggestion-item').first().click();
  await page.locator('#craft-extra summary').click();
  await page.locator('#craft-ceiling').fill('90000');
  await page.locator('#craft-sell-low').fill('110000');
  await page.locator('#craft-sell-high').fill('130000');
  await page.locator('#craft-run').click();
  await expect(page.locator('#craft-result .patient-sell')).toContainText('Потолок себестоимости 90 000: проходит?');
  await expect(page.locator('#craft-result .patient-sell')).toContainText('110 000—130 000');
  expect(query.get('ceiling')).toBe('90000');
  expect(query.get('sellLow')).toBe('110000');
  expect(query.get('sellHigh')).toBe('130000');
});

test('аккордеон ★ бета: калькулятор на виду, инструменты свёрнуты и раскрываются по клику', async ({ page }) => {
  await page.goto('/craft.html');
  await expect(page.locator('#craft-search')).toBeVisible();                       // калькулятор — всегда открыт
  await expect(page.locator('.beta-star')).toBeVisible();
  const tools = page.locator('details.tool-accordion');
  await expect(tools).toHaveCount(2);                                          // скан маржи и ленивый крафтер (скан партий и «что крафтить» слиты в общий скан)
  await expect(page.locator('#lazy-run')).toBeHidden();                            // ленивый крафтер свёрнут
  await openTool(page, 'Ленивый крафтер');
  await expect(page.locator('#lazy-run')).toBeVisible();
});

test('план продажи по городам: партия делится пропорционально обороту, «Дней здесь» сходится у всех городов', async ({ page }) => {
  await page.route('**/api/craft-calc*', (route) => route.fulfill({ json: {
    itemId: 'T4_MAIN_SWORD', enchant: 0, quality: 1, quantity: 120, marketShare: 0.5, rrrPreset: { id: 'none', label: 'Без бонусов', bonus: 0, rrr: 0 },
    cities: ['Lymhurst', 'Martlock'], hasAllMaterialPrices: true, materialCostPerUnit: 1000, effectiveCostPerUnit: 1000, totalCost: 120000, recipe: [], sellPrices: [],
    bestSell: null, taxRate: 0.08, netSellPrice: null, profitPerUnit: null, totalProfit: null, enchantAfterCraft: null, teleport: null,
    patientSell: { days: 7, marketShare: 0.5, avgSellPrice: 3000, bestCity: { city: 'Lymhurst', avgPrice: 3000 }, avgDailyVolume: 120, daysToSellBatch: 2, netSellPrice: 2760, profitPerUnit: 1760,
      byCity: [{ city: 'Lymhurst', avgSellPrice: 3000, avgDailyVolume: 100, profitPerUnit: 1760 }, { city: 'Martlock', avgSellPrice: 2900, avgDailyVolume: 20, profitPerUnit: 1670 }], cities: [] },
  } }));
  await page.goto('/craft.html');
  await page.locator('#craft-search').fill('палаш');
  await page.locator('#craft-suggestions .suggestion-item').first().click();
  await page.locator('#craft-run').click();
  await page.locator('#sale-strategy').selectOption('even');                       // эти проверки — про равномерное распределение (по умолчанию теперь «максимизировать профит»)
  const rows = page.locator('#craft-result .by-city tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('input.plan-qty')).toHaveValue('100');  // Lymhurst: 120 × 100/120 = 100 шт
  await expect(rows.nth(1).locator('input.plan-qty')).toHaveValue('20');   // Martlock: 20 шт
  const days = await rows.locator('td:nth-child(7)').allTextContents();
  expect(new Set(days).size).toBe(1);                         // у всех городов один срок: 100/(100·0.5) = 2 дн.
  expect(days[0]).toContain('2.0');
});

test('материалы: количество к закупке с учётом возврата, «без возврата» у герба и итоговая стоимость сырья', async ({ page }) => {
  await page.route('**/api/craft-calc*', (route) => route.fulfill({ json: {
    itemId: 'T4_CAPEITEM_AVALON', enchant: 0, quality: 1, quantity: 100, marketShare: 0.25, rrrPreset: { id: 'city_bonus', label: 'Город с бонусом', bonus: 58, rrr: 0.367 },
    cities: ['Martlock'], hasAllMaterialPrices: true, materialCostPerUnit: 1000, effectiveCostPerUnit: 700, totalCost: 70000,
    recipe: [
      { resource: 'T4_METALBAR', resourceName: 'T4 Слитки (IV)', queryId: 'T4_METALBAR', enchanted: false, count: 16, returnable: true, neededToBuy: 1013, cheapestCity: 'Martlock', cheapestPrice: 100, cityPrices: [] },
      { resource: 'T4_CAPEITEM_AVALON_BP', resourceName: 'Герб Авалона', queryId: 'T4_CAPEITEM_AVALON_BP', enchanted: false, count: 1, returnable: false, neededToBuy: 100, cheapestCity: 'Martlock', cheapestPrice: 2000, cityPrices: [] },
    ],
    sellPrices: [], bestSell: null, taxRate: 0.08, netSellPrice: null, profitPerUnit: null, totalProfit: null, patientSell: null, enchantAfterCraft: null, teleport: null,
  } }));
  await page.goto('/craft.html');
  await page.locator('#craft-search').fill('авалонский плащ');
  await page.locator('#craft-suggestions .suggestion-item').first().click();
  await page.locator('#craft-run').click();
  const table = page.locator('#craft-result .craft-recipe-table').first();
  await expect(table.locator('tbody tr').first()).toContainText('1 013');            // к закупке после возврата
  await expect(table.locator('tbody tr').first()).toContainText('по рецепту 1 600'); // 16 × 100
  await expect(table.locator('tbody tr').nth(1)).toContainText('без возврата');
  await expect(table.locator('tfoot')).toContainText('301 300');                    // 1013·100 + 100·2000
});

test('многогородовой план: допуск цены уходит в запрос, план закупки и продажи показываются с допуском по городам', async ({ page }) => {
  let query = null;
  await page.route('**/api/craft-calc*', (route) => {
    query = new URL(route.request().url()).searchParams;
    route.fulfill({ json: {
      itemId: 'T4_MAIN_SWORD', enchant: 0, quality: 1, quantity: 1000, marketShare: 0.25, priceTolerance: 0.05, rrrPreset: { id: 'none', label: 'Без бонусов', bonus: 0, rrr: 0 },
      cities: ['Martlock'], hasAllMaterialPrices: true, materialCostPerUnit: 1000, effectiveCostPerUnit: 1000, totalCost: 1000000,
      recipe: [{ resource: 'T4_LEATHER', resourceName: 'T4 Кожа (IV)', queryId: 'T4_LEATHER', enchanted: false, count: 8, returnable: true, neededToBuy: 8000, cheapestCity: 'Bridgewatch', cheapestPrice: 373, cityPrices: [] }],
      sellPrices: [], bestSell: null, taxRate: 0.08, netSellPrice: null, profitPerUnit: null, totalProfit: null, enchantAfterCraft: null, teleport: null,
      acquire: { days: 3.2, cycleDays: 12.2, bottleneckResource: 'T4_LEATHER', priceTolerance: 0.05, overpayTotal: 1000, byResource: [{ resource: 'T4_LEATHER', resourceName: 'T4 Кожа (IV)', needed: 8000, avgDailyVolume: 10, daysToAcquire: 3.2,
        plan: { bestPrice: 373, avgPrice: 391, overpayPct: 4.8, totalDays: 3.2, cycleDays: 3.2, effectiveDays: 3.2, cappedByMinDays: false, positionCost: 500000, excluded: [{ city: 'Lymhurst', reason: 'слишком тонкий рынок для надёжной цены' }],
          cities: [{ city: 'Bridgewatch', avgPrice: 373, avgDailyVolume: 2, tolerance: 0.05, qty: 1427, days: 3.2 }, { city: 'Martlock', avgPrice: 397, avgDailyVolume: 8, tolerance: 0.15, qty: 6573, days: 3.2 }] } }] },
      patientSell: { days: 7, marketShare: 0.25, avgSellPrice: 5000, bestCity: { city: 'Lymhurst', avgPrice: 5100 }, avgDailyVolume: 12, daysToSellBatch: 9, netSellPrice: 4600, profitPerUnit: 3600,
        byCity: [{ city: 'Lymhurst', avgSellPrice: 5100, avgDailyVolume: 10, profitPerUnit: 3700 }, { city: 'Thetford', avgSellPrice: 2500, avgDailyVolume: 2, profitPerUnit: 1000 }], cities: [],
        plan: { bestPrice: 5100, avgPrice: 5100, overpayPct: 0, totalDays: 9, cycleDays: 9, effectiveDays: 9, cappedByMinDays: false, positionCost: 500000, excluded: [{ city: 'Thetford', reason: 'цена хуже лучшей на 51.0% при допуске 5.0%' }],
          cities: [{ city: 'Lymhurst', avgPrice: 5100, avgDailyVolume: 10, tolerance: 0.05, qty: 1000, days: 9 }] } },
    } });
  });
  await page.goto('/craft.html');
  await page.locator('#craft-search').fill('палаш');
  await page.locator('#craft-suggestions .suggestion-item').first().click();
  await page.locator('#craft-price-tolerance').fill('8');
  await page.locator('#craft-run').click();
  expect(query.get('priceTolerance')).toBe('8');
  const plan = page.locator('#craft-acquire-table');
  await expect(plan).toContainText('+4.8% к лучшей цене');
  await expect(plan).toContainText('Martlock: 6 573 шт');
  await expect(plan).toContainText('допуск 15%');
  await expect(plan.locator('tfoot')).toContainText('Итого на план закупки');
  await expect(page.locator('#craft-result .by-city')).toContainText('Вне автоплана: Thetford');
});

test('ручной план продажи: ввод количества в город пересчитывает срок, цену и профит на лету; «Сбросить» возвращает автоплан', async ({ page }) => {
  await page.route('**/api/craft-calc*', (route) => route.fulfill({ json: {
    itemId: 'T4_MAIN_SWORD', enchant: 0, quality: 1, quantity: 100, marketShare: 0.5, rrrPreset: { id: 'none', label: 'Без бонусов', bonus: 0, rrr: 0 },
    cities: ['Lymhurst', 'Martlock'], hasAllMaterialPrices: true, materialCostPerUnit: 1000, effectiveCostPerUnit: 1000, totalCost: 100000, recipe: [], sellPrices: [],
    bestSell: null, taxRate: 0, netSellPrice: null, profitPerUnit: null, totalProfit: null, enchantAfterCraft: null, teleport: null,
    acquire: { days: 3, cycleDays: 5, bottleneckResource: 'X', byResource: [] },
    patientSell: { days: 7, marketShare: 0.5, avgSellPrice: 3000, bestCity: { city: 'Lymhurst', avgPrice: 3000 }, avgDailyVolume: 30, daysToSellBatch: 3.3, netSellPrice: 3000, profitPerUnit: 2000,
      byCity: [{ city: 'Lymhurst', avgSellPrice: 3000, avgDailyVolume: 20, profitPerUnit: 2000 }, { city: 'Martlock', avgSellPrice: 2000, avgDailyVolume: 10, profitPerUnit: 1000 }], cities: [] },
  } }));
  await page.goto('/craft.html');
  await page.locator('#craft-search').fill('палаш');
  await page.locator('#craft-suggestions .suggestion-item').first().click();
  await page.locator('#craft-run').click();
  const summary = page.locator('#craft-result .plan-summary');
  await expect(summary).toContainText('100 из 100 шт');
  // автоплан: 67 / 33 шт; вручную кладём всё в Lymhurst: 100 шт при 20·0.5 = 10 в день → 10 дн., цена 3000, профит 2000
  await page.locator('input.plan-qty[data-city="Lymhurst"]').fill('100');
  await page.locator('input.plan-qty[data-city="Martlock"]').fill('0');
  await expect(summary).toContainText('Срок распродажи по плану: 10.0 дн.');
  await expect(summary).toContainText('весь цикл (закупка 3.0 дн. + продажа): 13.0 дн.');
  await expect(summary).toContainText('200 000');                     // итого 2000 × 100
  await expect(page.locator('input.plan-qty[data-city="Lymhurst"]')).toHaveClass(/is-manual/);
  // рассинхрон суммы с партией предупреждается
  await page.locator('input.plan-qty[data-city="Martlock"]').fill('50');
  await expect(summary).toContainText('150 из 100 шт');
  await expect(summary).toContainText('сумма плана не равна партии');
  await page.locator('.plan-reset').click();
  await expect(summary).toContainText('100 из 100 шт');
  await expect(page.locator('.plan-reset')).toHaveCount(0);
});

test('доля рынка и период истории: можно вписать своё значение — оно уходит в запрос (доля как 0..1)', async ({ page }) => {
  let query = null;
  await page.route('**/api/craft-calc*', (route) => { query = new URL(route.request().url()).searchParams; route.fulfill({ status: 404, json: { error: 'нет' } }); });
  await page.goto('/craft.html');
  await page.locator('#craft-search').fill('меч');
  await page.locator('#craft-suggestions .suggestion-item').first().click();
  await page.locator('#craft-market-share').selectOption('__custom__');
  await page.locator('#craft-market-share ~ .custom-value input').fill('15');
  await page.locator('#craft-extra summary').click();
  await page.locator('#craft-days').selectOption('__custom__');
  await page.locator('#craft-days ~ .custom-value input').fill('10д');
  await expect(page.locator('#craft-price-tolerance')).toHaveValue('2');   // допуск по умолчанию 2%
  await page.locator('#craft-run').click();
  await expect.poll(() => query).not.toBeNull();
  expect(query.get('marketShare')).toBe('0.15');
  expect(query.get('days')).toBe('10');
  expect(query.get('priceTolerance')).toBe('2');
});

test('чекбоксы городов в плане продажи: включение/выключение города пересчитывает распределение и срок автоматически', async ({ page }) => {
  await page.route('**/api/craft-calc*', (route) => route.fulfill({ json: {
    itemId: 'T4_MAIN_SWORD', enchant: 0, quality: 1, quantity: 100, marketShare: 1, rrrPreset: { id: 'none', label: 'Без бонусов', bonus: 0, rrr: 0 },
    cities: ['Lymhurst', 'Martlock', 'Thetford'], hasAllMaterialPrices: true, materialCostPerUnit: 1000, effectiveCostPerUnit: 1000, totalCost: 100000, recipe: [], sellPrices: [],
    bestSell: null, taxRate: 0, netSellPrice: null, profitPerUnit: null, totalProfit: null, enchantAfterCraft: null, teleport: null,
    patientSell: { days: 7, marketShare: 1, avgSellPrice: 3000, bestCity: { city: 'Lymhurst', avgPrice: 3000 }, avgDailyVolume: 40, daysToSellBatch: 2.5, netSellPrice: 3000, profitPerUnit: 2000,
      byCity: [{ city: 'Lymhurst', avgSellPrice: 3000, avgDailyVolume: 20, profitPerUnit: 2000 }, { city: 'Martlock', avgSellPrice: 2000, avgDailyVolume: 10, profitPerUnit: 1000 }, { city: 'Thetford', avgSellPrice: 1500, avgDailyVolume: 10, profitPerUnit: 500 }],
      cities: [], plan: { bestPrice: 3000, avgPrice: 3000, overpayPct: 0, totalDays: 5, cycleDays: 5, effectiveDays: 5, cappedByMinDays: false, positionCost: 500000, excluded: [{ city: 'Martlock', reason: 'ниже допуска' }, { city: 'Thetford', reason: 'ниже допуска' }],
        cities: [{ city: 'Lymhurst', avgPrice: 3000, avgDailyVolume: 20, tolerance: 0.02, qty: 100, days: 5 }] } },
  } }));
  await page.goto('/craft.html');
  await page.locator('#craft-search').fill('палаш');
  await page.locator('#craft-suggestions .suggestion-item').first().click();
  await page.locator('#craft-run').click();
  await page.locator('#sale-strategy').selectOption('even');                       // эти проверки — про равномерное распределение (по умолчанию теперь «максимизировать профит»)
  const summary = page.locator('#craft-result .plan-summary');
  const box = (city) => page.locator(`input.plan-toggle[data-city="${city}"]`);
  await expect(box('Lymhurst')).toBeChecked();
  await expect(box('Martlock')).not.toBeChecked();
  await expect(summary).toContainText('Срок распродажи по плану: 5.0 дн.');       // всё в Lymhurst: 100 / 20
  await box('Martlock').check();                                                   // включили Мартлок: 20 : 10 → 67 / 33 шт
  await expect(page.locator('input.plan-qty[data-city="Lymhurst"]')).toHaveValue('67');
  await expect(page.locator('input.plan-qty[data-city="Martlock"]')).toHaveValue('33');
  await expect(summary).toContainText('Срок распродажи по плану: 3.4 дн.');         // 67/20 = 3.35
  await box('Thetford').check();                                                   // 20 : 10 : 10 → 50 / 25 / 25
  await expect(page.locator('input.plan-qty[data-city="Thetford"]')).toHaveValue('25');
  await expect(summary).toContainText('Срок распродажи по плану: 2.5 дн.');
  await box('Lymhurst').uncheck();                                                 // выключили лучший: 10 : 10 → 50 / 50
  await expect(page.locator('input.plan-qty[data-city="Lymhurst"]')).toHaveValue('0');
  await expect(page.locator('input.plan-qty[data-city="Martlock"]')).toHaveValue('50');
  await expect(summary).toContainText('100 из 100 шт');
  await page.locator('.plan-reset').click();
  await expect(box('Lymhurst')).toBeChecked();
  await expect(box('Martlock')).not.toBeChecked();
});

// Общий мок для проверок реактивности плана продажи: три города с разной маржой и оборотом, автоплан — только Lymhurst.
async function openSalePlanMock(page, { keepDefaultStrategy = false, profitIndexes = null } = {}) {
  await page.route('**/api/craft-calc*', (route) => route.fulfill({ json: {
    itemId: 'T4_MAIN_SWORD', enchant: 0, quality: 1, quantity: 100, marketShare: 1, rrrPreset: { id: 'none', label: 'Без бонусов', bonus: 0, rrr: 0 },
    cities: ['Lymhurst', 'Martlock', 'Thetford'], hasAllMaterialPrices: true, materialCostPerUnit: 1000, effectiveCostPerUnit: 1000, totalCost: 100000, recipe: [], sellPrices: [],
    bestSell: null, taxRate: 0, netSellPrice: null, profitPerUnit: null, totalProfit: null, enchantAfterCraft: null, teleport: null,
    acquire: { days: 1, cycleDays: 6, byResource: [], bottleneckResource: null },
    patientSell: { days: 7, marketShare: 1, avgSellPrice: 3000, bestCity: { city: 'Lymhurst', avgPrice: 3000 }, avgDailyVolume: 40, daysToSellBatch: 5, netSellPrice: 3000, profitPerUnit: 2000,
      byCity: [{ city: 'Lymhurst', avgSellPrice: 3000, avgDailyVolume: 20, profitPerUnit: 2000, profitIndex: profitIndexes ? profitIndexes.Lymhurst : 0 }, { city: 'Martlock', avgSellPrice: 2000, avgDailyVolume: 10, profitPerUnit: 1000, profitIndex: profitIndexes ? profitIndexes.Martlock : 0 }, { city: 'Thetford', avgSellPrice: 1500, avgDailyVolume: 10, profitPerUnit: 500, profitIndex: profitIndexes ? profitIndexes.Thetford : 0 }],
      cities: [], plan: { bestPrice: 3000, avgPrice: 3000, overpayPct: 0, totalDays: 5, cycleDays: 5, effectiveDays: 5, cappedByMinDays: false, positionCost: 500000, excluded: [{ city: 'Martlock', reason: 'ниже допуска' }, { city: 'Thetford', reason: 'ниже допуска' }],
        cities: [{ city: 'Lymhurst', avgPrice: 3000, avgDailyVolume: 20, tolerance: 0.02, qty: 100, days: 5 }] } },
  } }));
  await page.goto('/craft.html');
  await page.locator('#craft-search').fill('палаш');
  await page.locator('#craft-suggestions .suggestion-item').first().click();
  await page.locator('#craft-run').click();
  await page.locator('#craft-patient-section').waitFor();
  if (!keepDefaultStrategy) await page.locator('#sale-strategy').selectOption('even');   // тесты ниже проверяют равномерное распределение
}
const digits = (text) => text.replace(/[^\d-]/g, '');

test('сводка плана продажи реактивна: включение города пересчитывает цену, профит, дни продажи и весь цикл, а не только таблицу', async ({ page }) => {
  await openSalePlanMock(page);
  const section = page.locator('#craft-patient-section');
  const rowValue = async (label) => (await section.locator('.craft-summary-row', { hasText: label }).first().locator('span, strong').last().textContent()).trim();
  expect(digits(await rowValue('Профит / шт'))).toBe('2000');                       // всё в Lymhurst
  expect(await rowValue('Дней на распродажу')).toContain('5.0');
  await page.locator('input.plan-toggle[data-city="Martlock"]').check();            // 67 / 33 шт
  expect(digits(await rowValue('Профит / шт'))).toBe('1670');                       // (3000·67 + 2000·33) / 100 − 1000
  expect(await rowValue('Дней на распродажу')).toContain('3.4');
  expect(await rowValue('Весь цикл')).toMatch(/4\.[34]/);                            // закупка 1 дн. + продажа 3.35 (граница округления)
  expect(digits(await rowValue('Итого на'))).toBe('167000');
  await expect(section.locator('.craft-summary-row', { hasText: 'Итого на 100 шт' })).toBeVisible();
});

test('план продажи: колонка «Профит с города» = профит/шт × штук, отданных городу', async ({ page }) => {
  await openSalePlanMock(page);
  await page.locator('input.plan-toggle[data-city="Martlock"]').check();
  const cell = (city) => page.locator(`tr:has(input.plan-toggle[data-city="${city}"]) td`).nth(7);          // «Профит с города» (после него — «Индекс профита»)
  expect(digits(await cell('Lymhurst').textContent())).toBe('134000');              // 2000 × 67
  expect(digits(await cell('Martlock').textContent())).toBe('33000');               // 1000 × 33
  expect((await cell('Thetford').textContent()).trim()).toBe('—');                  // городу ничего не отдано
});

test('стратегия распределения: по умолчанию максимизировать профит ПО ИНДЕКСУ профита (не по голой марже); «равномерно» делит по обороту', async ({ page }) => {
  // у Thetford самая низкая маржа (500/шт), но лучший индекс (мало риска: ликвидный рынок) — партию первым берёт он
  await openSalePlanMock(page, { keepDefaultStrategy: true, profitIndexes: { Lymhurst: 200, Martlock: 100, Thetford: 300 } });
  const strategy = page.locator('#sale-strategy');
  await expect(strategy).toHaveValue('profit');
  await page.locator('input.plan-toggle[data-city="Martlock"]').check();
  await page.locator('input.plan-toggle[data-city="Thetford"]').check();
  const qty = (city) => page.locator(`input.plan-qty[data-city="${city}"]`);
  // вместимость = оборот × 1 × 2.5 дня × 1.5 = 20→75, 10→37: Thetford 37, Lymhurst 63, Martlock 0
  await expect(qty('Thetford')).toHaveValue('37');
  await expect(qty('Lymhurst')).toHaveValue('63');
  await expect(qty('Martlock')).toHaveValue('0');
  const section = page.locator('#craft-patient-section');
  await expect(section).toContainText('100 из 100 шт');
  await expect(page.locator('#craft-result .by-city thead')).toContainText('Индекс профита');
  await expect(page.locator('tr:has(input.plan-toggle[data-city="Thetford"]) td').last()).toContainText('300');
  await strategy.selectOption('even');                                              // равномерно: 20 : 10 : 10 → 50 / 25 / 25
  await expect(qty('Lymhurst')).toHaveValue('50');
  await expect(qty('Thetford')).toHaveValue('25');
});



test('честность скана: возврат уходит в запрос, диапазон и индекс доверия видны в таблице (шаткая цифра — оранжевая)', async ({ page }) => {
  let scanQuery = null;
  await page.route('**/api/unified-scan*', (route) => {
    scanQuery = new URL(route.request().url()).searchParams;
    route.fulfill({ json: { mode: 'patient', includeMaterials: false, enchantMode: 'direct', liquidity: 'sum', days: 7, capital: 500000, minDays: 1, quantity: 1000, taxRate: 0.08, setupFeeRate: 0.025, premiumPrice: 28000000, scanned: 10,
      enchantRange: '.0–.4', rrrOptions: { gearRate: 0.479, gearRrr: 'city_bonus_focus', gearRrrCustom: null },
      jug: { lastPricePass: Date.now(), lastHistoryPass: Date.now(), lastFullPass: Date.now(), oldestPriceAgeMinutes: 1 }, results: [
      { kind: 'gear', itemId: 'T4_2H_BOW', enchant: 4, quality: 1, tier: 4, cost: 40000, avgSellPrice: 60000, dailyVolume: 12, yourDailyVolume: 3, sellCities: ['Martlock'], profitPerUnit: 15000, profitPct: 38, dailyProfit: 45000, premiumDays: 150, daysToAcquire: 2, daysToSell: 8, totalDays: 10, cycleDays: 10, effectiveDays: 10, cappedByMinDays: false, positionCost: 500000, quantity: 1000, freshMinutes: 12, rankScore: 45000, tradeHours: 3, confidence: 3 / 23 },
      { kind: 'gear', itemId: 'T4_MAIN_SWORD', enchant: 0, quality: 1, tier: 4, cost: 2400, avgSellPrice: 4000, dailyVolume: 300, yourDailyVolume: 75, sellCities: ['Martlock'], profitPerUnit: 1100, profitPct: 45, dailyProfit: 82000, premiumDays: 300, daysToAcquire: 1, daysToSell: 13, totalDays: 14, cycleDays: 14, effectiveDays: 14, cappedByMinDays: false, positionCost: 500000, quantity: 1000, freshMinutes: 30, rankScore: 80000, tradeHours: 300, confidence: 300 / 320 },
    ] } });
  });
  await page.goto('/craft.html');
  await openTool(page, 'Скан маржи и ликвидности');
  await page.locator('#margin-gear-rrr').selectOption('city_bonus_focus');
  await page.locator('#margin-run').click();
  await expect(page.locator('#margin-result tbody tr')).toHaveCount(2);
  await expect(page.locator('#margin-include-awakened')).toHaveCount(0);               // отдельной галочки .4 нет: .4 всегда в переборе
  expect(scanQuery.get('gearRrr')).toBe('city_bonus_focus');
  await expect(page.locator('#margin-result')).toContainText('проверенный диапазон зачарования: .0–.4');
  await expect(page.locator('#margin-result')).toContainText('Возврат при крафте: 47.9%');
  const cells = page.locator('#margin-result tbody tr td[title*="разных часах"]');
  await expect(cells.nth(0)).toContainText('13%');
  await expect(cells.nth(0)).toHaveClass(/scan-stale/);                            // 3 часа торговли — цифра шаткая
  await expect(cells.nth(1)).toContainText('94%');
  await expect(cells.nth(1)).toHaveClass(/scan-spread-hot/);
});

test('возврат при крафте гира: список ставок (24.8% по умолчанию) и «Своя ставка…»; смена ставки после расчёта пересчитывает всё на месте, без запроса', async ({ page }) => {
  const queries = [];
  await page.route('**/api/craft-calc*', (route) => {
    queries.push(new URL(route.request().url()).searchParams);
    route.fulfill({ json: {
      itemId: 'T4_MAIN_SWORD', enchant: 0, quality: 1, quantity: 100, marketShare: 1, materialHours: 24,
      rrrPreset: { id: 'custom', label: 'возврат при крафте: 43.5%', gearRate: 0.435, gearRrr: 'city_focus', gearRrrCustom: null, rrr: 0.435 },
      cities: ['Thetford'], hasAllMaterialPrices: true, materialCostPerUnit: 8000, effectiveCostPerUnit: 4520, totalCost: 452000,
      recipe: [{ resource: 'T4_METALBAR', resourceName: 'T4 Слитки (IV)', queryId: 'T4_METALBAR', enchanted: false, count: 16, returnable: true, rrr: 0.435, cityBonus: false, neededToBuy: 905, cheapestCity: 'Thetford', cheapestPrice: 500, priceSource: 'history', cityPrices: [] }],
      sellPrices: [{ city: 'Thetford', sellMin: null, buyMax: 10000 }], bestSell: { city: 'Thetford', price: 10000, blackMarket: false, taxRate: 0.08 }, taxRate: 0.08, netSellPrice: 9200,
      profitPerUnit: 4680, totalProfit: 468000, patientSell: null,
      baseChoice: { targetLevel: 0, steps: [], baseSource: 'craft', baseBuy: null, baseCraftCostPerUnit: 4520, baseCostPerUnit: 4520 },
    } });
  });
  await page.goto('/craft.html');
  await page.locator('#craft-search').fill('палаш');
  await page.locator('#craft-suggestions .suggestion-item').first().click();
  const select = page.locator('#craft-gear-rrr');
  await expect(select).toHaveValue('city_bonus');                                    // по умолчанию — 24.8%
  await expect(select.locator('option')).toHaveCount(6);                             // 5 пресетов + «Своя ставка…»
  await expect(select.locator('option[value="city_bonus"]')).toContainText('24.8%');
  await expect(page.locator('#craft-royal-bonus')).toHaveCount(0);                   // галочек «Бонус города» / «Фокус» для гира больше нет
  await page.locator('#craft-black-market').check();
  await select.selectOption('city_focus');
  await page.locator('#craft-run').click();
  await expect(page.locator('#craft-result .craft-recipe-table').first()).toContainText('43.5%');
  expect(queries[0].get('gearRrr')).toBe('city_focus');
  expect(queries[0].get('blackMarket')).toBe('true');
  expect(queries[0].has('royalBonus')).toBe(false);
  // вписал свою ставку 10% — себестоимость 16 × 500 × 0.9 = 7 200 без нового запроса
  await select.selectOption('custom');
  await expect(page.locator('#craft-gear-rrr-custom')).toBeVisible();
  await page.locator('#craft-gear-rrr-custom').fill('10');
  await expect(page.locator('#craft-result .craft-summary').first()).toContainText('7 200');
  await expect(page.locator('#craft-result .craft-recipe-table').first()).toContainText('10.0%');
  await expect(page.locator('#craft-result')).not.toContainText('Сбросить свои цены');   // это не ручная цена, кнопки сброса нет
  expect(queries.length).toBe(1);
  await page.locator('#craft-run').click();                                          // новый расчёт уносит свою ставку на сервер
  await expect.poll(() => queries.length).toBe(2);
  expect(queries[1].get('gearRrrCustom')).toBe('10');
});


test('Чёрный Рынок в скане: галочка есть в обоих режимах, уходит в запрос, строка ЧР помечена ⚫ с налогом', async ({ page }) => {
  let scanQuery = null;
  await page.route('**/api/unified-scan*', (route) => {
    scanQuery = new URL(route.request().url()).searchParams;
    route.fulfill({ json: { mode: 'instant', includeMaterials: false, enchantMode: 'direct', liquidity: 'sum', days: 7, capital: 500000, minDays: 1, quantity: null, taxRate: 0.08, setupFeeRate: 0, premiumPrice: 28000000, scanned: 5,
      blackMarket: true, bmTaxRate: 0.105, enchantRange: '.0–.3', rrrOptions: { gearRate: 0.248, gearRrr: null, gearRrrCustom: null },
      jug: { lastPricePass: Date.now(), lastHistoryPass: Date.now(), lastFullPass: Date.now(), oldestPriceAgeMinutes: 1 }, results: [
      { kind: 'gear', itemId: 'T4_MAIN_SWORD', enchant: 0, quality: 1, tier: 4, cost: 2400, avgSellPrice: 4300, sellCities: ['Black Market'], blackMarket: true, sellTaxRate: 0.105, dailyVolume: 40, yourDailyVolume: 10, profitPerUnit: 1448, profitPct: 60, dailyProfit: 14480, premiumDays: 1900, daysToAcquire: null, daysToSell: null, totalDays: null, cycleDays: 1, effectiveDays: 1, cappedByMinDays: true, positionCost: 500000, quantity: 400, freshMinutes: 5, rankScore: 14000, tradeHours: 100, confidence: 100 / 120 },
    ] } });
  });
  await page.goto('/craft.html');
  await openTool(page, 'Скан маржи и ликвидности');
  await expect(page.locator('#margin-black-market')).toBeVisible();                // терпеливо (по умолчанию): ЧР — по средней цене его сделок
  await page.locator('#margin-mode').selectOption('instant');
  await expect(page.locator('#margin-black-market')).toBeVisible();                // мгновенно: в его Buy Order
  await page.locator('#margin-black-market').check();
  await page.locator('#margin-run').click();
  await expect(page.locator('#margin-result tbody tr')).toHaveCount(1);
  expect(scanQuery.get('blackMarket')).toBe('true');
  await expect(page.locator('#margin-result tbody')).toContainText('⚫ Black Market (налог 10.5%)');
  await expect(page.locator('#margin-result')).toContainText('Чёрный Рынок учтён');
});


test('своё время вписывается с единицей: 12ч / 2д переводятся в дни списка «История», голое число не принимается', async ({ page }) => {
  const queries = [];
  await page.route('**/api/craft-calc*', (route) => { queries.push(new URL(route.request().url()).searchParams); route.fulfill({ status: 404, json: { error: 'нет' } }); });
  await page.goto('/craft.html');
  await page.locator('#craft-search').fill('меч');
  await page.locator('#craft-suggestions .suggestion-item').first().click();
  await page.locator('#craft-days').selectOption('__custom__');
  const input = page.locator('#craft-days ~ .custom-value input');
  await expect(input).toHaveAttribute('placeholder', '12ч или 2д');
  await input.fill('12ч');
  await page.locator('#craft-run').click();
  await expect.poll(() => queries.length).toBe(1);
  expect(queries[0].get('days')).toBe('0.5');                                     // 12 часов = 0.5 дня
  await input.fill('2д');
  await page.locator('#craft-run').click();
  await expect.poll(() => queries.length).toBe(2);
  expect(queries[1].get('days')).toBe('2');
  await input.fill('1');                                                          // без единицы — час это или день, не гадаем
  await expect(input).toHaveClass(/invalid/);
  await page.locator('#craft-run').click();
  await expect.poll(() => queries.length).toBe(3);
  expect(queries[2].get('days')).toBe('3');                                       // значение по умолчанию из списка
  await expect(page.locator('.toast-error')).toContainText('Укажи единицу');
  await input.fill('90д');                                                        // больше максимума (30 дней) — обрезается
  await page.locator('#craft-run').click();
  await expect.poll(() => queries.length).toBe(4);
  expect(queries[3].get('days')).toBe('30');
});


test('«в калькулятор» у строки, найденной через Чёрный Рынок, сам включает ЧР в калькуляторе — иначе профита там не видно', async ({ page }) => {
  let calcQuery = null;
  await page.route('**/api/unified-scan*', (route) => route.fulfill({ json: { mode: 'instant', includeMaterials: false, enchantMode: 'direct', liquidity: 'sum', days: 7, capital: 500000, minDays: 1, quantity: null, taxRate: 0.08, setupFeeRate: 0, premiumPrice: 28000000, scanned: 3,
    blackMarket: true, bmTaxRate: 0.105, enchantRange: '.0–.3', rrrOptions: { gearRate: 0.248, gearRrr: null, gearRrrCustom: null },
    jug: { lastPricePass: Date.now(), lastHistoryPass: Date.now(), lastFullPass: Date.now(), oldestPriceAgeMinutes: 1 }, results: [
    { kind: 'gear', itemId: 'T4_CAPEITEM_AVALON', enchant: 0, quality: 2, tier: 4, cost: 72786, avgSellPrice: 161000, sellCities: ['Black Market'], blackMarket: true, sellTaxRate: 0.105, dailyVolume: 9, yourDailyVolume: 2, profitPerUnit: 8621, profitPct: 11.8, dailyProfit: 138793, premiumDays: 200, daysToAcquire: null, daysToSell: null, totalDays: null, cycleDays: 1, effectiveDays: 1, cappedByMinDays: true, positionCost: 500000, quantity: 400, freshMinutes: 5, rankScore: 138000, tradeHours: 40, confidence: 40 / 60 },
  ] } }));
  await page.route('**/api/craft-calc*', (route) => { calcQuery = new URL(route.request().url()).searchParams; route.fulfill({ status: 404, json: { error: 'нет' } }); });
  await page.goto('/craft.html');
  await openTool(page, 'Скан маржи и ликвидности');
  await page.locator('#margin-mode').selectOption('instant');
  await page.locator('#margin-black-market').check();
  await page.locator('#margin-run').click();
  await page.locator('#margin-result .scan-add-btn').first().click();
  await expect.poll(() => calcQuery).not.toBeNull();
  expect(calcQuery.get('blackMarket')).toBe('true');
  await expect(page.locator('#craft-black-market')).toBeChecked();
});


test('скан гира: оборот раскрывается списком городов с ценой; таблица сразу отсортирована по «Профиту рынка/день» по убыванию, дешёвый гир с раздутым % — ниже', async ({ page }) => {
  await page.route('**/api/unified-scan*', (route) => route.fulfill({ json: { mode: 'patient', enchantMode: 'direct', liquidity: 'sum', days: 3, taxRate: 0.08, setupFeeRate: 0.025, scanned: 5,
    enchantRange: '.0–.3', rrrOptions: { gearRate: 0.248, gearRrr: null, gearRrrCustom: null }, refineRate: 0.367,
    jug: { lastPricePass: Date.now(), lastHistoryPass: Date.now(), lastFullPass: Date.now(), oldestPriceAgeMinutes: 1 }, results: [
      // сервер отдаёт по рейтингу (дешёвый T2 с огромным % — первым), клиент сам сортирует по масштабу в серебре
      { kind: 'gear', itemId: 'T2_2H_BOW', enchant: 0, quality: 1, tier: 2, cost: 100, avgSellPrice: 300, dailyVolume: 900, marketDailyVolume: 900, sellCities: ['Martlock'], profitPerUnit: 150, profitPct: 150, marketProfitPerDay: 135000, freshMinutes: 10, rankScore: 1500, tradeHours: 6, confidence: 0.2, byCity: [] },
      { kind: 'gear', itemId: 'T5_2H_BOW', enchant: 0, quality: 1, tier: 5, cost: 20000, avgSellPrice: 30000, dailyVolume: 80, marketDailyVolume: 380, sellCities: ['Martlock', 'Lymhurst'], profitPerUnit: 6000, profitPct: 30, marketProfitPerDay: 480000, freshMinutes: 20, rankScore: 300, tradeHours: 6, confidence: 0.2,
        byCity: [{ city: 'Thetford', dailyVolume: 300, avgPrice: 900, inPlan: false }, { city: 'Martlock', dailyVolume: 50, avgPrice: 30100, inPlan: true }, { city: 'Lymhurst', dailyVolume: 30, avgPrice: 29800, inPlan: true }] },
    ] } }));
  await page.goto('/craft.html');
  await openTool(page, 'Скан маржи и ликвидности');
  await page.locator('#margin-run').click();
  await expect(page.locator('#margin-result tbody tr')).toHaveCount(2);
  await expect(page.locator('#margin-result tbody tr').first()).toContainText('480 000');         // по «Профиту рынка/день» первым — солидный T5, а не T2
  await expect(page.locator('#margin-result thead')).not.toContainText('Профит/день ');
  await expect(page.locator('#margin-result thead')).not.toContainText('Штук');
  await expect(page.locator('#margin-result thead')).not.toContainText('премиум');
  await expect(page.locator('#margin-result thead')).toContainText('Свежесть');
  const first = page.locator('#margin-result tbody tr').first();
  await first.locator('details.city-prices summary').click();
  await expect(first.locator('details.city-prices li').first()).toContainText('Thetford: 300,0/день · цена 900');   // рядом с оборотом города — его цена
  await expect(first.locator('details.city-prices li').first()).toContainText('вне расчёта');
});

test('свои цены: вписал реальную цену сырья и продажи — материалы, себестоимость, профит и города пересчитываются на месте, без запроса', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/craft-calc*', (route) => { requests++; route.fulfill({ json: {
    itemId: 'T4_MAIN_SWORD', enchant: 0, quality: 1, quantity: 10, marketShare: 1, materialHours: 24, rrrPreset: { id: 'custom', label: 'бонус города: нет · Фокус: нет', rrr: 0 },
    cities: ['Martlock'], hasAllMaterialPrices: true, materialCostPerUnit: 2000, effectiveCostPerUnit: 2000, totalCost: 20000,
    recipe: [{ resource: 'T4_METALBAR', resourceName: 'T4 Слитки (IV)', queryId: 'T4_METALBAR', enchanted: false, count: 16, returnable: true, rrr: 0, neededToBuy: 160, cheapestCity: 'Martlock', cheapestPrice: 100, priceSource: 'history', cityPrices: [] },
             { resource: 'T4_LEATHER', resourceName: 'T4 Кожа (IV)', queryId: 'T4_LEATHER', enchanted: false, count: 8, returnable: true, rrr: 0, neededToBuy: 80, cheapestCity: 'Martlock', cheapestPrice: 50, priceSource: 'quote', cityPrices: [] }],
    sellPrices: [{ city: 'Martlock', sellMin: null, buyMax: 3000 }], bestSell: { city: 'Martlock', price: 3000, blackMarket: false, taxRate: 0.08 }, taxRate: 0.08,
    netSellPrice: 2760, profitPerUnit: 760, totalProfit: 7600, baseChoice: { targetLevel: 0, steps: [], baseSource: 'craft', baseBuy: null, baseCraftCostPerUnit: 2000, baseCostPerUnit: 2000 },
    patientSell: { days: 7, marketShare: 1, avgSellPrice: 3000, bestCity: { city: 'Martlock', avgPrice: 3000 }, avgDailyVolume: 20, daysToSellBatch: 0.5, netSellPrice: 2685, profitPerUnit: 685,
      byCity: [{ city: 'Martlock', avgSellPrice: 3000, avgDailyVolume: 20, netPrice: 2685, taxRate: 0.105, profitPerUnit: 685, profitIndex: 100 }],
      cities: [], plan: { strategy: 'maxProfit', bestPrice: 3000, avgPrice: 3000, totalDays: 0.5, excluded: [], netPricePerUnit: 2685, profitPerUnit: 685, cities: [{ city: 'Martlock', avgPrice: 3000, avgDailyVolume: 20, tolerance: null, qty: 10, days: 0.5 }] } },
  } }); });
  await page.goto('/craft.html');
  await page.locator('#craft-search').fill('палаш');
  await page.locator('#craft-suggestions .suggestion-item').first().click();
  await page.locator('#craft-run').click();
  await expect(page.locator('#craft-result')).toContainText('котировка');                    // у кожи сделок нет — помечено
  await expect(page.locator('#craft-result li.craft-step:nth-child(2) .craft-summary').first()).toContainText('760');
  // слитки в игре стоят 150, а не 100: себестоимость 2000 + 16 × 50 = 2800, профит 2760 − 2800 = −40
  await page.locator('#craft-recipe-table input.manual-price[data-res="T4_METALBAR"]').fill('150');
  await expect(page.locator('#craft-result .craft-summary').first()).toContainText('2 800');
  await expect(page.locator('#craft-result')).toContainText('Сбросить свои цены');
  await expect(page.locator('#craft-result .patient-sell')).toContainText(/[−-]115/);        // терпеливый профит города тоже сдвинулся на +800 к себестоимости: 685 − 800
  await page.locator('#manual-sell-price').fill('3500');                                     // продаёшь по 3500: 3500 × 0.92 − 2800 = 420
  await expect(page.locator('#craft-result li.craft-step:nth-child(2) .craft-summary').first()).toContainText('420');
  expect(requests).toBe(1);                                                                  // пересчёт на месте, без нового запроса
  await page.locator('.manual-reset').click();
  await expect(page.locator('#craft-result li.craft-step:nth-child(2) .craft-summary').first()).toContainText('760');
});


test('лог закупок по лотам: вписал купленные стаки — средняя цена, «куплено X из Y» и себестоимость пересчитываются на месте; чекбокс возвращает обычное поле', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/craft-calc*', (route) => { requests++; route.fulfill({ json: {
    itemId: 'T4_MAIN_SWORD', enchant: 0, quality: 1, quantity: 100, marketShare: 1, materialHours: 24,
    rrrPreset: { id: 'custom', label: 'возврат при крафте: 0%', gearRate: 0, gearRrr: 'none', gearRrrCustom: null, rrr: 0 },
    cities: ['Martlock'], hasAllMaterialPrices: true, materialCostPerUnit: 8000, effectiveCostPerUnit: 8000, totalCost: 800000,
    recipe: [{ resource: 'T4_METALBAR', resourceName: 'T4 Слитки (IV)', queryId: 'T4_METALBAR', enchanted: false, count: 16, returnable: true, rrr: 0, cityBonus: false, neededToBuy: 1600, cheapestCity: 'Martlock', cheapestPrice: 500, priceSource: 'history', cityPrices: [] }],
    sellPrices: [], bestSell: null, taxRate: 0.08, netSellPrice: null, profitPerUnit: null, totalProfit: null, patientSell: null,
    baseChoice: { targetLevel: 0, steps: [], baseSource: 'craft', baseBuy: null, baseCraftCostPerUnit: 8000, baseCostPerUnit: 8000 },
  } }); });
  await page.goto('/craft.html');
  await page.locator('#craft-search').fill('палаш');
  await page.locator('#craft-suggestions .suggestion-item').first().click();
  await page.locator('#craft-gear-rrr').selectOption('none');                                 // без возврата — числа проще
  await page.locator('#craft-run').click();
  await expect(page.locator('#craft-recipe-table input.manual-price[data-res="T4_METALBAR"]')).toBeVisible();      // по умолчанию — обычное поле «своя цена»
  await page.locator('#craft-purchase-log').check();
  await expect(page.locator('#craft-recipe-table input.manual-price[data-res="T4_METALBAR"]')).toHaveCount(0);      // вместо него — мини-список стаков
  const log = page.locator('#craft-recipe-table .lot-log');
  await log.locator('.lot-add').click();
  await log.locator('input.lot-qty').nth(0).fill('999');
  await log.locator('input.lot-price').nth(0).fill('432');
  await log.locator('.lot-add').click();
  await log.locator('input.lot-qty').nth(1).fill('877');
  await log.locator('input.lot-price').nth(1).fill('450');
  // (999·432 + 877·450) / 1876 = 440.4; прогресс: 1 876 из 1 600 нужных
  await expect(log.locator('.lot-sum')).toContainText('средняя 440,4');
  await expect(log.locator('.lot-sum')).toContainText('1 876');
  await expect(log.locator('.lot-sum')).toContainText('117%');
  await expect(page.locator('#craft-result .craft-summary').first()).toContainText('7 047');    // 16 × 440.4 ≈ 7 047
  await log.locator('.lot-del').nth(1).click();
  await expect(log.locator('.lot-sum')).toContainText('средняя 432');                             // остался один стак 999 × 432
  await expect(page.locator('#craft-result .craft-summary').first()).toContainText('6 912');
  await page.locator('#craft-purchase-log').uncheck();
  await expect(page.locator('#craft-recipe-table input.manual-price[data-res="T4_METALBAR"]')).toBeVisible();        // чекбокс выключен — таблица вернулась к обычному полю
  await expect(page.locator('#craft-result .craft-summary').first()).toContainText('8 000');       // лоты в расчёт не идут
  expect(requests).toBe(1);
});

test('купить готовый материал или переработать самому: ставка переработки пересчитывает выбор на месте, в колонке «Возврат» — две отдельные ставки', async ({ page }) => {
  let requests = 0;
  const gear = 1 - 1 / 1.33;                                        // 24.8% — умолчание возврата при крафте
  const refine = 1 - 1 / 1.58;                                       // 36.7% — умолчание возврата при переработке (58 очков)
  const refinePrice = 600 * (1 - refine);                            // сырьё + предыдущий тир = 600 на слиток, переработка 36.7% → 379.8
  await page.route('**/api/craft-calc*', (route) => { requests++; route.fulfill({ json: {
    itemId: 'T4_MAIN_SWORD', enchant: 0, quality: 1, quantity: 10, marketShare: 1, materialHours: 24, refineRate: refine,
    rrrPreset: { id: 'custom', label: 'возврат при крафте: 24.8%', gearRate: gear, gearRrr: null, gearRrrCustom: null, rrr: gear },
    cities: ['Martlock'], hasAllMaterialPrices: true, materialCostPerUnit: 16 * refinePrice, effectiveCostPerUnit: 16 * refinePrice * (1 - gear), totalCost: 160 * refinePrice * (1 - gear),
    recipe: [{ resource: 'T4_METALBAR', resourceName: 'T4 Слитки (IV)', queryId: 'T4_METALBAR', enchanted: false, count: 16, returnable: true, rrr: gear, cityBonus: false, neededToBuy: Math.ceil(160 * (1 - gear)),
      cheapestCity: 'Thetford', cheapestPrice: refinePrice, priceSource: 'refine', materialSource: 'refine', buyPrice: 500, buyCity: null, cityPrices: [],
      refineOption: { city: 'Thetford', rate: refine, rawCost: 600, price: refinePrice, components: [{ id: 'T4_ORE', count: 2, price: 250, city: 'Thetford' }, { id: 'T3_METALBAR', count: 1, price: 100, city: 'Martlock' }] } }],
    acquire: { days: 3, cycleDays: null, bottleneckResource: 'T4_METALBAR|T4_ORE', bottleneckParent: 'T4_METALBAR', byResource: [
      { resource: 'T4_METALBAR|T4_ORE', parent: 'T4_METALBAR', source: 'refine', role: 'raw', queryId: 'T4_ORE', resourceName: 'T4 Слитки (IV) — сырьё (переработка)', needed: 203, avgDailyVolume: 100, daysToAcquire: 3,
        plan: { cities: [{ city: 'Thetford', avgPrice: 250, avgDailyVolume: 100, tolerance: 0.02, qty: 203, days: 3 }], excluded: [], overpayPct: 0, totalDays: 3 } },
      { resource: 'T4_METALBAR|T3_METALBAR', parent: 'T4_METALBAR', source: 'refine', role: 'prev', queryId: 'T3_METALBAR', resourceName: 'T4 Слитки (IV) — материал пред. тира (переработка)', needed: 102, avgDailyVolume: 100, daysToAcquire: 1,
        plan: { cities: [{ city: 'Martlock', avgPrice: 100, avgDailyVolume: 100, tolerance: 0.02, qty: 102, days: 1 }], excluded: [], overpayPct: 0, totalDays: 1 } }] },
    sellPrices: [], bestSell: null, taxRate: 0.08, netSellPrice: null, profitPerUnit: null, totalProfit: null, patientSell: null,
    baseChoice: { targetLevel: 0, steps: [], baseSource: 'craft', baseBuy: null, baseCraftCostPerUnit: 16 * refinePrice * (1 - gear), baseCostPerUnit: 16 * refinePrice * (1 - gear) },
  } }); });
  await page.goto('/craft.html');
  await page.locator('#craft-search').fill('палаш');
  await page.locator('#craft-suggestions .suggestion-item').first().click();
  await page.locator('#craft-run').click();
  const row = page.locator('#craft-result .craft-recipe-table tbody tr').first();
  await expect(row).toContainText('выгоднее переработать в Thetford');
  await expect(row).toContainText('36.7% сырьё · 24.8% гир');                                            // две ставки отдельно, без общего процента
  const plan = page.locator('#craft-acquire-table');
  await expect(plan).toContainText('(сырьё → T4 Слитки (IV))');                                 // план закупки: сырьё и полуфабрикат пред. тира, а не готовый слиток
  await expect(plan).toContainText('(полуфабрикат пред. тира → T4 Слитки (IV))');
  await expect(plan.locator('tfoot')).toContainText('Итого на план закупки');
  await expect(plan.locator('tfoot')).toContainText('46 200');                                // 154 × 250 (сырьё) + 77 × 100 (полуфабрикат пред. тира)
  await plan.locator('input.manual-price[data-res="T4_ORE"]').fill('100');                     // своя цена сырья прямо в плане закупки
  await expect(plan.locator('tfoot')).toContainText('23 100');                                 // 154 × 100 + 77 × 100
  await expect(page.locator('#craft-result .craft-summary').first()).toContainText('2 284');    // себестоимость пересчиталась: (2 × 100 + 100) × (1 − 36.7%) × 16 × (1 − 24.8%)
  await plan.locator('input.manual-price[data-res="T4_ORE"]').fill('');
  await expect(plan.locator('tfoot')).toContainText('46 200');
  await expect(page.locator('#craft-result .craft-summary').first()).toContainText('4 568');   // 16 × 379.8 × (1 − 0.2481)
  // ставка переработки 0%: переработка стоит 600 против покупки 500 — берём готовый слиток; себестоимость 16 × 500 × (1 − 0.2481) = 6 015
  await page.locator('#craft-refine-rrr').selectOption('none');
  await expect(row).not.toContainText('выгоднее переработать');
  await expect(plan).not.toContainText('полуфабрикат пред. тира');                                    // источник сменился на «купить» — план строится под него на месте
  await expect(row).toContainText('24.8%');
  await expect(row).not.toContainText('сырьё · ');
  await expect(page.locator('#craft-result .craft-summary').first()).toContainText('6 015');
  await page.locator('#craft-refine-rrr').selectOption('custom');                               // своя ставка 50%: 300 < 500 — снова перерабатываем
  await page.locator('#craft-refine-rrr-custom').fill('50');
  await expect(row).toContainText('50.0% сырьё · 24.8% гир');
  await expect(page.locator('#craft-result .craft-summary').first()).toContainText('3 609');   // 16 × 300 × (1 − 0.2481)
  expect(requests).toBe(1);                                                                    // всё пересчитано на месте, без нового запроса
});

test('скан гира: ставка переработки уходит в запрос, строка с переработанным материалом помечена ♻', async ({ page }) => {
  let scanQuery = null;
  await page.route('**/api/unified-scan*', (route) => {
    scanQuery = new URL(route.request().url()).searchParams;
    route.fulfill({ json: { mode: 'patient', enchantMode: 'after', liquidity: 'best', days: 7, capital: 500000, minDays: 1, taxRate: 0.08, setupFeeRate: 0.025, premiumPrice: 28000000, scanned: 10,
      enchantRange: '.0–.3', rrrOptions: { gearRate: 0.248, gearRrr: null, gearRrrCustom: null }, refineRate: 0.5,
      jug: { lastPricePass: Date.now() - 120000, lastHistoryPass: Date.now() - 300000, lastFullPass: null, oldestPriceAgeMinutes: 5 }, results: [
      { kind: 'gear', itemId: 'T4_MAIN_SWORD', enchant: 0, quality: 1, tier: 4, cost: 3800, avgSellPrice: 9000, dailyVolume: 50, sellCities: ['Martlock'], profitPerUnit: 4000, profitPct: 100, dailyProfit: 100000, premiumDays: 100, daysToAcquire: 1, daysToSell: 2, cycleDays: 3, effectiveDays: 3, cappedByMinDays: false, positionCost: 380000, quantity: 100, freshMinutes: 12, rankScore: 100000, tradeHours: 6, confidence: 0.2,
        refined: [{ id: 'T4_METALBAR', city: 'Thetford', buyPrice: 300, price: 150 }] },
    ] } });
  });
  await page.goto('/craft.html');
  await openTool(page, 'Скан маржи и ликвидности');
  await page.locator('#margin-refine-rrr').selectOption('custom');
  await page.locator('#margin-refine-rrr-custom').fill('50');
  await page.locator('#margin-run').click();
  await expect(page.locator('#margin-result tbody tr')).toHaveCount(1);
  expect(scanQuery.get('refineRrrCustom')).toBe('50');
  await expect(page.locator('#margin-result tbody tr').first()).toContainText('♻ переработка: 1');
  await expect(page.locator('#margin-result .calc-note')).toContainText('возвратом при переработке 50.0%');
});

test('любая правка параметров сама пересчитывает результат через сервер (с задержкой), свои цены при этом сохраняются; ставка возврата — сразу на месте и следом на сервере', async ({ page }) => {
  const queries = [];
  await page.route('**/api/craft-calc*', (route) => {
    const q = new URL(route.request().url()).searchParams;
    queries.push(q);
    const qty = Number(q.get('quantity'));
    route.fulfill({ json: {
      itemId: 'T4_MAIN_SWORD', enchant: 0, quality: 1, quantity: qty, marketShare: 1, materialHours: 24, refineRate: 0.367,
      rrrPreset: { id: 'custom', label: 'возврат при крафте: 0%', gearRate: 0, gearRrr: 'none', gearRrrCustom: null, rrr: 0 },
      cities: ['Martlock'], hasAllMaterialPrices: true, materialCostPerUnit: 1000, effectiveCostPerUnit: 1000, totalCost: 1000 * qty,
      recipe: [{ resource: 'T4_METALBAR', resourceName: 'T4 Слитки (IV)', queryId: 'T4_METALBAR', enchanted: false, count: 10, returnable: true, rrr: 0, neededToBuy: 10 * qty, cheapestCity: 'Martlock', cheapestPrice: 100, priceSource: 'history', cityPrices: [] }],
      sellPrices: [], bestSell: { city: 'Martlock', price: 1500, blackMarket: false, taxRate: 0.08 }, taxRate: 0.08, netSellPrice: 1380, profitPerUnit: 380, totalProfit: 380 * qty, patientSell: null,
      baseChoice: { targetLevel: 0, steps: [], baseSource: 'craft', baseBuy: null, baseCraftCostPerUnit: 1000, baseCostPerUnit: 1000 },
    } });
  });
  await page.goto('/craft.html');
  await page.locator('#craft-search').fill('палаш');
  await page.locator('#craft-suggestions .suggestion-item').first().click();
  await page.locator('#craft-gear-rrr').selectOption('none');
  await page.locator('#craft-quantity').fill('10');
  await page.locator('#craft-run').click();
  await expect(page.locator('.craft-scoreboard')).toContainText('10 000');                       // деньги на весь цикл: 1000 × 10
  await expect(page.locator('.craft-scoreboard')).toContainText('3 800');                        // маржа всего: 380 × 10
  await page.locator('#craft-recipe-table input.manual-price[data-res="T4_METALBAR"]').fill('120');                  // своя цена сырья
  await expect(page.locator('.craft-scoreboard')).toContainText('12 000');                       // 10 шт × (1000 + 10 слитков × 20) — пересчёт на месте
  await page.locator('#craft-quantity').fill('20');
  await expect.poll(() => queries.length).toBe(2);                                               // правка количества сама вызвала пересчёт
  expect(queries[1].get('quantity')).toBe('20');
  await expect(page.locator('#craft-recipe-table input.manual-price[data-res="T4_METALBAR"]')).toHaveValue('120');    // своя цена пережила пересчёт
  await page.locator('#craft-gear-rrr').selectOption('city');                                   // ставка возврата: на месте сразу, а следом честный пересчёт на сервере
  await expect.poll(() => queries.length).toBe(3);
  expect(queries[2].get('gearRrr')).toBe('city');
  await expect(page.locator('#craft-recipe-table input.manual-price[data-res="T4_METALBAR"]')).toHaveValue('120');   // и свои цены на месте
});

test('выбор предмета по категории — ровные колонки: броня по материалу, оружие по игровой классификации (все луки в одной), плащи по городам и фракциям', async ({ page }) => {
  await page.goto('/craft.html');
  const columns = page.locator('#craft-suggestions .suggestion-column');
  await page.locator('#craft-category-filter').selectOption('armor');
  await expect(columns).toHaveCount(3);
  await expect(columns.nth(0)).toContainText('Латная броня');
  await expect(columns.nth(1)).toContainText('Кожаная броня');
  await expect(columns.nth(2)).toContainText('Тканевая броня');
  await page.locator('#craft-category-filter').selectOption('weapon');
  await expect(columns).toHaveCount(20);
  const bows = columns.filter({ hasText: 'Луки' });
  await expect(bows).toHaveCount(1);
  await expect(bows.locator('.suggestion-item', { hasText: 'Боевой лук' }).first()).toBeVisible();   // боевой лук — в той же колонке, что и лук
  await expect(bows.locator('.suggestion-item', { hasText: 'Длинный лук' }).first()).toBeVisible();
  await page.locator('#craft-tier-filter').selectOption('5');                                        // тир сужает колонки
  await expect(bows.locator('.suggestion-item').first()).toContainText('T5');
  await page.locator('#craft-tier-filter').selectOption('');
  await page.locator('#craft-category-filter').selectOption('cape');
  await expect(columns).toHaveCount(15);
  await expect(columns.filter({ hasText: 'Хранителей' })).toHaveCount(1);
  await columns.filter({ hasText: 'Хранителей' }).locator('.suggestion-item').first().click();       // клик по предмету в колонке выбирает его
  await expect(page.locator('#craft-selected')).toContainText('Хранителей');
  await page.locator('#craft-category-filter').selectOption('');
  await page.locator('#craft-search').fill('меч');
  await expect(page.locator('#craft-suggestions .suggestion-column')).toHaveCount(0);                // без категории — прежний плоский список
});

test('иконки: выбранный предмет и строки скана показывают тир, зачарование и качество; в скане по умолчанию 3 дня и «зачаровать после крафта»', async ({ page }) => {
  await page.route('**/api/unified-scan*', (route) => route.fulfill({ json: { mode: 'patient', enchantMode: 'after', liquidity: 'best', days: 3, capital: 1000000, minDays: 1, taxRate: 0.08, setupFeeRate: 0.025, premiumPrice: 28000000, scanned: 1,
    enchantRange: '.0–.3', rrrOptions: { gearRate: 0.248, gearRrr: null, gearRrrCustom: null }, refineRate: 0.367,
    jug: { lastPricePass: Date.now() - 120000, lastHistoryPass: Date.now() - 300000, lastFullPass: null, oldestPriceAgeMinutes: 5 }, results: [
      { kind: 'gear', itemId: 'T5_CAPEITEM_HERETIC', enchant: 3, quality: 4, tier: 5, cost: 40000, avgSellPrice: 60000, dailyVolume: 12.5, sellCities: ['Martlock'], profitPerUnit: 15200, profitPct: 38, dailyProfit: 47000, premiumDays: 147, daysToAcquire: 2, daysToSell: 8, cycleDays: 10, effectiveDays: 10, cappedByMinDays: false, positionCost: 1000000, quantity: 25, freshMinutes: 12, rankScore: 47000, tradeHours: 6, confidence: 0.2 },
    ] } }));
  await page.goto('/craft.html');
  await openTool(page, 'Скан маржи и ликвидности');
  await expect(page.locator('#margin-days')).toHaveValue('3');
  await expect(page.locator('#margin-enchant-after')).toBeChecked();
  await page.locator('#margin-run').click();
  const icon = page.locator('#margin-result tbody tr img.item-icon-lg').first();
  await expect(icon).toHaveAttribute('src', /T5_CAPEITEM_HERETIC%40?@?3\.png\?quality=4|T5_CAPEITEM_HERETIC(%40|@)3\.png\?quality=4/);   // иконка честная: зачарование .3 и качество «Отличное»
  await expect(page.locator('#margin-result tbody tr').first()).toContainText('T5 · .3 · Отличное');
  // выбранный предмет в калькуляторе: иконка следует за зачарованием и качеством
  await page.locator('#craft-search').fill('плащ еретиков');
  await page.locator('#craft-suggestions .suggestion-item').filter({ hasText: 'T5' }).first().click();
  await page.locator('#craft-enchant').selectOption('3');
  await page.locator('#craft-quality').selectOption('4');
  await expect(page.locator('#craft-selected-icon')).toHaveAttribute('src', /CAPEITEM_HERETIC(%40|@)3\.png\?quality=4/);
});

test('план продажи: города без сделок видны, в них можно вписать свою цену; «Маржа всего · терпеливо» реагирует на свои цены сырья и городов; из скана иконка — с зачарованием и качеством', async ({ page }) => {
  await page.route('**/api/craft-calc*', (route) => route.fulfill({ json: {
    itemId: 'T4_MAIN_SWORD', enchant: 0, quality: 1, quantity: 100, marketShare: 1, materialHours: 24, refineRate: 0.367,
    rrrPreset: { id: 'custom', label: 'возврат при крафте: 0%', gearRate: 0, gearRrr: 'none', gearRrrCustom: null, rrr: 0 },
    cities: ['Martlock', 'Lymhurst'], hasAllMaterialPrices: true, materialCostPerUnit: 1000, effectiveCostPerUnit: 1000, totalCost: 100000,
    recipe: [{ resource: 'T4_METALBAR', resourceName: 'T4 Слитки (IV)', queryId: 'T4_METALBAR', enchanted: false, count: 10, returnable: true, rrr: 0, neededToBuy: 1000, cheapestCity: 'Martlock', cheapestPrice: 100, priceSource: 'history', cityPrices: [] }],
    sellPrices: [], bestSell: null, taxRate: 0, netSellPrice: null, profitPerUnit: null, totalProfit: null, enchantAfterCraft: null, teleport: null,
    acquire: { days: 1, cycleDays: 4, bottleneckResource: 'T4_METALBAR', byResource: [] },
    patientSell: { days: 7, marketShare: 1, avgSellPrice: 3000, bestCity: { city: 'Martlock', avgPrice: 3000 }, avgDailyVolume: 50, daysToSellBatch: 2, netSellPrice: 3000, profitPerUnit: 2000,
      byCity: [{ city: 'Martlock', avgSellPrice: 3000, avgDailyVolume: 50, netPrice: 3000, taxRate: 0, profitPerUnit: 2000, profitIndex: 100 },
               { city: 'Lymhurst', avgSellPrice: null, avgDailyVolume: 0, netPrice: null, taxRate: 0, profitPerUnit: null, profitIndex: 0, noData: true }], cities: [],
      plan: { strategy: 'maxProfit', bestPrice: 3000, avgPrice: 3000, totalDays: 2, excluded: [], netPricePerUnit: 3000, profitPerUnit: 2000, cities: [{ city: 'Martlock', avgPrice: 3000, avgDailyVolume: 50, tolerance: null, qty: 100, days: 2 }] } },
  } }));
  await page.goto('/craft.html');
  await page.locator('#craft-search').fill('палаш');
  await page.locator('#craft-suggestions .suggestion-item').first().click();
  await page.locator('#craft-gear-rrr').selectOption('none');
  await page.locator('#craft-run').click();
  const byCity = page.locator('#craft-result .by-city');
  await expect(byCity).toContainText('Lymhurst');                                              // город без сделок виден
  await expect(byCity).toContainText('нет данных');
  await expect(byCity.locator('input.plan-toggle[data-city="Lymhurst"]')).toBeDisabled();       // пока нет своей цены — в план не включить
  await expect(page.locator('.craft-scoreboard')).toContainText('200 000');                      // терпеливо: (3000 − 1000) × 100
  // сырьё в игре дороже: слитки 150 вместо 100 → себестоимость +500 за штуку — и «терпеливо», и «сразу» пересчитаны
  await page.locator('#craft-recipe-table input.manual-price[data-res="T4_METALBAR"]').fill('150');
  await expect(page.locator('.craft-scoreboard')).toContainText('150 000');                      // терпеливо: (3000 − 1500) × 100
  // в Lymhurst в игре видишь 4000: вписываешь цену и количество 40 — город входит в план
  await byCity.locator('input.plan-city-price[data-city="Lymhurst"]').fill('4000');
  await expect(byCity.locator('input.plan-qty[data-city="Lymhurst"]')).toBeEnabled();
  await byCity.locator('input.plan-qty[data-city="Lymhurst"]').fill('40');
  // 60 шт в Martlock по 3000, 40 в Lymhurst по 4000: (60 × 1500 + 40 × 2500) = 190 000
  await expect(page.locator('.craft-scoreboard')).toContainText('190 000');
  await expect(byCity.locator('tr', { hasText: 'Lymhurst' })).not.toContainText('нет данных');
});

test('«в калькулятор» из скана: иконка выбранного предмета сразу с зачарованием и качеством найденной позиции', async ({ page }) => {
  await page.route('**/api/unified-scan*', (route) => route.fulfill({ json: { mode: 'patient', enchantMode: 'direct', liquidity: 'best', days: 3, capital: 1000000, minDays: 1, taxRate: 0.08, setupFeeRate: 0.025, premiumPrice: 28000000, scanned: 1,
    enchantRange: '.0–.4', rrrOptions: { gearRate: 0.248, gearRrr: null, gearRrrCustom: null }, refineRate: 0.367,
    jug: { lastPricePass: Date.now(), lastHistoryPass: Date.now(), lastFullPass: null, oldestPriceAgeMinutes: 1 }, results: [
      { kind: 'gear', itemId: 'T5_CAPEITEM_HERETIC', enchant: 3, quality: 4, tier: 5, cost: 40000, avgSellPrice: 60000, dailyVolume: 12, sellCities: ['Martlock'], profitPerUnit: 15200, profitPct: 38, dailyProfit: 47000, premiumDays: 147, daysToAcquire: 2, daysToSell: 8, cycleDays: 10, effectiveDays: 10, cappedByMinDays: false, positionCost: 1000000, quantity: 25, freshMinutes: 12, rankScore: 47000, tradeHours: 6, confidence: 0.2 },
    ] } }));
  await page.route('**/api/craft-calc*', (route) => route.fulfill({ status: 404, json: { error: 'нет' } }));
  await page.goto('/craft.html');
  await openTool(page, 'Скан маржи и ликвидности');
  await page.locator('#margin-run').click();
  await page.locator('#margin-result .scan-add-btn').first().click();
  await expect(page.locator('#craft-selected-icon')).toHaveAttribute('src', /CAPEITEM_HERETIC(%40|@)3\.png\?quality=4/);
});

test('клик по предмету копирует игровое название (без тира) и подсказывает фильтры аукциона; у материалов — иконки; у гира — подсказка бонус-города', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('**/api/craft-calc*', (route) => route.fulfill({ json: {
    itemId: 'T4_2H_TORCH', enchant: 2, quality: 4, quantity: 1, marketShare: 1, materialHours: 24, refineRate: 0.367,
    rrrPreset: { id: 'custom', label: 'возврат при крафте: 0%', gearRate: 0, gearRrr: 'none', gearRrrCustom: null, rrr: 0 },
    cities: ['Martlock'], hasAllMaterialPrices: true, materialCostPerUnit: 100, effectiveCostPerUnit: 100, totalCost: 100,
    recipe: [{ resource: 'T4_METALBAR', resourceName: 'T4 Слиток стали', queryId: 'T4_METALBAR_LEVEL2@2', enchanted: true, count: 1, returnable: true, rrr: 0, neededToBuy: 1, cheapestCity: 'Martlock', cheapestPrice: 100, priceSource: 'history', cityPrices: [] }],
    sellPrices: [], bestSell: null, taxRate: 0.08, netSellPrice: null, profitPerUnit: null, totalProfit: null, patientSell: null,
    baseChoice: { targetLevel: 0, steps: [], baseSource: 'craft', baseBuy: null, baseCraftCostPerUnit: 100, baseCostPerUnit: 100 },
  } }));
  await page.goto('/craft.html');
  await page.locator('#craft-search').fill('факел');
  await page.locator('#craft-suggestions .suggestion-item').filter({ hasText: 'T4' }).first().click();
  await page.locator('#craft-enchant').selectOption('2');
  await page.locator('#craft-quality').selectOption('4');
  await expect(page.locator('#craft-gear-bonus')).toContainText('бонус: Мартлок');             // факел — офф-хенд: бонус-город Мартлок
  await page.locator('#craft-selected strong').click();
  await expect(page.locator('.toast').last()).toContainText('Скопировано: Факел (знаток) — в поиске аукциона выбери фильтры: зачарование 2, качество отличное');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Факел (знаток)');
  await page.locator('#craft-run').click();
  const row = page.locator('#craft-recipe-table tbody tr').first();
  await expect(row.locator('img.item-icon-sm')).toHaveAttribute('src', /T4_METALBAR_LEVEL2(%40|@)2\.png/);   // иконка материала — с зачарованием
  await row.locator('td.copyable').click();
  await expect(page.locator('.toast').last()).toContainText('Скопировано: Слиток стали — в поиске аукциона выбери фильтры: зачарование 2');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Слиток стали');
});

test('скан: галочка «зачаровать после крафта» переключает режим зачарования в запросе; возврат по умолчанию — гир 24.8%', async ({ page }) => {
  const queries = [];
  await page.route('**/api/unified-scan*', (route) => {
    queries.push(new URL(route.request().url()).searchParams);
    route.fulfill({ json: { mode: 'patient', enchantMode: 'direct', days: 3, taxRate: 0.08, setupFeeRate: 0.025, scanned: 0, enchantRange: '.0–.4', rrrOptions: { gearRate: 0.248, gearRrr: null, gearRrrCustom: null }, refineRate: 0.367, jug: {}, results: [] } });
  });
  await page.goto('/craft.html');
  await openTool(page, 'Скан маржи и ликвидности');
  await expect(page.locator('#margin-gear-rrr')).toHaveValue('city_bonus');
  await page.locator('#margin-run').click();
  await expect.poll(() => queries.length).toBe(1);
  expect(queries[0].get('enchantMode')).toBe('after');
  expect(queries[0].get('gearRrr')).toBe('city_bonus');
  await page.locator('#margin-enchant-after').uncheck();
  await page.locator('#margin-run').click();
  await expect.poll(() => queries.length).toBe(2);
  expect(queries[1].get('enchantMode')).toBe('direct');
});

test('ошибки API: вместо «Unexpected token <» — понятное сообщение (сервер отдал HTML / не обновлён)', async ({ page }) => {
  await page.route('**/api/refine-scan*', (route) => route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad Gateway</html>' }));
  await page.route('**/api/refining-calc*', (route) => route.fulfill({ json: { perCity: [] } }));   // ответ старого сервера — без состава переработки
  await page.goto('/refine.html');
  await expect(page.locator('#calc-result')).toContainText('сервер не обновлён');
  await page.locator('#refine-scan-run').click();
  await expect(page.locator('#refine-scan-result')).toContainText('HTTP 502');
  await expect(page.locator('#refine-scan-result')).not.toContainText('Unexpected token');
});

test('скан гира: по умолчанию «Учитывать ЧР» снят, возврат при крафте — 24.8%', async ({ page }) => {
  await page.goto('/craft.html');
  await openTool(page, 'Скан маржи и ликвидности');
  await expect(page.locator('#margin-black-market')).not.toBeChecked();
  await expect(page.locator('#margin-gear-rrr')).toHaveValue('city_bonus');
  await expect(page.locator('#margin-gear-rrr option:checked')).toContainText('24.8%');
});

test('история в настройках калькулятора: «История сырья» 24ч и «История гира» 3 дня на виду, свои значения (2ч, 5д) уходят в запрос', async ({ page }) => {
  const queries = [];
  await page.route('**/api/craft-calc*', (route) => { queries.push(new URL(route.request().url()).searchParams); route.fulfill({ status: 404, json: { error: 'нет' } }); });
  await page.goto('/craft.html');
  await page.locator('#craft-search').fill('палаш');
  await page.locator('#craft-suggestions .suggestion-item').first().click();
  await expect(page.locator('#craft-material-hours')).toBeVisible();                             // не спрятаны в «Дополнительно»
  await expect(page.locator('#craft-days')).toBeVisible();
  await expect(page.locator('#craft-material-hours')).toHaveValue('24');
  await expect(page.locator('#craft-days')).toHaveValue('3');
  await page.locator('#craft-run').click();
  await expect.poll(() => queries.length).toBe(1);
  expect(queries[0].get('materialHours')).toBe('24');
  expect(queries[0].get('days')).toBe('3');
  await page.locator('#craft-material-hours').selectOption('__custom__');
  await page.locator('#craft-material-hours + .custom-value input').fill('2ч');
  await page.locator('#craft-days').selectOption('__custom__');
  await page.locator('#craft-days + .custom-value input').fill('5д');
  await page.locator('#craft-run').click();
  await expect.poll(() => queries.length).toBeGreaterThan(1);
  const last = queries[queries.length - 1];
  expect(last.get('materialHours')).toBe('2');
  expect(last.get('days')).toBe('5');
});
