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
  await page.route('**/api/craft-margin-opportunities*', (route) => {
    scanQuery = new URL(route.request().url()).searchParams;
    route.fulfill({ json: { enchantMode: 'after', liquidity: 'best', days: 7, taxRate: 0.08, premiumPrice: 28000000, scanned: 2365, results: [
      { itemId: 'T4_2H_BOW', enchant: 2, quality: 4, cost: 40000, avgSellPrice: 60000, dailyVolume: 12.5, sellCities: ['Martlock'], profitPerUnit: 15200, profitPct: 38, dailyProfit: 190000, premiumDays: 147, score: 200 },
      { itemId: 'T4_CAPE', enchant: 0, quality: 1, cost: 2700, avgSellPrice: 22000, dailyVolume: 300, sellCities: ['Martlock', 'Lymhurst'], profitPerUnit: 17000, profitPct: 600, dailyProfit: 5100000, premiumDays: 5, score: 900 },
    ] } });
  });
  await page.route('**/api/craft-calc*', (route) => { calcQuery = new URL(route.request().url()).searchParams; route.fulfill({ status: 404, json: { error: 'нет' } }); });
  await page.goto('/craft.html');
  await openTool(page, 'Скан маржи и ликвидности');
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
  await expect(tools).toHaveCount(4);
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
  const rows = page.locator('#craft-result .by-city tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('100');            // Lymhurst: 120 × 100/120 = 100 шт
  await expect(rows.nth(1).locator('td').nth(4)).toHaveText('20'); // Martlock: 20 шт
  const days = await rows.locator('td:nth-child(6)').allTextContents();
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
        plan: { bestPrice: 373, avgPrice: 391, overpayPct: 4.8, totalDays: 3.2, excluded: [{ city: 'Lymhurst', reason: 'слишком тонкий рынок для надёжной цены' }],
          cities: [{ city: 'Bridgewatch', avgPrice: 373, avgDailyVolume: 2, tolerance: 0.05, qty: 1427, days: 3.2 }, { city: 'Martlock', avgPrice: 397, avgDailyVolume: 8, tolerance: 0.15, qty: 6573, days: 3.2 }] } }] },
      patientSell: { days: 7, marketShare: 0.25, avgSellPrice: 5000, bestCity: { city: 'Lymhurst', avgPrice: 5100 }, avgDailyVolume: 12, daysToSellBatch: 9, netSellPrice: 4600, profitPerUnit: 3600,
        byCity: [{ city: 'Lymhurst', avgSellPrice: 5100, avgDailyVolume: 10, profitPerUnit: 3700 }, { city: 'Thetford', avgSellPrice: 2500, avgDailyVolume: 2, profitPerUnit: 1000 }], cities: [],
        plan: { bestPrice: 5100, avgPrice: 5100, overpayPct: 0, totalDays: 9, excluded: [{ city: 'Thetford', reason: 'цена хуже лучшей на 51.0% при допуске 5.0%' }],
          cities: [{ city: 'Lymhurst', avgPrice: 5100, avgDailyVolume: 10, tolerance: 0.05, qty: 1000, days: 9 }] } },
    } });
  });
  await page.goto('/craft.html');
  await page.locator('#craft-search').fill('палаш');
  await page.locator('#craft-suggestions .suggestion-item').first().click();
  await page.locator('#craft-price-tolerance').fill('8');
  await page.locator('#craft-run').click();
  expect(query.get('priceTolerance')).toBe('8');
  const materials = page.locator('#craft-result .craft-recipe-table').first();
  await expect(materials).toContainText('план закупки (2 гор., +4.8% к лучшей цене)');
  await page.locator('#craft-result details.acquire-plan summary').click();
  await expect(materials).toContainText('Martlock: 6 573 шт');
  await expect(materials).toContainText('допуск 15%');
  await expect(page.locator('#craft-result .by-city')).toContainText('Вне плана: Thetford');
});
