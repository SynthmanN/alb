const { test, expect } = require('@playwright/test');

test('крафт-калькулятор: выбор предмета и расчёт показывают итог с налогом', async ({ page }) => {
  await page.route('**/api/craft-calc*', (route) => route.fulfill({ json: {
    itemId: 'T4_MAIN_SWORD', enchant: 0, quality: 1, quantity: 1, rrrPreset: { id: 'none', label: 'Без бонусов', bonus: 0, rrr: 0 },
    cities: ['Martlock'], hasAllMaterialPrices: true, materialCostPerUnit: 8000, effectiveCostPerUnit: 8000, totalCost: 8000,
    recipe: [{ resource: 'T4_METALBAR', resourceName: 'T4 Слитки (IV)', queryId: 'T4_METALBAR', enchanted: false, count: 16, cheapestCity: 'Martlock', cheapestPrice: 500 }],
    sellPrices: [{ city: 'Martlock', sellMin: 12000, buyMax: 10000 }], bestSell: { city: 'Martlock', price: 10000 },
    taxRate: 0.08, netSellPrice: 9200, profitPerUnit: 1200, totalProfit: 1200,
  } }));
  await page.goto('/craft.html');
  await page.locator('#craft-search').fill('меч');
  await page.locator('#craft-suggestions .suggestion-item').first().click();
  await page.locator('#craft-run').click();
  await expect(page.locator('#craft-result .craft-summary')).toContainText('После налога с продажи (8%)');
  await expect(page.locator('#craft-result .craft-summary')).toContainText('1 200');
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
