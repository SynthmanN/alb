import { createRequire } from 'node:module';
import { describe, it, expect, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { openJug, jugStats, setMeta, pruneOldHistory, upsertHistoryBatch, HISTORY_WINDOW_HOURS } = require('../lib/jugStore.js');
const { CYCLE_MS, chunkList, crawlPricesOnce, crawlHistoryOnce, startJugCrawler, PRICE_CHUNK, HISTORY_CHUNK } = require('../lib/jugCrawler.js');

const ids = (n) => Array.from({ length: n }, (_, i) => `T4_ITEM_${i}`);
const priceFor = (id) => ({ item_id: id, city: 'Lymhurst', quality: 1, sell_price_min: 100, sell_price_min_date: '2026-01-01T00:00:00', buy_price_max: 50, buy_price_max_date: '2026-01-01T00:00:00' });
const historyFor = (id) => ({ location: 'Lymhurst', item_id: id, quality: 1, data: [{ timestamp: '2026-01-01T00:00:00', item_count: 4, avg_price: 100 }] });

describe('кувшин: краулер', () => {
  it('chunkList режет каталог на порции и не теряет хвост', () => {
    expect(chunkList(ids(5), 2).map((c) => c.length)).toEqual([2, 2, 1]);
    expect(chunkList([], 3)).toEqual([]);
  });

  it('проход по ценам: чанки по 120 id, все записи в базе, метка прохода поставлена', async () => {
    const db = openJug();
    const calls = [];
    const fetchPrices = async (chunk) => { calls.push(chunk.length); return chunk.map(priceFor); };
    const res = await crawlPricesOnce({ db, ids: ids(250), fetchPrices, now: () => 777 });
    expect(calls).toEqual([PRICE_CHUNK, PRICE_CHUNK, 10]);
    expect(res.failed).toBe(0);
    expect(jugStats(db)).toMatchObject({ priceRows: 250, lastPricePass: 777 });
  });

  it('ошибка чанка (429) не роняет проход: чанк пропускается, остальные пишутся, ошибка логируется', async () => {
    const db = openJug();
    const log = vi.fn();
    let n = 0;
    const fetchHistory = async (chunk) => { if (n++ === 1) throw new Error('AODP history responded 429'); return chunk.map(historyFor); };
    const res = await crawlHistoryOnce({ db, ids: ids(HISTORY_CHUNK * 3), fetchHistory, log, now: () => 5 });
    expect(res.failed).toBe(1);
    expect(jugStats(db).historyRows).toBe(HISTORY_CHUNK * 2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('429'));
  });

  it('цикл: цены и история, «полный проход» ставится только если не было ошибок; stop() останавливает', async () => {
    const db = openJug();
    const log = vi.fn();
    let clock = 1_000_000_000;
    const crawler = startJugCrawler({
      db, ids: ids(30), log, now: () => clock,
      fetchPrices: async (chunk) => chunk.map(priceFor),
      fetchHistory: async (chunk) => chunk.map(historyFor),
      sleep: async () => { clock += 1000; crawler.stop(); },
    });
    await crawler.done;
    const stats = jugStats(db);
    expect(stats.priceRows).toBe(30);
    expect(stats.historyRows).toBe(30);
    expect(stats.lastFullPass).not.toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('полный проход каталога завершён'));
  });

  it('историю не тянет чаще, чем раз в 8 минут; при ошибке полный проход не отмечается', async () => {
    const db = openJug();
    let clock = 1_000_000_000;
    setMeta(db, 'lastHistoryPass', clock - 60_000);      // история обновлялась минуту назад
    let historyCalls = 0;
    const crawler = startJugCrawler({
      db, ids: ids(10), log: () => {}, now: () => clock,
      fetchPrices: async (chunk) => chunk.map(priceFor),
      fetchHistory: async () => { historyCalls++; throw new Error('boom'); },
      sleep: async () => { crawler.stop(); },
    });
    await crawler.done;
    expect(historyCalls).toBe(0);
    expect(jugStats(db).lastFullPass).toBeNull();
  });

  it('у задания может быть свой список городов: готовый гир ходит и в Чёрный Рынок, сырьё — нет; число чанков не растёт', async () => {
    const db = openJug();
    const calls = [];
    const jobs = [
      { name: 'gear', ids: ids(130), cities: ['Martlock', 'BlackMarket'] },
      { name: 'materials', ids: ids(10).map((id) => `M_${id}`), cities: ['Martlock'] },
    ];
    await crawlPricesOnce({ db, jobs, fetchPrices: async (chunk, cities) => { calls.push({ n: chunk.length, cities }); return chunk.map(priceFor); } });
    expect(calls).toEqual([
      { n: PRICE_CHUNK, cities: ['Martlock', 'BlackMarket'] }, { n: 10, cities: ['Martlock', 'BlackMarket'] },
      { n: 10, cities: ['Martlock'] },
    ]);
    const historyCalls = [];
    await crawlHistoryOnce({ db, jobs, fetchHistory: async (chunk, cities) => { historyCalls.push(cities.length); return []; } });
    expect(historyCalls).toEqual([2, 2, 2, 2, 2, 2, 1]);                    // 130 id гира по 25 → 6 чанков с ЧР, 10 материалов → 1 чанк без
  });

  it('полный обход — раз в 10 минут: после прохода краулер спит до конца цикла (минус время самого прохода)', async () => {
    const db = openJug();
    let clock = 1_000_000_000;
    const sleeps = [];
    const crawler = startJugCrawler({
      db, ids: ids(10), log: () => {}, now: () => clock, cycleMs: CYCLE_MS,
      fetchPrices: async (chunk) => { clock += 60_000; return chunk.map(priceFor); },       // проход занял 1 минуту (цены) + 3 (история)
      fetchHistory: async (chunk) => { clock += 180_000; return chunk.map(historyFor); },
      sleep: async (ms) => { sleeps.push(ms); crawler.stop(); },
    });
    await crawler.done;
    expect(CYCLE_MS).toBe(10 * 60 * 1000);
    expect(sleeps).toEqual([CYCLE_MS - 240_000]);                                           // 10 мин − 4 мин работы = 6 мин паузы
  });

  it('история хранится 10 дней: старше окна (с запасом в сутки) удаляется, свежее остаётся', () => {
    const db = openJug();
    const now = Date.parse('2026-09-20T00:00:00Z');
    const day = (n) => new Date(now - n * 86400000).toISOString().slice(0, 19);
    upsertHistoryBatch(db, [{ location: 'Lymhurst', item_id: 'X', quality: 1, data: [12, 11.5, 9, 1].map((n) => ({ timestamp: day(n), item_count: 1, avg_price: 1 })) }], now);
    expect(HISTORY_WINDOW_HOURS).toBe(240);
    expect(pruneOldHistory(db, HISTORY_WINDOW_HOURS, now)).toBe(2);                         // 12 и 11.5 дней назад — за пределами 10 + 1 суток
    expect(jugStats(db).historyRows).toBe(2);
  });
});

describe('кувшин: дневные точки за пределами почасовой истории AODP', () => {
  it('дневная история для дней 8–10 берётся раз в 6 часов, а не на каждом обходе; сбой не отмечает проход', async () => {
    const { crawlHistoryDailyOnce, DAILY_EVERY_MS } = require('../lib/jugCrawler.js');
    expect(DAILY_EVERY_MS).toBe(6 * 60 * 60 * 1000);
    const db = openJug();
    let calls = 0;
    const ok = await crawlHistoryDailyOnce({ db, ids: ids(30), fetchHistoryDaily: async (chunk) => { calls++; return chunk.map(historyFor); }, now: () => 5 });
    expect(calls).toBe(2);                                                                   // 30 id → 2 чанка по 25
    expect(ok.failed).toBe(0);
    let clock = 1_000_000_000;
    let dailyCalls = 0;
    const crawler = startJugCrawler({
      db: openJug(), ids: ids(5), log: () => {}, now: () => clock,
      fetchPrices: async (chunk) => chunk.map(priceFor), fetchHistory: async (chunk) => chunk.map(historyFor),
      fetchHistoryDaily: async (chunk) => { dailyCalls++; return chunk.map(historyFor); },
      sleep: async () => { crawler.stop(); },
    });
    await crawler.done;
    expect(dailyCalls).toBe(1);
    const failing = await crawlHistoryDailyOnce({ db, ids: ids(5), fetchHistoryDaily: async () => { throw new Error('boom'); }, log: () => {}, now: () => 9 });
    expect(failing.failed).toBe(1);
  });
});
