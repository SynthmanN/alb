// Расчёт позиций стека: каждая считается обычным /api/craft-calc (со своим количеством, деталями за серебро и «чарами после крафта»);
// при включённом автовыборе считаются оба варианта, «после крафта» применяется при выигрыше 7%+. Движок создаётся на каждый стек:
// у крафт-листа и стека калькулятора свои результаты, но одна логика.
import { createStore, apiGet } from './lib.js';
import { list, stack } from './list.js';
import { calcStore } from './calc-store.js';
import { commonParams, settings } from './settings.js';
import { pickAfter, afterPossible, silverParts } from './logic/stack.js';

const wantsAuto = (item, autoAfter) => autoAfter && afterPossible(item);
const itemSig = (item, autoAfter, faction, common) => JSON.stringify([
  item.itemId, item.enchant, item.quality, item.quantity, wantsAuto(item, autoAfter) ? 'auto' : [!!item.after, item.craftEnchant || 0], item.crestSilver, item.heartSilver,
  faction && item.faction ? [faction.id, faction.points] : null, common, settings.get().mixedRecipes,
]);

// level — уровень базы смешанного рецепта (craftEnchant): 0 — обычная база .0 и вся цепочка
async function fetchOne(item, after, faction, common, level = 0) {
  try {
    const params = { ...common, item: item.itemId, enchant: item.enchant, quality: item.quality, quantity: item.quantity, ...(after && afterPossible(item) ? { enchantAfterCraft: 'true', ...(level > 0 ? { craftEnchant: level } : {}) } : {}) };
    if (faction && item.faction) {
      params.faction = faction.id;
      params.factionPoints = faction.points;
      const sp = silverParts(item);
      if (sp.length) params.partsSilver = sp.join(',');
    }
    return await apiGet('/api/craft-calc', params, { ttl: 90000 });
  } catch (err) {
    return { error: err.message };
  }
}

// enabled() — нужен ли расчёт сейчас (стек калькулятора считается только в режиме стека; лист — всегда, его итоги видны в доке)
export function createStackEngine(ops, { enabled = () => true, watch = [] } = {}) {
  const store = createStore({ results: new Map(), pairs: new Map(), pending: 0 });
  const cache = new Map();                       // uid → { sig, data, pair }
  let timer = null;
  let token = 0;
  const publish = () => {
    const { items } = ops.store.get();
    const results = new Map();
    const pairs = new Map();
    for (const it of items) { const c = cache.get(it.uid); if (c) { results.set(it.uid, c.data); if (c.pair) pairs.set(it.uid, c.pair); } }
    store.set({ results, pairs });
  };
  async function run() {
    if (!enabled()) return;
    const my = ++token;
    const { items, faction, autoAfter } = ops.store.get();
    const common = commonParams();
    for (const uid of [...cache.keys()]) if (!items.some((i) => i.uid === uid)) cache.delete(uid);
    const todo = items.filter((i) => { const c = cache.get(i.uid); return !c || c.sig !== itemSig(i, autoAfter, faction, common); });
    store.set({ pending: todo.length });
    await Promise.all(todo.map(async (item) => {
      const sig = itemSig(item, autoAfter, faction, common);
      let data;
      let pair = null;
      if (wantsAuto(item, autoAfter)) {
        // смешанные рецепты: база на уровнях 1..enchant-1 (сырьё зачарованное до .L) + докрутка оставшихся шагов
        const levels = settings.get().mixedRecipes ? Array.from({ length: Math.max(item.enchant - 1, 0) }, (_, i) => i + 1) : [];
        const [direct, after, ...hy] = await Promise.all([fetchOne(item, false, faction, common), fetchOne(item, true, faction, common), ...levels.map((l) => fetchOne(item, true, faction, common, l))]);
        pair = { direct, after, hybrids: Object.fromEntries(levels.map((l, i) => [l, hy[i]])) };
        const pick = pickAfter(item, pair);
        data = pick.data;
        if (!!item.after !== pick.use || (item.craftEnchant || 0) !== pick.level) ops.patch(item.uid, { after: pick.use, craftEnchant: pick.level });
      } else {
        data = await fetchOne(item, item.after, faction, common, item.craftEnchant || 0);
      }
      if (my !== token) return;
      cache.set(item.uid, { sig, data, pair });
      publish();
    }));
    if (my === token) { store.set({ pending: 0 }); publish(); }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 450); };
  ops.store.subscribe(schedule);
  settings.subscribe(schedule);
  for (const w of watch) w.subscribe(schedule);
  schedule();
  return {
    store,
    schedule,
    invalidate(uid) { cache.delete(uid); schedule(); },
    // своя цена продажи меняет выбор «после крафта» по уже посчитанным вариантам — без запросов
    redecide(uid) {
      const c = cache.get(uid);
      const item = ops.store.get().items.find((i) => i.uid === uid);
      if (!c || !c.pair || !item) return;
      const pick = pickAfter(item, c.pair);
      c.data = pick.data;
      if (!!item.after !== pick.use || (item.craftEnchant || 0) !== pick.level) ops.patch(uid, { after: pick.use, craftEnchant: pick.level });
      publish();
    },
  };
}

export const listEngine = createStackEngine(list);
export const stackEngine = createStackEngine(stack, { enabled: () => calcStore.get().stackMode, watch: [calcStore] });
// определения стеков для общих компонентов: хранилище позиций + расчёт (def.engine.invalidate/redecide — доступ через них, не отдельными экспортами)
export const listDef = { ops: list, engine: listEngine };
export const stackDef = { ops: stack, engine: stackEngine };
