// Профили крафта (чистая логика): название по умолчанию — ROI и дата/время сохранения; переименование, удаление, снимок позиций.
import { describe, it, expect } from 'vitest';
import { roiOf, defaultProfileName, formatStamp, snapshotItems, makeProfile, addProfile, removeProfile, renameProfile, findProfile } from '../public/js/next/logic/profiles.js';

const MS = new Date(2026, 8, 25, 14, 5).getTime();     // 25.09.2026 14:05 (локальное время)

describe('профили крафта', () => {
  it('ROI = профит / вложения × 100; без вложений — null', () => {
    expect(roiOf({ cost: 200000, profit: 25000 })).toBeCloseTo(12.5, 6);
    expect(roiOf({ cost: 0, profit: 5 })).toBeNull();
    expect(roiOf(null)).toBeNull();
  });
  it('название по умолчанию: ROI и дата/время сохранения', () => {
    expect(formatStamp(MS)).toBe('25.09.2026 14:05');
    expect(defaultProfileName(12.345, MS)).toBe('ROI 12.3% · 25.09.2026 14:05');
    expect(defaultProfileName(null, MS)).toBe('ROI — · 25.09.2026 14:05');
    expect(defaultProfileName(-3.04, MS)).toBe('ROI -3.0% · 25.09.2026 14:05');
  });
  it('снимок позиций: количество, качество, рецепт и «выключено» сохраняются, uid и приблизительные цифры скана — нет', () => {
    const snap = snapshotItems([
      { uid: 'l1', itemId: 'T4_CAPE', enchant: 2, quality: 4, quantity: 30, after: true, craftEnchant: 1, cost: 100, profit: 5, on: true },
      { uid: 'l2', itemId: 'T5_BAG', enchant: 0, quality: 1, quantity: 5, on: false },
    ]);
    expect(snap[0]).toEqual({ itemId: 'T4_CAPE', enchant: 2, quality: 4, quantity: 30, after: true, craftEnchant: 1, on: true });
    expect(snap[1]).toMatchObject({ quantity: 5, on: false });
    expect(snap[0]).not.toHaveProperty('uid');
  });
  it('makeProfile + add/rename/remove: новый профиль сверху; пустое имя не принимается; удаление по id', () => {
    const a = makeProfile({ items: [{ itemId: 'X', quantity: 2 }], faction: { id: 'F' }, roi: 10, now: MS, id: 'a' });
    const b = makeProfile({ items: [{ itemId: 'Y', quantity: 1 }], faction: null, roi: null, now: MS + 60000, id: 'b' });
    expect(a).toMatchObject({ id: 'a', name: 'ROI 10.0% · 25.09.2026 14:05', savedAt: MS, roi: 10, faction: { id: 'F' } });
    let list = addProfile(addProfile([], a), b);
    expect(list.map((p) => p.id)).toEqual(['b', 'a']);
    list = renameProfile(list, 'a', '  Плащи на неделю ');
    expect(findProfile(list, 'a').name).toBe('Плащи на неделю');
    expect(renameProfile(list, 'a', '   ')).toBe(list);            // пустое имя — без изменений
    expect(removeProfile(list, 'b').map((p) => p.id)).toEqual(['a']);
    expect(findProfile(list, 'zzz')).toBeNull();
  });
});
