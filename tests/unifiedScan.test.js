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
// Скан прибавляет к рыночной цене материала комиссию 2.5% за свой Buy Order: себестоимость меча из материалов по 100 — 2400 × FEE.
const FEE = 1.025;
const COST = 2400 * FEE;
function seedMaterial(id, price, dailyVolume = 500, avg = price) { seedMaterialRaw(id, price, dailyVolume, avg); }
function seedMaterialRaw(id, price, dailyVolume = 500, avg = price) {
  upsertPriceSnapshots(jugDb, [{ item_id: id, city: CITY, quality: 1, sell_price_min: price, sell_price_min_date: iso(NOW - 5 * 60000), buy_price_max: price - 1, buy_price_max_date: iso(NOW - 5 * 60000) }], NOW);
  // Оборот и цена сырья считаются по окну «сырьё» (24 ч по умолчанию), а не по «Истории» продажи: кроме дневных точек — свежая сделка за последние часы.
  const recent = { timestamp: iso(NOW - 2 * 3600000), item_count: dailyVolume, avg_price: avg };
  upsertHistoryBatch(jugDb, [{ item_id: id, location: CITY, quality: 1, data: [...days().map((ts) => ({ timestamp: ts, item_count: dailyVolume, avg_price: avg })), recent] }], NOW);
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

  it('ранжирует по «профит % × log₂(2 + оборот)»: ликвидность взвешивается, дневной профит и капитал в скане не участвуют', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 2 });      // маржа (4000·0.895 − 2460)/2460 = 46%, но всего 2 шт/день
    seedSales('T4_2H_BOW', { avg: 1900, perDay: 200 });        // маржа ≈ 6%, зато 200 шт/день
    const rows = (await scan({ mode: 'patient' })).results;
    const sword = rows.find((r) => r.itemId === 'T4_MAIN_SWORD');
    const bow = rows.find((r) => r.itemId === 'T4_2H_BOW');
    const raw = sword.profitPct * Math.log2(2 + sword.dailyVolume);                 // множитель свежести цен — от 0.5 до 1
    expect(sword.rankScore).toBeGreaterThan(raw * 0.5 - 1e-6);
    expect(sword.rankScore).toBeLessThanOrEqual(raw + 1e-6);
    for (const r of rows) for (const k of ['quantity', 'positionCost', 'dailyProfit', 'premiumDays', 'daysToAcquire', 'cycleDays', 'effectiveDays']) expect(r).not.toHaveProperty(k);
    expect(rows.every((r, i) => i === 0 || rows[i - 1].rankScore >= r.rankScore)).toBe(true);
  });

  it('ликвидность взвешивается: при той же марже впереди тот, что торгуется быстрее (мёртвая позиция с раздутым % внизу)', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 5000, perDay: 3 });
    seedSales('T4_2H_BOW', { avg: 5000 * 1640 / 2460, perDay: 300 });     // тот же % маржи, оборот ×100
    const rows = (await scan({ mode: 'patient' })).results;
    const sword = rows.find((r) => r.itemId === 'T4_MAIN_SWORD');
    const bow = rows.find((r) => r.itemId === 'T4_2H_BOW');
    expect(bow.profitPct).toBeCloseTo(sword.profitPct, -1);
    expect(rows.indexOf(bow)).toBeLessThan(rows.indexOf(sword));
  });

  it('«Профит рынка/день» = профит/шт × оборот/день (масштаб в серебре без выдуманного капитала); в ответе нет капитала и минимума дней', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40 });
    const res = await scan({ mode: 'patient' });
    const row = res.results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(row.marketProfitPerDay).toBeCloseTo(row.profitPerUnit * row.dailyVolume, 6);
    expect(res).not.toHaveProperty('capital');
    expect(res).not.toHaveProperty('minDays');
    expect(res).not.toHaveProperty('premiumPrice');
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

  it('терпеливый режим: сбор за размещение 2.5% учтён; оборот — сделки прибыльных городов за окно «История»', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40 });
    const res = await scan({ mode: 'patient' });
    const row = res.results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(row.profitPerUnit).toBeCloseTo(4000 * (1 - 0.08 - 0.025) - COST, 0);
    expect(row.dailyVolume).toBeCloseTo(6 * 40 / 7, 5);           // оборот = сделки за 6 дней / окно 7 дней
    expect(res.setupFeeRate).toBe(0.025);
    expect(res).not.toHaveProperty('marketShare');
  });

  it('мгновенный режим: продаём в текущий Buy Order без сбора за размещение, циклов нет', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40, buyOrder: 3800 });
    const res = await scan({ mode: 'instant' });
    const row = res.results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(row.avgSellPrice).toBe(3800);
    expect(row.profitPerUnit).toBeCloseTo(3800 * 0.92 - COST, 0);
    expect(row.sellCities).toEqual([CITY]);
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

  it('.4 — обычная, просто более дорогая комбинация: всегда в общем переборе наравне с .0–.3, отдельной галочки нет', async () => {
    seedMaterial('T4_METALBAR_LEVEL4@4', 100);
    seedMaterial('T4_LEATHER_LEVEL4@4', 100);
    seedSales('T4_MAIN_SWORD@4', { avg: 20000, perDay: 30 });
    const res = await scan({ mode: 'patient' });
    expect(res.enchantRange).toBe('.0–.4');
    expect(res.results.find((r) => r.itemId === 'T4_MAIN_SWORD')).toMatchObject({ enchant: 4 });
    expect(res).not.toHaveProperty('includeAwakened');
  });

  it('.4 не берётся при «зачаровать после крафта»: рунами .4 не получить, диапазон .0–.3', async () => {
    seedMaterial('T4_RUNE', 100); seedMaterial('T4_SOUL', 100); seedMaterial('T4_RELIC', 100);
    seedSales('T4_MAIN_SWORD@4', { avg: 90000, perDay: 30 });
    const res = await scan({ mode: 'patient', enchantMode: 'after' });
    expect(res.enchantRange).toBe('.0–.3');
    expect(res.results.find((r) => r.itemId === 'T4_MAIN_SWORD')).toBeUndefined();
  });

  describe("enchantMode=auto: «чары после крафта» только там, где выгоднее прямого на 7%", () => {
    const seedRunes = (price) => { seedMaterial('T4_RUNE', price); seedMaterial('T4_SOUL', price); seedMaterial('T4_RELIC', price); };
    const sword = async (extra = {}) => (await scan({ mode: 'patient', ...extra })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');

    it('после крафта дешевле прямого сильно — берётся «после», строка помечена after', async () => {
      seedMaterial('T4_METALBAR_LEVEL1@1', 300); seedMaterial('T4_LEATHER_LEVEL1@1', 300);         // прямой .1 дорогой
      seedRunes(10);                                                                                 // руны почти даром
      seedSales('T4_MAIN_SWORD@1', { avg: 12000, perDay: 30 });
      const row = await sword({ enchantMode: 'auto' });
      expect(row).toMatchObject({ enchant: 1, after: true });
      const direct = await sword({ enchantMode: 'direct' });
      expect(direct).toMatchObject({ enchant: 1, after: false });
      expect(row.cost).toBeLessThan(direct.cost);
      expect(row.profitPerUnit).toBeGreaterThan(direct.profitPerUnit * 1.07);
    });

    it('прямой крафт не хуже — остаётся прямой, хотя тумблер включён', async () => {
      seedMaterial('T4_METALBAR_LEVEL1@1', 100); seedMaterial('T4_LEATHER_LEVEL1@1', 100);         // прямой .1 дёшев
      seedRunes(10);                                                                                 // руны заметно дороже прямого крафта, но «после» всё равно прибыльно
      seedSales('T4_MAIN_SWORD@1', { avg: 12000, perDay: 30 });
      expect(await sword({ enchantMode: 'auto' })).toMatchObject({ enchant: 1, after: false });
      expect(await sword({ enchantMode: 'after' })).toMatchObject({ enchant: 1, after: true });       // «все после» — прежнее поведение
    });

    it('разница меньше 7% профита — остаётся прямой', async () => {
      // прямой .1: 24 × 100 × 1.025 = 2460 материалов; «после»: база .0 = 2460 + руны — подбираем руны так, чтобы выигрыш был около 3% профита
      seedMaterial('T4_METALBAR_LEVEL1@1', 200); seedMaterial('T4_LEATHER_LEVEL1@1', 200);         // прямой: 4920
      seedSales('T4_MAIN_SWORD@1', { avg: 12000, perDay: 30 });
      const profitDirect = 12000 * (1 - 0.08 - 0.025) - 4920;
      const runeBudget = 4920 - 2460 - 0.03 * profitDirect;                                            // «после» дешевле прямого на 3% профита
      const perRune = runeBudget / 1.025 / 288;                                                        // 288 рун на одноручное за уровень
      seedRunes(perRune);
      const after = await sword({ enchantMode: 'after' });
      const direct = await sword({ enchantMode: 'direct' });
      const gain = (after.profitPerUnit - direct.profitPerUnit) / direct.profitPerUnit;
      expect(gain).toBeGreaterThan(0);
      expect(gain).toBeLessThan(0.07);                                                                 // «после» лучше, но меньше порога
      expect(await sword({ enchantMode: 'auto' })).toMatchObject({ enchant: 1, after: false });
    });

    it('.4 в режиме auto берётся прямым крафтом (после крафта до .4 не дойти)', async () => {
      seedMaterial('T4_METALBAR_LEVEL4@4', 100); seedMaterial('T4_LEATHER_LEVEL4@4', 100);
      seedSales('T4_MAIN_SWORD@4', { avg: 30000, perDay: 30 });
      expect(await sword({ enchantMode: 'auto' })).toMatchObject({ enchant: 4, after: false });
    });
  });

  describe('chainEntry: вход в цепочку зачарования не с нуля — опция, по умолчанию выключена', () => {
    const sword = async (extra = {}) => (await scan({ mode: 'patient', enchantMode: 'after', ...extra })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    beforeEach(() => {
      seedMaterial('T4_RUNE', 10); seedMaterial('T4_SOUL', 10);                          // .0→.1→.2 (288 рун/душ на одноручное за уровень)
      seedSales('T4_MAIN_SWORD@2', { avg: 90000, perDay: 30 });                          // продажи только на .2 — единственная выжившая строка предмета
      // цена готового .1 на рынке (не через seedMaterial — оборот-как-у-сырья тут не нужен, только сама цена покупки)
      upsertPriceSnapshots(jugDb, [{ item_id: 'T4_MAIN_SWORD@1', city: CITY, quality: 1, sell_price_min: 3000, sell_price_min_date: iso(NOW - 5 * 60000), buy_price_max: 0, buy_price_max_date: iso(NOW - 5 * 60000) }], NOW);
    });
    // вход 0: 2460 (база .0) + 288×10×1.025 (руны) + 288×10×1.025 (души) = 8364
    // вход 1 (куплен готовый .1 за 3000): 3000×1.025 + 288×10×1.025 (только души) = 6027 — дешевле
    it('опция выключена (по умолчанию) — себестоимость считается полной цепочкой с нуля, как раньше', async () => {
      const row = await sword();
      expect(row).toMatchObject({ enchant: 2, after: true });
      expect(row.cost).toBeCloseTo(8364, 2);
      expect(row.enchantEntryLevel).toBeNull();
    });
    it('опция включена (chainEntry=true) — выбирается более дешёвый вход (куплен готовый .1), себестоимость ниже', async () => {
      const row = await sword({ chainEntry: 'true' });
      expect(row.cost).toBeCloseTo(6027, 2);
      expect(row.enchantEntryLevel).toBe(1);
      const off = await sword({ chainEntry: 'false' });
      expect(off.cost).toBeCloseTo(8364, 2);                                             // явное выключение — тоже полная цепочка
    });
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
    expect(none.cost).toBeCloseTo(COST, 6);
    expect(bonus.cost).toBeCloseTo(COST / 1.33, 6);                                 // 33 очка = 24.8%: 2400 × (1 − 0.248)
    expect(custom.cost).toBeCloseTo(COST * 0.9, 6);                                  // своя ставка главнее пресета
    const withoutParams = (await request(app).get('/api/unified-scan').query({ cities: CITY, days: 7, minDaily: 1, minDays: 1, capital: 240000, category: 'weapon' })).body;
    expect(withoutParams.results.find((r) => r.itemId === 'T4_MAIN_SWORD').cost).toBeCloseTo(COST / 1.33, 6);   // по умолчанию — 24.8%
    expect(withoutParams.rrrOptions.gearRate).toBeCloseTo(1 - 1 / 1.33, 9);
  });

  it('РЕГРЕССИЯ: убыточный город с огромным оборотом не раздувает профит и не топит прибыльный (профит считается по городам)', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 10, city: 'Martlock' });          // прибыльный: 4000·0.895 − 2400 = 1180/шт
    seedSales('T4_MAIN_SWORD', { avg: 2000, perDay: 5000, city: 'Thetford' });        // убыточный, но с огромным оборотом
    const row = (await scan({ mode: 'patient', cities: 'Martlock,Thetford' })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    const profitPerUnit = 4000 * (1 - 0.08 - 0.025) - COST;
    expect(row.profitPerUnit).toBeCloseTo(profitPerUnit, 6);
    expect(row.sellCities).toEqual(['Martlock']);
    expect(row.dailyVolume).toBeCloseTo(60 / 7, 6);                                   // оборот только прибыльного города
    expect(row.marketProfitPerDay).toBeCloseTo(profitPerUnit * (60 / 7), 4);
  });

  it('Чёрный Рынок: только в мгновенном режиме и только по флагу; налог ЧР выше (налог + сбор), лучший город — по прибыли после налога', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40, buyOrder: 3800 });                       // город: 3800·0.92 − 2400 = 1096
    seedSales('T4_MAIN_SWORD', { avg: 4400, perDay: 40, buyOrder: 4300, city: 'Black Market' });  // ЧР: 4300·(1 − 0.105) − 2400 = 1448.5
    const without = await scan({ mode: 'instant', cities: 'Martlock' });
    expect(without.results.find((r) => r.itemId === 'T4_MAIN_SWORD').sellCities).toEqual([CITY]);
    const withBm = await scan({ mode: 'instant', cities: 'Martlock', blackMarket: 'true' });
    const row = withBm.results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(row).toMatchObject({ blackMarket: true, sellCities: ['Black Market'], avgSellPrice: 4300 });
    expect(row.profitPerUnit).toBeCloseTo(4300 * (1 - 0.08 - 0.025) - COST, 6);                  // Sales Tax 8% + Setup Fee 2.5% = 10.5%
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

  it('Чёрный Рынок и в терпеливом режиме: по средней цене сделок ЧР, налог свой (10.5%), без второго сбора за размещение; строка помечена', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40 });                                        // Martlock: 4000 × (1 − 0.08 − 0.025) − 2400 = 1180
    seedSales('T4_MAIN_SWORD', { avg: 4600, perDay: 40, city: 'Black Market' });                  // ЧР: 4600 × (1 − 0.105) − 2400 = 1717
    const without = (await scan({ mode: 'patient', cities: 'Martlock' })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(without.sellCities).toEqual([CITY]);
    expect(without.blackMarket).toBe(false);
    const withBm = await scan({ mode: 'patient', cities: 'Martlock', blackMarket: 'true', liquidity: 'best' });
    const best = withBm.results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(best).toMatchObject({ blackMarket: true, sellCities: ['Black Market'] });
    expect(best.profitPerUnit).toBeCloseTo(4600 * 0.895 - COST, 6);
    expect(best.sellTaxRate).toBeCloseTo(0.105, 9);
    const summed = (await scan({ mode: 'patient', cities: 'Martlock', blackMarket: 'true', liquidity: 'sum' })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(summed.sellCities.sort()).toEqual(['Black Market', 'Martlock']);
    expect(summed.profitPerUnit).toBeCloseTo(((4000 * 0.895 - COST) + (4600 * 0.895 - COST)) / 2, 6);                                // города одинакового оборота: чистая цена — по налогу каждого
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
    expect(wide.cost).toBeCloseTo((16 * 130 + 8 * 100) * FEE, 6);                       // слитки по средней 130, кожа 100
    const res = await scan({ mode: 'patient', materialHours: 1 });              // за последний час сделок нет → цена сырья — текущая котировка (100 + комиссия)
    expect(res.materialHours).toBe(1);
    expect(res.results.find((r) => r.itemId === 'T4_MAIN_SWORD').cost).toBeCloseTo(24 * 100 * FEE, 6);
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40, buyOrder: 3800 });
    resetCaches();
    expect((await scan({ mode: 'instant', materialHours: 1 })).results.find((r) => r.itemId === 'T4_MAIN_SWORD').cost).toBeCloseTo(24 * 100 * FEE, 6);
    const instant = (await scan({ mode: 'instant', materialHours: 168 }));       // одна честная цена сырья в обоих режимах
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40, buyOrder: 3800 });
    resetCaches();
    const inst = (await scan({ mode: 'instant', materialHours: 168 })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(instant.materialHours).toBe(168);
    expect(inst.cost).toBeCloseTo((16 * 130 + 8 * 100) * FEE, 6);
  });
});


describe('комиссия 2.5% на материалы', () => {
  it('материалы покупаются своим Buy Order: к рыночной цене сырья прибавляется Setup Fee 2.5% (и в терпеливом, и в мгновенном режиме)', async () => {
    seedMaterialRaw('T4_METALBAR', 100);
    seedMaterialRaw('T4_LEATHER', 100);                                        // рыночная цена 100 → себестоимость меча 24 × 100 × 1.025
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40, buyOrder: 3800 });
    for (const mode of ['patient', 'instant']) {
      const row = (await scan({ mode })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
      expect(row.cost).toBeCloseTo(2400 * 1.025, 6);
    }
  });
});

describe('окно сырья и «История» продажи — независимы', () => {
  it('«История» (days) не двигает цену сырья: она считается по окну сырья', async () => {
    seedMaterial('T4_METALBAR', 100, 500, 130);
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40 });
    const pick = async (d) => (await scan({ mode: 'patient', days: d })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    const three = await pick(3);
    const seven = await pick(7);
    expect(three.cost).toBeCloseTo(seven.cost, 6);
  });
});

describe('скан гира: купить готовый материал или переработать самому', () => {
  const swordRow = async (extra = {}) => (await scan({ mode: 'patient', ...extra })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
  beforeEach(() => {
    seedMaterial('T4_METALBAR', 300);            // готовый слиток дорог
    seedMaterial('T4_ORE', 100, 5000);            // а переработка: 2×100 + 1×100 = 300 × (1 − 36.7%) = 189.9
    seedMaterial('T3_METALBAR', 100, 5000);
    seedSales('T4_MAIN_SWORD', { avg: 9000, perDay: 50 });
  });

  it('материал перерабатывается самому, если так дешевле: себестоимость и список refined в строке', async () => {
    const row = await swordRow();
    expect(row.cost).toBeCloseTo((16 * 300 * (1 - 0.367) + 8 * 100) * FEE, 0);
    expect(row.refined).toHaveLength(1);
    expect(row.refined[0].id).toBe('T4_METALBAR');
    expect(row.refined[0].buyPrice).toBeCloseTo(300 * FEE, 6);
  });
  it('своя ставка переработки пересчитывает выбор: при 0% переработка (300) не дешевле покупки (300) — покупаем готовый', async () => {
    seedMaterial('T4_METALBAR', 250);
    resetCaches();
    const row = await swordRow({ refineRrrCustom: 0 });
    expect(row.refined).toEqual([]);
    expect(row.cost).toBeCloseTo((16 * 250 + 800) * FEE, 6);
    expect((await scan({ mode: 'patient', refineRrrCustom: 0 })).refineRate).toBe(0);
  });
  it('ставка гира применяется поверх: 24.8% возврата при крафте уменьшает цену переработанного материала', async () => {
    const row = await swordRow({ gearRrr: 'city_bonus' });
    expect(row.cost).toBeCloseTo((16 * 300 * (1 - 0.367) + 8 * 100) * FEE * (1 - (1 - 1 / 1.33)), 0);
  });
  it('мгновенный режим тоже сравнивает переработку', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 9000, perDay: 50, buyOrder: 8500 });
    const row = (await scan({ mode: 'instant' })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
    expect(row.refined).toHaveLength(1);
  });
});

describe('ликвидность сырья и доверие по сырью — штатно включены (отключаются явным =false)', () => {
  const both = { cities: 'Martlock,Lymhurst', mode: 'patient' };
  beforeEach(() => {
    seedSales('T4_MAIN_SWORD', { avg: 9000, perDay: 50 });
    // Lymhurst: слитки дешевле (50), но торгуются одной случайной сделкой; Martlock — 100 при большом обороте
    upsertPriceSnapshots(jugDb, [{ item_id: 'T4_METALBAR', city: 'Lymhurst', quality: 1, sell_price_min: 50, sell_price_min_date: iso(NOW - 5 * 60000), buy_price_max: 0, buy_price_max_date: iso(NOW - 5 * 60000) }], NOW);
    upsertHistoryBatch(jugDb, [{ item_id: 'T4_METALBAR', location: 'Lymhurst', quality: 1, data: [{ timestamp: iso(NOW - 2 * 3600000), item_count: 1, avg_price: 50 }] }], NOW);
  });
  const sword = async (extra = {}) => (await scan({ ...both, ...extra })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');

  it('ликвидность сырья: по умолчанию цену задаёт только город с реальным оборотом; materialLiquidity=false возвращает «самый дешёвый город»', async () => {
    const checked = await sword();
    expect(checked.cost).toBeCloseTo((16 * 100 + 8 * 100) * FEE, 6);                   // слитки по 100 — из Martlock, где они реально торгуются
    const plain = await sword({ materialLiquidity: 'false' });
    expect(plain.cost).toBeCloseTo((16 * 50 + 8 * 100) * FEE, 6);                     // слитки по 50 из города с одной сделкой
  });
  it('«Доверие»: по умолчанию слабое звено (минимум по предмету и материалам); confidenceMaterials=false — только по предмету', async () => {
    jugDb.exec("DELETE FROM history WHERE item_id = 'T4_LEATHER'");
    upsertHistoryBatch(jugDb, [{ item_id: 'T4_LEATHER', location: 'Martlock', quality: 1, data: [{ timestamp: iso(NOW - 2 * 3600000), item_count: 500, avg_price: 100 }] }], NOW);   // кожа: сделки только в один час
    const plain = await sword({ cities: 'Martlock', confidenceMaterials: 'false' });
    const weak = await sword({ cities: 'Martlock' });
    expect(plain.tradeHours).toBe(6);                                                  // предмет торгуется 6 разных часов (дней)
    expect(weak.tradeHours).toBe(1);                                                   // кожа — один час: слабое звено
    expect(weak.confidence).toBeCloseTo(1 / 21, 6);
    expect(weak.confidence).toBeLessThan(plain.confidence);
  });
});

describe('свежесть цены в строке скана', () => {
  it('freshMinutes заполнен (возраст самой старой цены цепочки), а не null; влияет на рейтинг, но виден', async () => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 40, buyOrder: 3800 });
    for (const mode of ['patient', 'instant']) {
      const row = (await scan({ mode })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');
      expect(row.freshMinutes).not.toBeNull();
      expect(row.freshMinutes).toBeGreaterThan(0);
    }
  });
});

describe('«зачаровать после крафта»: себестоимость не зависит от «Истории» продажи (ход 252)', () => {
  it('руны и материалы считаются по окну сырья: days=3 и days=7 дают одну себестоимость для одних и тех же позиций', async () => {
    seedMaterial('T4_RUNE', 20, 5000);
    seedSales('T4_MAIN_SWORD', { avg: 9000, perDay: 50 });
    seedSales('T4_MAIN_SWORD', { avg: 9000, perDay: 50 });
    const pick = async (d) => (await scan({ mode: 'patient', enchantMode: 'after', days: d })).results.filter((r) => r.itemId === 'T4_MAIN_SWORD');
    const a = await pick(3);
    const b = await pick(7);
    expect(a.length).toBeGreaterThan(0);
    expect(a.map((r) => [r.enchant, Math.round(r.cost)])).toEqual(b.map((r) => [r.enchant, Math.round(r.cost)]));
  });
});

describe('пустые ячейки «город × комбинация»: заполнение из старых дней кувшина (до 10 дней)', () => {
  const both = { cities: 'Martlock,Thetford', mode: 'patient', days: 3, minDaily: 0 };
  const olderPoints = (ago) => ago.map((d) => ({ timestamp: iso(NOW - d * 86400000), item_count: 70, avg_price: 4000 }));
  beforeEach(() => {
    seedSales('T4_MAIN_SWORD', { avg: 4000, perDay: 30, city: 'Martlock' });            // в окне 3 дня у Martlock сделки есть
  });
  const sword = async (extra = {}) => (await scan({ ...both, ...extra })).results.find((r) => r.itemId === 'T4_MAIN_SWORD');

  it('город без сделок в окне, но с ними в дни 4–10, заполняется средним дневным оборотом старых дней и помечается; города без данных за все 10 дней не появляются', async () => {
    upsertHistoryBatch(jugDb, [{ item_id: 'T4_MAIN_SWORD', location: 'Thetford', quality: 1, data: olderPoints([5, 6, 7, 8]) }], NOW);   // 4 × 70 = 280 за дни 4–10
    const row = await sword();
    const thetford = row.byCity.find((c) => c.city === 'Thetford');
    expect(thetford).toMatchObject({ filled: true });
    expect(thetford.dailyVolume).toBeCloseTo(280 / 7, 5);                                       // 40 в день: старые дни делятся на их длину (7 дней)
    expect(thetford.lastTradeTs).not.toBeNull();
    expect(row.byCity.find((c) => c.city === 'Martlock').filled).toBe(false);
    expect(row.filledCities).toBe(1);
    expect(row.dataAgeDays).toBeLessThan(2);                                                    // свежее — сделки Martlock 1 день назад
    const without = await sword({ cities: 'Martlock' });
    expect(row.dailyVolume).toBeGreaterThan(without.dailyVolume);
  });

  it('там, где сделки в окне есть, старые дни оборот НЕ раздувают: расширение — только для пустых ячеек', async () => {
    const before = (await sword({ cities: 'Martlock' })).dailyVolume;
    upsertHistoryBatch(jugDb, [{ item_id: 'T4_MAIN_SWORD', location: 'Martlock', quality: 1, data: olderPoints([5, 6, 7, 8, 9]) }], NOW);   // огромный «старый пик»
    resetCaches();
    const after = (await sword({ cities: 'Martlock' })).dailyVolume;
    expect(after).toBeCloseTo(before, 9);
  });

  it('заполненные ячейки не считаются «часами торговли» (доверие) и данные старше 2 дней видны в dataAgeDays', async () => {
    jugDb.exec("DELETE FROM history WHERE item_id = 'T4_MAIN_SWORD'");
    upsertHistoryBatch(jugDb, [{ item_id: 'T4_MAIN_SWORD', location: 'Thetford', quality: 1, data: olderPoints([5, 6]) }], NOW);
    seedMaterial('T4_METALBAR', 100);
    resetCaches();
    const row = await sword({ minDaily: 0 });
    expect(row.tradeHours).toBe(0);                                                             // настоящих часов торговли в окне нет
    expect(row.dataAgeDays).toBeGreaterThan(4.9);                                               // последняя сделка 5 дней назад
    expect(row.filledCities).toBe(1);
  });

  it('окно 10 дней и больше — заполнять нечего', async () => {
    upsertHistoryBatch(jugDb, [{ item_id: 'T4_MAIN_SWORD', location: 'Thetford', quality: 1, data: olderPoints([5, 6, 7]) }], NOW);
    const row = await sword({ days: 10 });
    expect(row.byCity.find((c) => c.city === 'Thetford').filled).toBe(false);                   // в окне 10 дней эти сделки — обычные, не «заполнение»
  });
});

describe('фракционный режим скана: только плащи фракции, герб и сердце — за очки', () => {
  const FQ = { faction: 'MARTLOCK', factionPoints: 100000, mode: 'patient', enchantMode: 'direct', cities: CITY, minDaily: 0 };
  const seedCape = (tier, price, perDay) => {
    seedMaterial(`T${tier}_CAPE`, 1000, 500);                                    // обычный плащ (ингредиент)
    seedMaterial(`T${tier}_CAPEITEM_FW_MARTLOCK_BP`, 3000, 50);                  // герб — на рынке 3000
    seedMaterial('T1_FACTION_HIGHLAND_TOKEN_1', 2000, 50);                       // сердце — 2000
    seedSales(`T${tier}_CAPEITEM_FW_MARTLOCK`, { avg: price, perDay });
  };
  beforeEach(() => {
    seedCape(4, 9000, 40);
    seedCape(5, 30000, 10);
    seedSales('T4_MAIN_SWORD', { avg: 9000, perDay: 50 });                        // обычный гир — в этом режиме не должен появляться
  });
  const fscan = async (extra = {}) => (await scan({ ...FQ, ...extra }));

  it('в списке только плащи выбранной фракции; себестоимость — без герба и сердца (они за очки), очки на плащ = сердце 3000 + герб тира', async () => {
    const d = await fscan();
    expect(d.faction).toMatchObject({ id: 'MARTLOCK', name: 'Мартлок', points: 100000 });
    expect(d.results.every((r) => r.itemId.includes('CAPEITEM_FW_MARTLOCK'))).toBe(true);
    expect(d.results.some((r) => r.itemId === 'T4_MAIN_SWORD')).toBe(false);
    const t4 = d.results.find((r) => r.tier === 4);
    const t5 = d.results.find((r) => r.tier === 5);
    expect(t4.factionPoints).toBe(3000 + 400);
    expect(t5.factionPoints).toBe(3000 + 2250);
    expect(t4.cost).toBeCloseTo(1000 * FEE, 6);                                   // только плащ-ингредиент: герб и сердце не покупаются за серебро
  });

  it('профит на очко = профит/шт ÷ очков на плащ; сравнение с продажей герба и сердца (сколько бы дали детали) — на очко', async () => {
    const t4 = (await fscan()).results.find((r) => r.tier === 4);
    expect(t4.profitPerPoint).toBeCloseTo(t4.profitPerUnit / 3400, 9);
    expect(t4.partsNet).toBeCloseTo((3000 + 2000) * (1 - 0.08 - 0.025), 6);         // герб 3000 + сердце 2000, налог и Setup Fee
    expect(t4.partsPerPoint).toBeCloseTo(t4.partsNet / 3400, 9);
    expect(t4.craftBeatsParts).toBe(t4.profitPerUnit > t4.partsNet);
  });

  it('список отсортирован по профиту на очко; без режима герб и сердце в себестоимость входят как обычно', async () => {
    const rows = (await fscan()).results;
    expect(rows.every((r, i) => i === 0 || rows[i - 1].profitPerPoint >= r.profitPerPoint)).toBe(true);
    const plain = await scan({ mode: 'patient', enchantMode: 'direct', cities: CITY, minDaily: 0 });
    expect(plain.faction).toBeNull();
    const t4 = plain.results.find((r) => r.itemId === 'T4_CAPEITEM_FW_MARTLOCK');
    if (t4) expect(t4.cost).toBeGreaterThan(1000 * FEE + 4000);                     // + герб и сердце по рыночной цене
  });

  it('план трат очков: жадно по профиту на очко, не больше рынка (оборот × дни) и не больше очков; остаток очков виден', async () => {
    const d = await fscan({ factionPlan: 'true', factionPoints: 20000, days: 3 });
    const plan = d.factionPlan;
    expect(plan.points).toBe(20000);
    expect(plan.spent + plan.remaining).toBe(20000);
    expect(plan.items.reduce((s, i) => s + i.points, 0)).toBe(plan.spent);
    for (const i of plan.items) {
      expect(i.qty).toBeLessThanOrEqual(i.marketCap);
      expect(i.points).toBe(i.qty * i.pointsPerCape);
    }
    for (let k = 1; k < plan.items.length; k++) expect(plan.items[k - 1].profitPerPoint).toBeGreaterThanOrEqual(plan.items[k].profitPerPoint - 1e-9);
    expect(plan.totalProfit).toBeCloseTo(plan.items.reduce((s, i) => s + i.profit, 0), 6);
    expect((await fscan({ factionPlan: 'true', factionPoints: 100 })).factionPlan.items).toEqual([]);   // очков не хватает даже на один плащ
    expect((await fscan()).factionPlan).toBeNull();                                                      // план — только по запросу
  });
});
