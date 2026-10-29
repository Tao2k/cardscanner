import { describe, expect, it } from 'vitest';
import { migratePrefs } from '../src/app/prefs';

describe('migratePrefs', () => {
  it('stellt frühere Sortierungen im Tab „Preise“ um', () => {
    expect(migratePrefs({ priceSort: 'gain' as never }).priceSort).toBe('pct-desc');
    expect(migratePrefs({ priceSort: 'loss' as never }).priceSort).toBe('pct-asc');
    expect(migratePrefs({ priceSort: 'change' as never }).priceSort).toBe('change-desc');
    expect(migratePrefs({ priceSort: 'value' as never }).priceSort).toBe('value-desc');
    expect(migratePrefs({ priceSort: 'number' as never }).priceSort).toBe('value-desc');
    expect(migratePrefs({ priceSort: 'value-asc' }).priceSort).toBe('value-asc');
  });

  it('behält gültige Zeiträume und ersetzt unbekannte durch 1 Monat', () => {
    expect(migratePrefs({ pricePeriod: 365 }).pricePeriod).toBe(365);
    expect(migratePrefs({ pricePeriod: null }).pricePeriod).toBeNull();
    expect(migratePrefs({ pricePeriod: 90 }).pricePeriod).toBe(30);
    expect(migratePrefs(null).pricePeriod).toBe(30);
  });

  it('stellt den festen Zustand auf die Cardmarket-Kürzel um', () => {
    expect(migratePrefs({ condition: 'HP' as never }).condition).toBe('PL');
    expect(migratePrefs({ condition: 'LP' }).condition).toBe('EX');
    expect(migratePrefs({ condition: 'LP', conditionScale: 'cm' }).condition).toBe('LP');
    expect(migratePrefs(null)).toMatchObject({ condition: 'NM', conditionScale: 'cm' });
  });
});
