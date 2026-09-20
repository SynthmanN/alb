// Расчёт позиций крафт-листа: каждая позиция считается обычным /api/craft-calc (со своим количеством, деталями за серебро и «чарами после крафта»);
// при включённом автовыборе считаются оба варианта, «после крафта» применяется при выигрыше 7%+. Результаты нужны доку, панели листа и сводной закупке.
import { createStore, apiGet } from './lib.js';
import { craftList, patchItem } from './list.js';
import { commonParams, settings } from './settings.js';
import { decideAfter, afterPossible, silverParts } from './logic/stack.js';

export const listCalc = createStore({ results: new Map(), pairs: new Map(), pending: 0 });
const cache = new Map();                       // uid → { sig, data, pair }
let timer = null;
let token = 0;

const wantsAuto = (item, autoAfter) => autoAfter && afterPossible(item);
const itemSig = (item, autoAfter, faction, common) => JSON.stringify([
  item.itemId, item.enchant, item.quality, item.quantity, wantsAuto(item, autoAfter) ? 'auto' : !!item.after, item.crestSilver, item.heartSilver,
  faction && item.faction ? [faction.id, faction.points] : null, common,
]);

async function fetchOne(item, after, faction, common) {
  try {
    const params = { ...common, item: item.itemId, enchant: item.enchant, quality: item.quality, quantity: item.quantity, ...(after && afterPossible(item) ? { enchantAfterCraft: 'true' } : {}) };
    if (faction && item.faction) {
      params.faction = faction.id;
      params.factionPoints = faction.points;
      const sp = silverParts(item);
      if (sp.length) params.partsSilver = sp.join(',');
    }
    return await apiGet('/api/craft-calc', params);
  } catch (err) {
    return { error: err.message };
  }
}

function publish() {
  const { items } = craftList.get();
  const results = new Map();
  const pairs = new Map();
  for (const it of items) { const c = cache.get(it.uid); if (c) { results.set(it.uid, c.data); if (c.pair) pairs.set(it.uid, c.pair); } }
  listCalc.set({ results, pairs });
}

async function run() {
  const my = ++token;
  const { items, faction, autoAfter } = craftList.get();
  const common = commonParams();
  for (const uid of [...cache.keys()]) if (!items.some((i) => i.uid === uid)) cache.delete(uid);
  const todo = items.filter((i) => { const c = cache.get(i.uid); return !c || c.sig !== itemSig(i, autoAfter, faction, common); });
  listCalc.set({ pending: todo.length });
  await Promise.all(todo.map(async (item) => {
    const sig = itemSig(item, autoAfter, faction, common);
    let data;
    let pair = null;
    if (wantsAuto(item, autoAfter)) {
      const [direct, after] = await Promise.all([fetchOne(item, false, faction, common), fetchOne(item, true, faction, common)]);
      pair = { direct, after };
      const useAfter = decideAfter(item, pair);
      data = useAfter ? after : direct;
      if (!!item.after !== useAfter) patchItem(item.uid, { after: useAfter });
    } else {
      data = await fetchOne(item, item.after, faction, common);
    }
    if (my !== token) return;
    cache.set(item.uid, { sig, data, pair });
    publish();
  }));
  if (my === token) { listCalc.set({ pending: 0 }); publish(); }
}

export function scheduleListCalc() { clearTimeout(timer); timer = setTimeout(run, 450); }
export const invalidateItem = (uid) => { cache.delete(uid); scheduleListCalc(); };
// своя цена продажи меняет выбор «после крафта» по уже посчитанным вариантам — без запросов
export function redecide(uid) {
  const c = cache.get(uid);
  const item = craftList.get().items.find((i) => i.uid === uid);
  if (!c || !c.pair || !item) return;
  const useAfter = decideAfter(item, c.pair);
  c.data = useAfter ? c.pair.after : c.pair.direct;
  if (!!item.after !== useAfter) patchItem(uid, { after: useAfter });
  publish();
}
craftList.subscribe(scheduleListCalc);
settings.subscribe(scheduleListCalc);
scheduleListCalc();
