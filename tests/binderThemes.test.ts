import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, markUri, themeOf, themeStyle, uiColor } from '../src/app/binderThemes';
import { RELEASE_DATES } from '../scripts/adapters/riftbound';

/** Kontrast nach WCAG zwischen zwei Farben (#rrggbb). */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const sets = Object.keys(RELEASE_DATES);

describe('Binder-Themen', () => {
  it('hat für jedes bekannte Riftbound-Set eigene Farben und ein Motiv', () => {
    const themes = sets.map((code) => themeOf(`riftbound|${code}`));
    expect(themes.every((t) => t !== DEFAULT_THEME && t.motif)).toBe(true);
    expect(new Set(themes.map((t) => t.base)).size).toBe(sets.length);
  });

  it('nimmt für unbekannte Sets das Violett der App und achtet nicht auf Groß- und Kleinschreibung', () => {
    expect(themeOf('riftbound|XYZ')).toBe(DEFAULT_THEME);
    expect(themeOf('anderes-spiel|OGN')).toBe(DEFAULT_THEME);
    expect(themeOf('riftbound|ogn')).toBe(themeOf('riftbound|OGN'));
  });

  it('hält Schrift und Set-Kürzel auf dem Deckel und die Set-Farbe in der App lesbar', () => {
    for (const code of [...sets, 'PROMO']) {
      const t = themeOf(`riftbound|${code}`);
      expect(contrast(t.ink ?? '#ffffff', t.base), code).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.accent, t.base), code).toBeGreaterThanOrEqual(3);
      // Prozentzahl, Chip und Seitenzeichen stehen im hellen Modus in dieser Farbe auf Weiß
      expect(contrast(uiColor(t), '#ffffff'), code).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('gibt Farben und Zeichen als CSS-Variablen aus', () => {
    const style = themeStyle(themeOf('riftbound|SFD'));
    expect(style['--set-base']).toMatch(/^#[0-9a-f]{6}$/);
    expect(style['--set-mark']).toBe(`url("${markUri('blades')}")`);
    // Heller Deckel: dunkle Schrift, ohne dunklen Schein
    expect(style['--cover-ink']).toBe('#3d2530');
    expect(themeStyle(themeOf('riftbound|VEN'))['--cover-ink']).toBe('#ffffff');
    expect(decodeURIComponent(markUri('stage'))).toMatch(/^data:image\/svg\+xml,<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24"><path /);
    expect(themeStyle(DEFAULT_THEME)['--set-mark']).toBeUndefined();
  });
});
