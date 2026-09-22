// Общий порог «зачарки после крафта» — logic/afterCraft.js, используют logic/stack.js (крафт-лист, стек калькулятора) и
// logic/factionPlan.js (фракционный план); server.js (скан) держит то же число отдельно (ESM/CommonJS не шарят модуль).
import { describe, it, expect } from 'vitest';
import { AFTER_CRAFT_MIN_GAIN, afterCraftWins } from '../public/js/next/logic/afterCraft.js';

describe('afterCraftWins', () => {
  it('порог — 7%', () => { expect(AFTER_CRAFT_MIN_GAIN).toBe(0.07); });

  it('нет пути «после» — прямой', () => {
    expect(afterCraftWins(1000, null)).toBe(false);
    expect(afterCraftWins(1000, undefined)).toBe(false);
  });

  it('нет прямого пути (только «после» доступен) — берём «после»', () => {
    expect(afterCraftWins(null, 500)).toBe(true);
    expect(afterCraftWins(undefined, -100)).toBe(true);           // даже в убыток — другого пути нет
  });

  it('выигрыш ровно на пороге и чуть меньше/больше', () => {
    expect(afterCraftWins(1000, 1070)).toBe(false);                // ровно +7% — не строго больше
    expect(afterCraftWins(1000, 1070.01)).toBe(true);
    expect(afterCraftWins(1000, 1069)).toBe(false);
  });

  it('отрицательный прямой профит — порог считается от модуля', () => {
    expect(afterCraftWins(-1000, -930)).toBe(false);               // -930 «лучше» -1000 не более чем на |−1000|×7%=70 → -930 ровно на границе
    expect(afterCraftWins(-1000, -920)).toBe(true);
  });
});
