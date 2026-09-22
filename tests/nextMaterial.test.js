// Материал закупки: значок и метки по id и названию
import { describe, it, expect } from 'vitest';
import { splitMaterialId, materialTitle } from '../public/js/next/logic/material.js';

describe('материал закупки', () => {
  it('id с зачарованием: основа для значка, тир и зачарование для меток', () => {
    expect(splitMaterialId('T4_CLOTH_LEVEL2@2')).toEqual({ base: 'T4_CLOTH_LEVEL2', tier: 4, enchant: 2 });
    expect(splitMaterialId('T6_CAPE@3')).toEqual({ base: 'T6_CAPE', tier: 6, enchant: 3 });
  });
  it('без зачарования в id — берётся из названия («… .3»), иначе 0', () => {
    expect(splitMaterialId('T4_LEATHER', 'T4 Обработанная кожа .3').enchant).toBe(3);
    expect(splitMaterialId('T4_RUNE', 'T4 Руна (знаток)')).toEqual({ base: 'T4_RUNE', tier: 4, enchant: 0 });
    expect(splitMaterialId('T3_LEATHER').tier).toBe(3);
  });
  it('название без тира и зачарования — их показывают метки', () => {
    expect(materialTitle('T4 Обработанная кожа .3')).toBe('Обработанная кожа');
    expect(materialTitle('T4 Руна (знаток)')).toBe('Руна (знаток)');
    expect(materialTitle('Сердце древа')).toBe('Сердце древа');
  });
});
