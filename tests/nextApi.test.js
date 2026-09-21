// Слой запросов страницы «Крафт»: общий бюджет (сервер пускает 60 запросов в минуту), кэш и дедупликация расчётов, повтор при 429.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { apiGet, apiPost, clearApiCache, resetApiBudget, apiLimits } from '../public/js/next/lib.js';

const json = (body, { status = 200, headers = {} } = {}) => ({ status, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : headers[k.toLowerCase()] ?? null) }, json: async () => body });
let fetchMock;
beforeEach(() => {
  vi.useFakeTimers();
  clearApiCache();
  resetApiBudget();
  Object.assign(apiLimits, { windowMs: 60000, budget: 40, retries: 2, retryMs: 15000 });
  fetchMock = vi.fn(async () => json({ ok: true }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('кэш и дедупликация', () => {
  it('одинаковый запрос (порядок параметров не важен) идёт на сервер один раз, пока ответ свежий; потом — снова', async () => {
    await apiGet('/api/craft-calc', { item: 'A', quantity: 5 }, { ttl: 90000 });
    await apiGet('/api/craft-calc', { quantity: 5, item: 'A' }, { ttl: 90000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(91000);
    await apiGet('/api/craft-calc', { item: 'A', quantity: 5 }, { ttl: 90000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('параллельные одинаковые запросы объединяются; без ttl кэша нет; другие параметры — другой запрос', async () => {
    await Promise.all([apiGet('/api/craft-calc', { item: 'A' }, { ttl: 1000 }), apiGet('/api/craft-calc', { item: 'A' }, { ttl: 1000 })]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await apiGet('/api/craft-calc', { item: 'B' }, { ttl: 1000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await apiGet('/api/unified-scan', { a: 1 });
    await apiGet('/api/unified-scan', { a: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it('ошибка не кэшируется; вписанная цена (POST manual-price) сбрасывает кэш', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'сломалось' }));
    await expect(apiGet('/api/craft-calc', { item: 'A' }, { ttl: 90000 })).rejects.toThrow('сломалось');
    await apiGet('/api/craft-calc', { item: 'A' }, { ttl: 90000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await apiPost('/api/manual-price', { id: 'X', price: 5 });
    await apiGet('/api/craft-calc', { item: 'A' }, { ttl: 90000 });
    expect(fetchMock).toHaveBeenCalledTimes(4);            // POST + повторный запрос расчёта
  });
});

describe('бюджет запросов', () => {
  it('сверх бюджета за окно запросы ждут своей очереди и уходят, когда окно освободится — 429 от сервера не наступает', async () => {
    apiLimits.budget = 3;
    const calls = Array.from({ length: 5 }, (_, i) => apiGet('/api/x', { i }));
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(59000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all(calls);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});

describe('ответ 429 (слишком много запросов)', () => {
  it('ждёт Retry-After и повторяет; после исчерпания повторов показывает сообщение сервера', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'слишком много запросов, попробуйте через минуту' }, { status: 429, headers: { 'retry-after': '2' } }));
    const p = apiGet('/api/x', { a: 1 });
    await vi.advanceTimersByTimeAsync(1500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockResolvedValue(json({ error: 'слишком много запросов, попробуйте через минуту' }, { status: 429 }));
    const failed = apiGet('/api/x', { a: 2 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(40000);
    expect((await failed).message).toContain('слишком много запросов');
  });
});
