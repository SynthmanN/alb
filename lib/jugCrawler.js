// Фоновый краулер «кувшина»: обходит весь каталог порциями и кладёт цены и историю сделок в локальную базу.
// Темп задаёт общий регулятор бюджета AODP (fetchChunk внутри уже ждёт своей очереди), поэтому сам краулер не спит между чанками.
// Цены обновляются на каждом круге, история — реже (она меняется медленно, а запросов на неё в разы больше).
const { upsertPriceSnapshots, upsertHistoryBatch, setMeta, getMeta, pruneOldHistory } = require('./jugStore');

const PRICE_CHUNK = 120;   // id в одном запросе цен (упирается в лимит URL AODP — 4096 символов)
const HISTORY_CHUNK = 25;  // id в одном запросе истории
// Полный обход (цены + история) — раз в CYCLE_MS: для игры разницы между 3 и 10 минутами нет, а запросов к AODP втрое меньше.
// История — на каждом полном обходе (HISTORY_EVERY_MS меньше цикла: иначе после долгого прохода она пропускалась бы через раз).
const CYCLE_MS = 10 * 60 * 1000;
const HISTORY_EVERY_MS = 8 * 60 * 1000;

function chunkList(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Задания краулера: список {ids, cities?}. У задания может быть СВОЙ список городов поверх общего (например, готовый гир
// ходит ещё и в Чёрный Рынок, а сырьё — нет: ЧР его не покупает). Без cities fetcher использует общий список городов.
const asJobs = ({ jobs, ids }) => jobs || [{ ids }];

// Один проход по ценам. fetchPrices(chunk, cities) -> записи AODP. Ошибка чанка (429 и т.п.) не роняет проход: чанк пропускается и логируется.
async function crawlPricesOnce({ db, ids, jobs, fetchPrices, log = () => {}, now = Date.now }) {
  let failed = 0;
  for (const job of asJobs({ jobs, ids })) for (const chunk of chunkList(job.ids, PRICE_CHUNK)) {
    try {
      upsertPriceSnapshots(db, await fetchPrices(chunk, job.cities), now());
    } catch (err) {
      failed++;
      log(`кувшин: не удалось обновить цены для чанка: ${err.message}`);
    }
  }
  setMeta(db, 'lastPricePass', now());
  return { failed };
}

async function crawlHistoryOnce({ db, ids, jobs, fetchHistory, log = () => {}, now = Date.now }) {
  let failed = 0;
  for (const job of asJobs({ jobs, ids })) for (const chunk of chunkList(job.ids, HISTORY_CHUNK)) {
    try {
      upsertHistoryBatch(db, await fetchHistory(chunk, job.cities), now());
    } catch (err) {
      failed++;
      log(`кувшин: не удалось обновить историю для чанка: ${err.message}`);
    }
  }
  setMeta(db, 'lastHistoryPass', now());
  pruneOldHistory(db, undefined, now());
  return { failed };
}

// Бесконечный цикл: цены → (если пора) история → «полный проход» → короткая пауза. stop() останавливает после текущего чанка.
function startJugCrawler({ db, ids, jobs, fetchPrices, fetchHistory, log = console.log, now = Date.now, pauseMs = 5000, cycleMs = 0, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      const started = now();
      try {
        const prices = await crawlPricesOnce({ db, ids, jobs, fetchPrices, log, now });
        const lastHistory = Number(getMeta(db, 'lastHistoryPass')) || 0;
        if (!stopped && now() - lastHistory >= HISTORY_EVERY_MS) {
          const history = await crawlHistoryOnce({ db, ids, jobs, fetchHistory, log, now });
          if (prices.failed === 0 && history.failed === 0) {
            setMeta(db, 'lastFullPass', now());
            log(`кувшин: полный проход каталога завершён ${new Date(now()).toISOString()}`);
          }
        }
      } catch (err) {
        log(`кувшин: сбой прохода: ${err.message}`);
      }
      // между полными обходами — пауза до конца цикла (cycleMs), но не короче pauseMs
      if (!stopped) await sleep(Math.max(pauseMs, cycleMs - (now() - started)));
    }
  })();
  return { stop: () => { stopped = true; }, done: loop };
}

module.exports = { CYCLE_MS, chunkList, crawlPricesOnce, crawlHistoryOnce, startJugCrawler, PRICE_CHUNK, HISTORY_CHUNK, HISTORY_EVERY_MS };
