// Города вне расчёта (по умолчанию Caerleon и Brecilien): данные видны, но выбор города, автоплан и лучшая закупка их не берут
import { describe, it, expect } from 'vitest';
import { cityRows, bestBuy, priceLists } from '../public/js/next/logic/cityPrices.js';
import { salePlanState, salePlanByCity } from '../public/js/next/logic/manual.js';
import { withToggle, emptyPlan } from '../public/js/next/logic/planEdit.js';

const ACTIVE = ['Lymhurst', 'Martlock'];
const ALL = ['Lymhurst', 'Martlock', 'Caerleon', 'Brecilien'];

describe('закупка: города вне расчёта', () => {
  const list = [{ city: 'Martlock', price: 100 }, { city: 'Lymhurst', price: 110 }, { city: 'Caerleon', price: 50, inactive: true }];

  it('все города видны — и с данными, и без; вне расчёта помечены, лучший город среди активных', () => {
    const rows = cityRows(list, undefined, ACTIVE, 0.025, ALL);
    expect(rows.map((r) => r.city)).toEqual(['Martlock', 'Lymhurst', 'Caerleon', 'Brecilien']);         // активные по цене, затем вне расчёта
    expect(rows.find((r) => r.city === 'Caerleon')).toMatchObject({ market: 50, inactive: true, isBest: false });
    expect(rows.find((r) => r.city === 'Brecilien')).toMatchObject({ market: null, inactive: true });
    expect(rows.find((r) => r.city === 'Martlock').isBest).toBe(true);
  });

  it('своя цена в городе вне расчёта включает его в выбор', () => {
    const rows = cityRows(list, { Caerleon: 40 }, ACTIVE, 0.025, ALL);
    expect(rows.find((r) => r.city === 'Caerleon')).toMatchObject({ inactive: false, own: 40, isBest: true });
  });

  it('лучшая закупка со своими ценами не берёт город вне расчёта из рыночного списка', () => {
    const b = bestBuy(list, { Lymhurst: 120 }, ACTIVE);
    expect(b.city).toBe('Martlock');                                                                    // Caerleon дешевле по рынку, но вне расчёта
    expect(b.price).toBeCloseTo(100 * 1.025, 6);
  });

  it('priceLists сохраняет пометку inactive у строк сервера', () => {
    const l = priceLists({ setupFeeRate: 0.025, recipe: [{ resource: 'X', materialSource: 'buy', cityPrices: list }] });
    expect(l.X.find((x) => x.city === 'Caerleon').inactive).toBe(true);
    expect(l.X.find((x) => x.city === 'Martlock')).toEqual({ city: 'Martlock', price: 100, date: null });
  });
});

describe('продажа: города вне расчёта', () => {
  const city = (name, price, vol, extra = {}) => ({ city: name, avgSellPrice: price, avgDailyVolume: vol, taxRate: 0.105, netPrice: price * 0.895, profitPerUnit: price * 0.895 - 1000, profitIndex: 10, ...extra });
  const ps = () => ({ marketShare: 1, byCity: [city('Lymhurst', 2000, 20), city('Martlock', 1900, 20), city('Caerleon', 5000, 50, { inactive: true })] });
  const data = { quantity: 10, taxRate: 0.08, setupFeeRate: 0.025, effectiveCostPerUnit: 1000 };

  it('автоплан без сервера не берёт город вне расчёта, хотя он самый выгодный', () => {
    const auto = salePlanByCity(ps().byCity, 10, 1, null);
    expect([...auto.rows.keys()]).not.toContain('Caerleon');
  });

  it('в таблице город есть, по умолчанию выключен и без штук', () => {
    const st = salePlanState(ps(), data, { toggles: null, manualQty: {}, strategy: 'profit' });
    const row = st.rowsData.find((r) => r.c.city === 'Caerleon');
    expect(row).toMatchObject({ qty: 0, enabled: false });
    expect(row.c.inactive).toBe(true);
    expect(st.totalQty).toBe(10);
  });

  it('пользователь включает город вне расчёта галочкой — партия перераспределяется и он получает штуки', () => {
    const p = ps();
    const plan = withToggle(emptyPlan(), p, 'Caerleon', true);
    const st = salePlanState(p, data, plan);
    const row = st.rowsData.find((r) => r.c.city === 'Caerleon');
    expect(row.enabled).toBe(true);
    expect(row.qty).toBeGreaterThan(0);
    expect(st.totalQty).toBe(10);
  });
});

describe('Чёрный Рынок — та же логика «вне расчёта», что у Caerleon/Brecilien', () => {
  const bmCity = (price, vol) => ({ city: 'Black Market', avgSellPrice: price, avgDailyVolume: vol, taxRate: 0.105, netPrice: price * 0.895, profitPerUnit: price * 0.895 - 1000, profitIndex: 40, blackMarket: true, inactive: true });
  const city = (name, price, vol) => ({ city: name, avgSellPrice: price, avgDailyVolume: vol, taxRate: 0.105, netPrice: price * 0.895, profitPerUnit: price * 0.895 - 1000, profitIndex: 10 });
  const ps = () => ({ marketShare: 1, byCity: [city('Lymhurst', 2000, 20), bmCity(5000, 50)] });      // ЧР дороже всех, но не в плане
  const data = { quantity: 10, taxRate: 0.08, setupFeeRate: 0.025, effectiveCostPerUnit: 1000 };

  it('дороже всех городов, но не выбран автопланом и выключен по умолчанию', () => {
    const p = ps();
    const auto = salePlanByCity(p.byCity, 10, 1, null);
    expect([...auto.rows.keys()]).toEqual(['Lymhurst']);
    const st = salePlanState(p, data, { toggles: null, manualQty: {}, strategy: 'profit' });
    const row = st.rowsData.find((r) => r.c.city === 'Black Market');
    expect(row).toMatchObject({ qty: 0, enabled: false });
  });

  it('галочкой включается в план наравне с обычными городами', () => {
    const p = ps();
    const plan = withToggle(emptyPlan(), p, 'Black Market', true);
    const st = salePlanState(p, data, plan);
    const row = st.rowsData.find((r) => r.c.city === 'Black Market');
    expect(row.enabled).toBe(true);
    expect(row.qty).toBeGreaterThan(0);
  });
});
