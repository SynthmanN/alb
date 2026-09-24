// Материал закупки: значок и метки по id и названию. id вида T4_CLOTH_LEVEL2@2 → основа T4_CLOTH_LEVEL2, зачарование 2, тир 4.
export function splitMaterialId(id, name = '') {
  const m = String(id).match(/^(.*?)@(\d)$/);
  const base = m ? m[1] : String(id);
  const tier = Number((base.match(/^T(\d)/) || [])[1]) || 0;
  const fromName = String(name).match(/\s\.(\d)$/);                               // «T4 Обработанная кожа .3» — когда в id зачарования нет
  const enchant = m ? Number(m[2]) : fromName ? Number(fromName[1]) : 0;
  return { base, tier, enchant };
}
// Название без тира и зачарования — их показывают метки: «T4 Обработанная кожа .3» → «Обработанная кожа»
export const materialTitle = (name) => String(name || '').replace(/^T\d+\s+/, '').replace(/\s\.\d$/, '');

// Текст для копирования и поиска на аукционе: чистое название + [тир.зачарование] в квадратных скобках — по такой записи
// поиск в игре сам подставляет нужные тир и зачарование (название-то одно на все тиры/зачарования предмета), а руками
// потом ничего доводить не нужно. Пример: «Мантия клирика (мастер) [6.2]». Без тира (не распознан по id) — просто название.
export function auctionSearchText(id, name) {
  const { tier, enchant } = splitMaterialId(id, name);
  const title = materialTitle(name);
  return tier ? `${title} [${tier}.${enchant}]` : title;
}
