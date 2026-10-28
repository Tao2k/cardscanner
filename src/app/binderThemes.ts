/**
 * Farben und Motiv je Binder, angelehnt an das Booster-Display des Sets.
 * Sets ohne Eintrag bekommen das Violett der App.
 */

export type Motif = 'sigil' | 'arena' | 'blades' | 'claws' | 'rivals' | 'stage';

export interface BinderTheme {
  /** Lichtpunkt oben rechts auf dem Deckel */
  light: string;
  /** Grundfarbe des Deckels, weiße Schrift darauf */
  base: string;
  /** Kanten, Schatten und Gummiband */
  deep: string;
  /** Zweitfarbe des Displays: Set-Kürzel, Naht und Motiv */
  accent: string;
  /** Gegenfarbe der zweiten Deckelhälfte (Vendetta: Bruder gegen Bruder) */
  rival?: string;
  motif?: Motif;
}

export const DEFAULT_THEME: BinderTheme = { light: '#8d2bb0', base: '#5c0477', deep: '#3c0350', accent: '#ffffff' };

const THEMES: Record<string, BinderTheme> = {
  // Jinx, Yasuo und Ahri vor tiefem Blau, das Logo von Siegeln gerahmt
  'riftbound|OGN': { light: '#4a7be0', base: '#1f4396', deep: '#0e2257', accent: '#f1cb6b', motif: 'sigil' },
  // Starter-Box mit Annie, Garen, Lux und Master Yi: Arena
  'riftbound|OGS': { light: '#d4613f', base: '#9b2c22', deep: '#4c100e', accent: '#f4c86f', motif: 'arena' },
  // Irelia, Stahl und Spirit Blossom
  'riftbound|SFD': { light: '#35b3a3', base: '#0f6a66', deep: '#063537', accent: '#ffb5d0', motif: 'blades' },
  // Vi, Rengar, Master Yi und LeBlanc: der Dschungel, Angriff aus dem Schatten
  'riftbound|UNL': { light: '#5aa65a', base: '#215c35', deep: '#0c2b18', accent: '#f3b744', motif: 'claws' },
  // Nasus und Renekton, die Brüder aus Shurima
  'riftbound|VEN': { light: '#c4473b', base: '#7a1f2b', deep: '#380b14', accent: '#eac15c', rival: '#3e2675', motif: 'rivals' },
  // Ekko und Seraphine auf der Bühne
  'riftbound|RAD': { light: '#ee5fae', base: '#9a1f7a', deep: '#420b44', accent: '#86eaff', motif: 'stage' },
};

/** Thema eines Binders („gameId|setCode“). */
export function themeOf(binderKey: string): BinderTheme {
  const [gameId, code = ''] = binderKey.split('|');
  return THEMES[`${gameId}|${code.toUpperCase()}`] ?? DEFAULT_THEME;
}

/** Kleine Zeichen im Lochrand der Seiten (24 × 24, als Maske; die Farbe kommt aus dem CSS). */
const MARKS: Record<Motif, string> = {
  sigil:
    '<circle cx="12" cy="12" r="8.2" fill="none" stroke="#000" stroke-width="1.4"/><path d="M12 6.2 17 14.9H7z M12 17.8 7 9.1h10z" fill="none" stroke="#000" stroke-width="1.1" stroke-linejoin="round"/>',
  arena:
    '<path d="M5 4.5 19.5 19M19 4.5 4.5 19" stroke="#000" stroke-width="2.2" stroke-linecap="round"/><path d="M7.2 15.6 8.4 16.8M16.8 15.6 15.6 16.8" stroke="#000" stroke-width="4" stroke-linecap="round"/>',
  blades:
    '<path d="M12 12C9.6 9.6 9.4 5.6 12 3c2.6 2.6 2.4 6.6 0 9zm0 0c3.4.1 6.4 2.7 6.7 6.3-3.6-.2-6.3-3-6.7-6.3zm0 0c-.4 3.3-3.1 6.1-6.7 6.3.3-3.6 3.3-6.2 6.7-6.3zm0 0c2.2-2.4 5.8-3.1 8.8-1.6-1.6 3-5.3 3.8-8.8 1.6zm0 0c-3.5 2.2-7.2 1.4-8.8-1.6 3-1.5 6.6-.8 8.8 1.6z"/>',
  claws:
    '<path d="M17.5 2.5C14 7 10.5 13 8 21c3.5-6 7-11.6 9.5-18.5zM21.5 5.5c-3 4-6 9.4-8 16 3-5 6-10 8-16zM13.5 1C10 5 7 10.5 4.5 17c3-4.6 6.3-9.6 9-16z"/>',
  rivals:
    '<path d="M12 3.5a8.5 8.5 0 0 1 0 17z"/><circle cx="12" cy="12" r="8.5" fill="none" stroke="#000" stroke-width="1.5"/>',
  stage:
    '<path d="M12 2c.8 5.6 4.4 9.2 10 10-5.6.8-9.2 4.4-10 10-.8-5.6-4.4-9.2-10-10 5.6-.8 9.2-4.4 10-10z"/>',
};

export const markUri = (motif: Motif) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${MARKS[motif]}</svg>`)}`;

/** CSS-Variablen für Deckel, Seiten und Fortschritt. */
export function themeStyle(theme: BinderTheme): Record<string, string> {
  return {
    '--set-light': theme.light,
    '--set-base': theme.base,
    '--set-deep': theme.deep,
    '--set-accent': theme.accent,
    '--set-rival': theme.rival ?? theme.base,
    ...(theme.motif ? { '--set-mark': `url("${markUri(theme.motif)}")` } : {}),
  };
}

