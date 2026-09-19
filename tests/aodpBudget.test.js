import { createRequire } from 'node:module';
import { describe, it, expect, vi, afterEach } from 'vitest';

const require = createRequire(import.meta.url);
const { AodpBudget } = require('../lib/aodpBudget.js');

afterEach(() => vi.useRealTimers());

describe('регулятор бюджета AODP', () => {
  it('стартовый запас — полный бак: первые N запросов идут без ожидания', async () => {
    const budget = new AodpBudget({ ratePerMinute: 5 });
    for (let i = 0; i < 5; i++) await budget.acquire();
    expect(budget.stats().granted).toBe(5);
    expect(budget.stats().queued).toBe(0);
  });

  it('дальше — строго по ratePerMinute: шестой запрос ждёт 12 секунд (5 в минуту)', async () => {
    vi.useFakeTimers();
    const budget = new AodpBudget({ ratePerMinute: 5 });
    for (let i = 0; i < 5; i++) await budget.acquire();
    let granted = false;
    budget.acquire().then(() => { granted = true; });
    await vi.advanceTimersByTimeAsync(11_000);
    expect(granted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(granted).toBe(true);
  });

  it('за длинную дистанцию выдаётся не больше бюджета: 60 запросов при 30/мин — не быстрее ~1 минуты', async () => {
    vi.useFakeTimers();
    const budget = new AodpBudget({ ratePerMinute: 30 });
    let done = 0;
    for (let i = 0; i < 60; i++) budget.acquire().then(() => { done++; });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(30);                       // стартовый запас
    await vi.advanceTimersByTimeAsync(59_000);
    expect(done).toBeLessThan(60);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(done).toBe(60);
  });

  it('живой запрос (priority 1) обгоняет фоновые в очереди', async () => {
    vi.useFakeTimers();
    const budget = new AodpBudget({ ratePerMinute: 6, burst: 1 });
    await budget.acquire();                       // бак пуст
    const order = [];
    budget.acquire(0).then(() => order.push('фон-1'));
    budget.acquire(0).then(() => order.push('фон-2'));
    budget.acquire(1).then(() => order.push('живой'));
    await vi.advanceTimersByTimeAsync(35_000);
    expect(order).toEqual(['живой', 'фон-1', 'фон-2']);
  });

  it('неположительная скорость — ошибка, а не вечное ожидание', () => {
    expect(() => new AodpBudget({ ratePerMinute: 0 })).toThrow(/положительным/);
  });
});
