// Русское склонение по числу — lib.js (используется в dock.js для уведомлений «N позиций»)
import { describe, it, expect } from 'vitest';
describe('ruPlural', async () => {
  const { ruPlural } = await import('../public/js/next/lib.js');
  it('1 → позиция; 2–4 → позиции; 0, 5–20, 11–14 → позиций', () => {
    const w = (n) => ruPlural(n, 'позиция', 'позиции', 'позиций');
    expect(w(1)).toBe('позиция');
    expect(w(21)).toBe('позиция');
    expect(w(2)).toBe('позиции');
    expect(w(3)).toBe('позиции');
    expect(w(4)).toBe('позиции');
    expect(w(22)).toBe('позиции');
    expect(w(0)).toBe('позиций');
    expect(w(5)).toBe('позиций');
    expect(w(11)).toBe('позиций');
    expect(w(12)).toBe('позиций');
    expect(w(14)).toBe('позиций');
    expect(w(20)).toBe('позиций');
  });
});

describe('priceAgeMinutes', async () => {
  const { priceAgeMinutes } = await import('../public/js/next/lib.js');
  it('без даты или заглушка «нет данных» (0001-01-01) — null', () => {
    expect(priceAgeMinutes(null)).toBeNull();
    expect(priceAgeMinutes('')).toBeNull();
    expect(priceAgeMinutes('0001-01-01T00:00:00')).toBeNull();
  });
  it('настоящая дата — минуты от текущего момента (дата AODP без «Z» — считается как UTC)', () => {
    const iso = new Date(Date.now() - 90 * 60000).toISOString().slice(0, 19);   // 90 минут назад, без миллисекунд/Z — как хранит кувшин
    expect(priceAgeMinutes(iso)).toBeGreaterThan(89);
    expect(priceAgeMinutes(iso)).toBeLessThan(91);
  });
});
