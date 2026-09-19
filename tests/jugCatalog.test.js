import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

process.env.DISABLE_JUG_CRAWLER = 'true';
process.env.JUG_DB_PATH = ':memory:';
const require = createRequire(import.meta.url);
const { buildJugCatalog } = require('../server.js');

// Каталог кувшина не должен тратить бюджет AODP на несуществующие id и не должен терять существующие.
describe('кувшин: каталог id для краулера', () => {
  const catalog = buildJugCatalog();
  const set = new Set(catalog);

  it('без дубликатов и не пустой', () => {
    expect(catalog.length).toBeGreaterThan(2500);
    expect(set.size).toBe(catalog.length);
  });

  it('зачарование есть только у T4+: T1–T3 с @N в каталог не попадают', () => {
    expect(catalog.filter((id) => /^T[123]_.*@/.test(id))).toEqual([]);
  });

  it('у гира T4–T8 есть все уровни .0–.4', () => {
    for (const tier of [4, 5, 6, 7, 8]) {
      for (const e of ['', '@1', '@2', '@3', '@4']) expect(set.has(`T${tier}_MAIN_SWORD${e}`)).toBe(true);
    }
    expect(set.has('T3_MAIN_SWORD')).toBe(true);
    expect(set.has('T3_MAIN_SWORD@1')).toBe(false);
  });

  it('ресурсы: зачарованные версии T4+, камень до .3, каменные блоки без зачарования', () => {
    expect(set.has('T4_ORE_LEVEL1@1')).toBe(true);
    expect(set.has('T8_METALBAR_LEVEL4@4')).toBe(true);
    expect(set.has('T4_ROCK_LEVEL4@4')).toBe(false);
    expect(set.has('T5_STONEBLOCK_LEVEL1@1')).toBe(false);
  });

  it('руны, души и реликвии для зачарования вещей включены', () => {
    for (const tier of [4, 8]) for (const m of ['RUNE', 'SOUL', 'RELIC']) expect(set.has(`T${tier}_${m}`)).toBe(true);
  });
});
