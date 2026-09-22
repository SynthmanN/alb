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
