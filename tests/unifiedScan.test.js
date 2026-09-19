// Объединённый скан читает кувшин: тесты засеивают его в памяти известными числами и проверяют модель отбора и ранжирования.
import { createRequire } from 'node:module';
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

process.env.JUG_DB_PATH = ':memory:';
process.env.DISABLE_RATE_LIMIT = 'true';
process.env.DISABLE_JUG_CRAWLER = 'true';
const require = createRequire(import.meta.url);
const { app, jugDb, resetCaches } = require('../server.js');
const { upsertPriceSnapshots, upsertHistoryBatch } = require('../lib/jugStore.js');

const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString().slice(0, 19);
const CITY = 'Martlock';
const QUERY = { cities: CITY, days: 7, minDaily: 1, minDays: 1, capital: 240_000, category: 'weapon', gearRrr: 'none' };   // 240 000 / 2400 = 100 мечей

// Цена материала в кувшине (свежая котировка) и его история торгов (оборот, чтобы закупка партии была осуществима).
function seedMaterial(id, price, dailyVolume = 500, avg = price) {
  upsertPriceSnapshots(jugDb, [{ item_id: id, city: CITY, quality: 1, sell_price_min: price, sell_price_min_date: iso(NOW - 5 * 60000), buy_price_max: price - 1, buy_price_max_date: iso(NOW - 5 * 60000) }], NOW);
  upsertHistoryBatch(jugDb, [{ item_id: id, location: CITY, quality: 1, data: days().map((ts) => ({ timestamp: ts, item_count: dailyVolume, avg_price: avg })) }], NOW);
}
function days(n = 6) { return Array.from({ length: n }, (_, i) => iso(NOW - (i + 1) * 86400000).slice(0, 10) + 'T00:00:00'); }
// Продажа готового: история сделок по качеству (в город) и текущий Buy Order.
function seedSales(id, { quality = 1, avg, perDay, buyOrder = null, city = CITY }) {
  upsertHistoryBatch(jugDb, [{ item_id: id, location: city, quality, data: days().map((ts) => ({ timestamp: ts, item_count: perDay, avg_price: avg })) }], NOW);
  if (buyOrder) {
    upsertPriceSnapshots(jugDb, [{ item_id: id, city, quality, sell_price_min: avg, sell_price_min_date: iso(NOW - 5 * 60000), buy_price_max: buyOrder, buy_price_max_date: iso(NOW - 5 * 60000) }], NOW);
  }
}
const scan = async (extra = {}) => (await request(app).get('/api/unified-scan').query({ ...QUERY, ...extra })).body;

beforeEach(() => {
  jugDb.exec('DELETE FROM prices');
  jugDb.exec('DELETE FROM history');
  resetCaches();
  // T4_MAIN_SWORD = 16 слитков + 8 кожи; T4_2H_BOW = 32 досок (себестоимость без RRR)
  seedMaterial('T4_METALBAR', 100);
  seedMaterial('T4_LEATHER', 100);     // меч: 16×100 + 8×100 = 2400
  seedMaterial('T4_PLANKS', 50, 50000); // лук: 32×50 = 1600 (закупка не узкое место)
});

describe('GET /api/unified-scan', () => {
  it('пустой кувшин — пустой список и честное состояние свежести, а не ошибка', async () => {
    jugDb.exec('DELETE FROM prices');
    const res = await request(app).get('/api/unified-scan').query(QUERY);
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
    expect(res.body.jug).toMatchObject({ lastFullPass: null, oldestPriceAgeMinutes: null });
  });

  it('ранжирует по честному дневному профиту, а не по проценту маржи', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 2 });      // маржа (4000·0.895 − 2400)/2400 = 49%, но всего 2 шт/день
    seedSales('T4_2H_BOW', { avg: 1900, perDay: 200 });        // маржа ≈ 6%, зато 200 шт/день
    const rows = (await scan({ mode: 'patient' })).results;
    const sword = rows.find((r) => r.itemId === 'T4_MAIN_SWORD');
    const bow = rows.find((r) => r.itemId === 'T4_2H_BOW');
    expect(sword.profitPct).toBeGreaterThan(bow.profitPct * 5);
    expect(bow.dailyProfit).toBeGreaterThan(sword.dailyProfit);
    expect(rows.indexOf(bow)).toBeLessThan(rows.indexOf(sword));
  });

  it('ликвидность — часть отбора комбинации: качество с лучшим % без оборота не побеждает ликвидное', async () => {
    seedSales('T4_MAIN_SWORD', { quality: 1, avg: 6000, perDay: 0.2 });   // «красивое» качество почти не продаётся (ниже порога 1 шт/день)
    seedSales('T4_MAIN_SWORD', { quality: 3, avg: 3500, perDay: 40 });
    const row = (await scan({ mode: 'patient' })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(row.quality).toBe(3);
    expect(row.avgSellPrice).toBeCloseTo(3500, 0);
  });

  it('убыточный предмет в список не попадает: цена продажи после налога и сбора ниже себестоимости', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 2500, perDay: 50 });     // 2500·(1 − 0.08 − 0.025) = 2237 < 2400
    expect((await scan({ mode: 'patient' })).results.find((r) => r.itemId === 'T4_MAIN_SWORD')).toBeUndefined();
  });

  it('терпеливый режим: сбор за размещение 2.5% учтён; позиция из капитала: штук = капитал ÷ себестоимость; дни = закупка + продажа', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40 });
    const res = await scan({ mode: 'patient', capital: 480_000 });                                // 480 000 / 2400 = 200 мечей
    const row = res.results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(row.profitPerUnit).toBeCloseTo(4000 * (1 - 0.08 - 0.025) - 2400, 0);
    expect(row.quantity).toBe(200);
    expect(row.positionCost).toBe(480_000);
    expect(row.daysToSell).toBeCloseTo(200 / (6 * 40 / 7), 5);    // позиция / полный оборот (без «доли рынка»); оборот = сделки за 6 дней / окно 7 дней
    expect(row.daysToAcquire).toBeGreaterThan(0);                 // закупка 200×16 слитков при обороте 500/день
    expect(row.cycleDays).toBeCloseTo(row.daysToAcquire + row.daysToSell, 5);
    expect(row.effectiveDays).toBeCloseTo(Math.max(row.cycleDays, 1), 9);
    expect(row.dailyProfit).toBeCloseTo((row.profitPerUnit * 200) / row.effectiveDays, 6);
    expect(res.setupFeeRate).toBe(0.025);
    expect(res).not.toHaveProperty('marketShare');
  });

  it('мгновенный режим: продаём в текущий Buy Order без сбора за размещение, циклов нет', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40, buyOrder: 3800 });
    const res = await scan({ mode: 'instant' });
    const row = res.results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(row.avgSellPrice).toBe(3800);
    expect(row.profitPerUnit).toBeCloseTo(3800 * 0.92 - 2400, 0);
    expect(row.sellCities).toEqual([CITY]);
    expect(row.daysToAcquire).toBeNull();                       // мгновенно: закупки по материалам не считаем, только продажа позиции
    expect(row.daysToSell).toBeCloseTo(row.quantity / row.dailyVolume, 9);
    expect(res.setupFeeRate).toBe(0);
  });

  it('мгновенный режим без Buy Order-а предмет не показывает (продавать некуда)', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40 });
    expect((await scan({ mode: 'instant' })).results.find((r) => r.itemId === 'T4_MAIN_SWORD')).toBeUndefined();
  });

  it('шумный город не задаёт цену: при liquidity=best берётся город с реальным оборотом', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 3200, perDay: 60, city: 'Martlock' });
    seedSales('T4_MAIN_SWORD', { avg: 9000, perDay: 0.3, city: 'Lymhurst' });    // 0.5% оборота: одна сделка по завышенной цене
    const res = await scan({ mode: 'patient', liquidity: 'best', cities: 'Martlock,Lymhurst', minDaily: 0 });
    const row = res.results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(row.sellCities).toEqual(['Martlock']);
    expect(row.avgSellPrice).toBeCloseTo(3200, 0);
  });

  it('капитал: один и тот же капитал даёт МНОГО штук дешёвого и МАЛО дорогого предмета; «доли рынка» больше нет', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40 });                                       // себестоимость 2400
    seedSales('T4_2H_BOW', { avg: 2200, perDay: 40 });                                            // себестоимость 1600
    const rows = (await scan({ mode: 'patient', capital: 480_000 })).results;
    expect(rows.find((r) => r.itemId === 'T4_MAIN_SWORD').quantity).toBe(200);
    expect(rows.find((r) => r.itemId === 'T4_2H_BOW').quantity).toBe(300);
    const small = (await scan({ mode: 'patient', capital: 48_000 })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(small.quantity).toBe(20);
    const share = (await scan({ mode: 'patient', capital: 480_000, marketShare: 0.1 })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(share.dailyProfit).toBeCloseTo(rows.find((r) => r.itemId === 'T4_MAIN_SWORD').dailyProfit, 9);   // marketShare игнорируется
  });

  it('минимум дней срезает нереально быстрый цикл: огромный оборот не даёт фантастического профита в день', async () => {
    seedMaterial('T4_METALBAR', 100, 5_000_000);
    seedMaterial('T4_LEATHER', 100, 5_000_000);
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 900_000 });
    const fast = (await scan({ mode: 'patient', capital: 2_400_000, minDays: 1 })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(fast.cycleDays).toBeLessThan(0.1);
    expect(fast.cappedByMinDays).toBe(true);
    expect(fast.effectiveDays).toBe(1);
    expect(fast.dailyProfit).toBeCloseTo(fast.profitPerUnit * 1000, 4);                          // позиция на 1000 штук за минимум 1 день
    const slower = (await scan({ mode: 'patient', capital: 2_400_000, minDays: 5 })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(slower.dailyProfit).toBeCloseTo(fast.dailyProfit / 5, 4);
  });

  it('материал без оборота за период: закупку партии оценить нельзя — предмет в терпеливом режиме не показывается', async () => {
    jugDb.exec("DELETE FROM history WHERE item_id = 'T4_LEATHER'");
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40 });
    expect((await scan({ mode: 'patient' })).results.find((r) => r.itemId === 'T4_MAIN_SWORD')).toBeUndefined();
  });

  it('выброс в истории AODP (цена в 100 раз выше рынка) не превращается в выдуманный профит', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 3200, perDay: 40, city: 'Martlock' });
    seedSales('T4_MAIN_SWORD', { avg: 3300, perDay: 30, city: 'Thetford' });
    seedSales('T4_MAIN_SWORD', { avg: 320000, perDay: 20, city: 'Lymhurst' });    // абсурдная «средняя цена» из битых данных
    const res = await scan({ mode: 'patient', cities: 'Martlock,Thetford,Lymhurst' });
    const row = res.results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(row.avgSellPrice).toBeLessThan(3400);
    expect(row.sellCities).not.toContain('Lymhurst');
  });

  it('фантомный Buy Order (в разы выше рынка) не считается ценой мгновенной продажи', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 3200, perDay: 40, buyOrder: 3000 });
    seedSales('T4_MAIN_SWORD', { avg: 3300, perDay: 40, buyOrder: 90000, city: 'Thetford' });
    const res = await scan({ mode: 'instant', cities: 'Martlock,Thetford' });
    const row = res.results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(row.avgSellPrice).toBe(3000);
    expect(row.sellCities).toEqual([CITY]);
  });

  it('.4 по умолчанию не ищется, но это явный выбор: с includeAwakened строка .4 появляется, диапазон сообщается в ответе', async () => {
    seedMaterial('T4_METALBAR_LEVEL4@4', 100);
    seedMaterial('T4_LEATHER_LEVEL4@4', 100);
    seedSales('T4_MAIN_SWORD@4', { avg: 20000, perDay: 30 });
    const off = await scan({ mode: 'patient' });
    expect(off.enchantRange).toBe('.0–.3');
    expect(off.results.find((r) => r.itemId === 'T4_MAIN_SWORD')).toBeUndefined();
    const on = await scan({ mode: 'patient', includeAwakened: 'true' });
    expect(on.enchantRange).toBe('.0–.4');
    expect(on.results.find((r) => r.itemId === 'T4_MAIN_SWORD')).toMatchObject({ enchant: 4 });
  });

  it('.4 не берётся при «зачаровать после крафта»: рунами .4 не получить', async () => {
    seedMaterial('T4_RUNE', 100); seedMaterial('T4_SOUL', 100); seedMaterial('T4_RELIC', 100);
    seedSales('T4_MAIN_SWORD@4', { avg: 90000, perDay: 30 });
    const res = await scan({ mode: 'patient', includeAwakened: 'true', enchantMode: 'after' });
    expect(res.results.find((r) => r.itemId === 'T4_MAIN_SWORD')).toBeUndefined();
  });

  it('индекс доверия: 6 часов торговли — 23%, а не «уверенные» 100%; в ответе есть tradeHours', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40 });          // seedSales кладёт по одной точке в день, 6 дней
    const row = (await scan({ mode: 'patient' })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(row.tradeHours).toBe(6);
    expect(row.confidence).toBeCloseTo(6 / 26, 9);
  });

  it('возврат при крафте гира: одна ставка на весь рецепт — пресет (24.8% по умолчанию у city_bonus) или своя; от города покупки не зависит', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40 });
    const none = (await scan({ mode: 'patient', gearRrr: 'none' })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    const bonus = (await scan({ mode: 'patient', gearRrr: 'city_bonus' })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    const custom = (await scan({ mode: 'patient', gearRrrCustom: 10 })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(none.cost).toBeCloseTo(2400, 6);
    expect(bonus.cost).toBeCloseTo(2400 / 1.33, 6);                                 // 33 очка = 24.8%: 2400 × (1 − 0.248)
    expect(custom.cost).toBeCloseTo(2400 * 0.9, 6);                                  // своя ставка главнее пресета
    const withoutParams = (await request(app).get('/api/unified-scan').query({ cities: CITY, days: 7, minDaily: 1, minDays: 1, capital: 240000, category: 'weapon' })).body;
    expect(withoutParams.results.find((r) => r.itemId === 'T4_MAIN_SWORD').cost).toBeCloseTo(2400 / 1.33, 6);   // по умолчанию — 24.8%
    expect(withoutParams.rrrOptions.gearRate).toBeCloseTo(1 - 1 / 1.33, 9);
  });

  it('РЕГРЕССИЯ: убыточный город с огромным оборотом не раздувает профит и не топит прибыльный (профит считается по городам)', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 10, city: 'Martlock' });          // прибыльный: 4000·0.895 − 2400 = 1180/шт
    seedSales('T4_MAIN_SWORD', { avg: 2000, perDay: 5000, city: 'Thetford' });        // убыточный, но с огромным оборотом
    const row = (await scan({ mode: 'patient', cities: 'Martlock,Thetford' })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    const profitPerUnit = 4000 * (1 - 0.08 - 0.025) - 2400;
    expect(row.profitPerUnit).toBeCloseTo(profitPerUnit, 6);
    expect(row.sellCities).toEqual(['Martlock']);
    expect(row.dailyVolume).toBeCloseTo(60 / 7, 6);                                   // оборот только прибыльного города
    expect(row.daysToSell).toBeCloseTo(row.quantity / (60 / 7), 6);                    // и срок продажи — по обороту ТОЛЬКО прибыльного города (не 5000+ убыточного)
    expect(row.dailyProfit).toBeCloseTo((profitPerUnit * row.quantity) / row.effectiveDays, 4);
  });

  it('Чёрный Рынок: только в мгновенном режиме и только по флагу; налог ЧР выше (налог + сбор), лучший город — по прибыли после налога', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40, buyOrder: 3800 });                       // город: 3800·0.92 − 2400 = 1096
    seedSales('T4_MAIN_SWORD', { avg: 4400, perDay: 40, buyOrder: 4300, city: 'Black Market' });  // ЧР: 4300·(1 − 0.105) − 2400 = 1448.5
    const without = await scan({ mode: 'instant', cities: 'Martlock' });
    expect(without.results.find((r) => r.itemId === 'T4_MAIN_SWORD').sellCities).toEqual([CITY]);
    const withBm = await scan({ mode: 'instant', cities: 'Martlock', blackMarket: 'true' });
    const row = withBm.results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(row).toMatchObject({ blackMarket: true, sellCities: ['Black Market'], avgSellPrice: 4300 });
    expect(row.profitPerUnit).toBeCloseTo(4300 * (1 - 0.08 - 0.025) - 2400, 6);                  // Sales Tax 8% + Setup Fee 2.5% = 10.5%
    expect(row.sellTaxRate).toBeCloseTo(0.105, 9);
    expect(withBm.bmTaxRate).toBeCloseTo(0.105, 9);
    const premium = (await scan({ mode: 'instant', cities: 'Martlock', blackMarket: 'true', premium: 'true' })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(premium.sellTaxRate).toBeCloseTo(0.065, 9);                                           // с премиумом 4% + 2.5%
  });

  it('Чёрный Рынок не выигрывает по одной «красивой» цене: после более высокого налога обычный город может дать больше', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40, buyOrder: 4100 });                        // город: 4100·0.92 = 3772
    seedSales('T4_MAIN_SWORD', { avg: 4200, perDay: 40, buyOrder: 4200, city: 'Black Market' });   // ЧР: 4200·0.895 = 3759 — дороже, но на руки меньше
    const row = (await scan({ mode: 'instant', cities: 'Martlock', blackMarket: 'true' })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(row.blackMarket).toBe(false);
    expect(row.sellCities).toEqual([CITY]);
  });

  it('в терпеливом режиме Чёрный Рынок игнорируется даже с флагом (терпеливой модели у него нет)', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40 });
    seedSales('T4_MAIN_SWORD', { avg: 9000, perDay: 40, buyOrder: 9000, city: 'Black Market' });
    const res = await scan({ mode: 'patient', cities: 'Martlock', blackMarket: 'true' });
    expect(res.blackMarket).toBe(false);
    expect(res.results.find((r) => r.itemId === 'T4_MAIN_SWORD').sellCities).toEqual([CITY]);
  });

  it('разбивка оборота по городам: список городов с оборотом и пометкой «в расчёте / вне расчёта»', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 60, city: 'Martlock' });
    seedSales('T4_MAIN_SWORD', { avg: 2000, perDay: 300, city: 'Thetford' });      // убыточный город — вне расчёта, но оборот виден
    const row = (await scan({ mode: 'patient', cities: 'Martlock,Thetford' })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(row.byCity.map((c) => c.city)).toEqual(['Thetford', 'Martlock']);          // по убыванию оборота
    expect(row.byCity.find((c) => c.city === 'Martlock')).toMatchObject({ inPlan: true });
    expect(row.byCity.find((c) => c.city === 'Thetford')).toMatchObject({ inPlan: false });
    expect(row.byCity.find((c) => c.city === 'Thetford').dailyVolume).toBeCloseTo(1800 / 7, 6);
    expect(row.dailyVolume).toBeCloseTo(360 / 7, 6);                                   // в сумме — только город в расчёте
  });

  it('цена сырья — СРЕДНЯЯ по сделкам за окно (materialHours), а не цена одного самого дешёвого лота; нет сделок за окно — текущая котировка', async () => {
    seedMaterial('T4_METALBAR', 100, 500, 130);                                 // самый дешёвый лот 100, но сделки шли в среднем по 130
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40 });
    const wide = (await scan({ mode: 'patient', materialHours: 168 })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(wide.cost).toBeCloseTo(16 * 130 + 8 * 100, 6);                       // слитки по средней 130, кожа 100
    const res = await scan({ mode: 'patient', materialHours: 1 });              // за последний час сделок нет → котировка 100
    expect(res.materialHours).toBe(1);
    expect(res.results.find((r) => r.itemId === 'T4_MAIN_SWORD').cost).toBeCloseTo(24 * 100, 6);
    const instant = (await scan({ mode: 'instant', materialHours: 168 }));       // одна честная цена сырья в обоих режимах
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40, buyOrder: 3800 });
    resetCaches();
    const inst = (await scan({ mode: 'instant', materialHours: 168 })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(instant.materialHours).toBe(168);
    expect(inst.cost).toBeCloseTo(16 * 130 + 8 * 100, 6);
  });
});

