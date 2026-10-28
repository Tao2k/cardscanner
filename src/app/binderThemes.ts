/**
 * Farben und Motiv je Binder, abgenommen von Key Art und Verpackung des Sets.
 * Sets ohne Eintrag bekommen das Violett der App.
 */

export type Motif = 'portal' | 'arena' | 'blades' | 'claws' | 'smoke' | 'stage';

export interface BinderTheme {
  /** Hellste Stelle des Deckels, dort wo das Licht herkommt (glow) */
  light: string;
  /** Grundfarbe des Deckels */
  base: string;
  /** Ränder, Kanten und Schatten */
  deep: string;
  /** Lichtquelle als CSS-Position, sonst oben rechts */
  glow?: string;
  /** Set-Kürzel, Naht und Linien des Motivs */
  accent: string;
  /** Zweite Farbe des Motivs (Stahl, Rauch, Ranken, Blüten) */
  second?: string;
  /** Schrift auf dem Deckel, sonst Weiß; dunkel bei hellen Deckeln */
  ink?: string;
  /** Gummiband, sonst die Randfarbe */
  strap?: string;
  /** Farbe in der App (Chip, Fortschritt, Prozent, Lochrand); muss auf Weiß lesbar sein, sonst die Grundfarbe */
  ui?: string;
  motif?: Motif;
}

export const DEFAULT_THEME: BinderTheme = { light: '#8d2bb0', base: '#5c0477', deep: '#3c0350', accent: '#ffffff' };

const THEMES: Record<string, BinderTheme> = {
  // Navy, unten Petrol, goldener Ring hinter Ahri, Yasuo und Jinx
  'riftbound|OGN': { light: '#00608f', base: '#163a53', deep: '#1b2b3d', glow: '50% 108%', accent: '#c9a65e', ui: '#0b4f73', motif: 'portal' },
  // Starter-Box von Origins (kein Bild): Navy wie Origins, Orange wie das Riftbound-Logo
  'riftbound|OGS': { light: '#2f6d8c', base: '#1d3a50', deep: '#142333', accent: '#e8892c', ui: '#a8530f', motif: 'arena' },
  // Elfenbein mit Stahlklingen, karminroten Bändern und Blütenblättern um Irelia
  'riftbound|SFD': {
    light: '#fffaf5',
    base: '#f2e4d9',
    deep: '#d9bfab',
    glow: '50% 40%',
    accent: '#b8365a',
    second: '#9a9497',
    ink: '#3d2530',
    strap: '#bb3b5c',
    ui: '#ab2b4e',
    motif: 'blades',
  },
  // Booster: oben Magenta, dann Violett, unten fast Schwarz; rosa Logo, dunkle Ranken
  'riftbound|UNL': { light: '#a2347f', base: '#5f3580', deep: '#271a45', glow: '50% -8%', accent: '#f4b1d0', second: '#2b3d4b', motif: 'claws' },
  // Himbeerrot mit grünem Rauch um Akali, goldener Ring
  'riftbound|VEN': { light: '#c81a4e', base: '#a41d40', deep: '#661a30', glow: '50% 35%', accent: '#d2bd7c', second: '#49a458', motif: 'smoke' },
  // Helles Aqua, schillernde Ringe und Funkeln, Seraphines Rosa
  'riftbound|RAD': {
    light: '#f7f3ee',
    base: '#9fd3e3',
    deep: '#6b9fc4',
    glow: '50% 38%',
    accent: '#a5428f',
    second: '#d38bc2',
    ink: '#16384a',
    strap: '#d38bc2',
    ui: '#1d7590',
    motif: 'stage',
  },
};

/** Thema eines Binders („gameId|setCode“). */
export function themeOf(binderKey: string): BinderTheme {
  const [gameId, code = ''] = binderKey.split('|');
  return THEMES[`${gameId}|${code.toUpperCase()}`] ?? DEFAULT_THEME;
}

/** Farbe des Sets in der App. */
export const uiColor = (theme: BinderTheme) => theme.ui ?? theme.base;

/** Kleine Zeichen im Lochrand der Seiten (24 × 24, als Maske; die Farbe kommt aus dem CSS). */
const MARKS: Record<Motif, string> = {
  portal: '<g fill="none" stroke="#000"><circle cx="12" cy="12" r="8.4" stroke-width="1.7"/><circle cx="12" cy="12" r="4.6" stroke-width="1"/></g>',
  arena:
    '<path d="M5 4.5 19.5 19M19 4.5 4.5 19" stroke="#000" stroke-width="2.2" stroke-linecap="round"/><path d="M7.2 15.6 8.4 16.8M16.8 15.6 15.6 16.8" stroke="#000" stroke-width="4" stroke-linecap="round"/>',
  blades:
    '<path d="M12 12C9.6 9.6 9.4 5.6 12 3c2.6 2.6 2.4 6.6 0 9zm0 0c3.4.1 6.4 2.7 6.7 6.3-3.6-.2-6.3-3-6.7-6.3zm0 0c-.4 3.3-3.1 6.1-6.7 6.3.3-3.6 3.3-6.2 6.7-6.3zm0 0c2.2-2.4 5.8-3.1 8.8-1.6-1.6 3-5.3 3.8-8.8 1.6zm0 0c-3.5 2.2-7.2 1.4-8.8-1.6 3-1.5 6.6-.8 8.8 1.6z"/>',
  claws:
    '<path d="M17.5 2.5C14 7 10.5 13 8 21c3.5-6 7-11.6 9.5-18.5zM21.5 5.5c-3 4-6 9.4-8 16 3-5 6-10 8-16zM13.5 1C10 5 7 10.5 4.5 17c3-4.6 6.3-9.6 9-16z"/>',
  smoke:
    '<path d="M2.5 20.5c5.5.3 9.4-2.2 11.8-6.4 1.6-2.8 4.6-3.6 6.2-1.8 1.3 1.5.4 3.8-1.5 3.6-1.5-.1-1.8-1.8-.8-2.6M4 9.5c3.2.2 5.6-1.2 7-3.6 1-1.7 3-2.1 4-.9.8 1-.1 2.4-1.2 2.1" fill="none" stroke="#000" stroke-width="1.9" stroke-linecap="round"/>',
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
    '--set-glow': theme.glow ?? '72% 18%',
    '--set-accent': theme.accent,
    '--set-second': theme.second ?? theme.accent,
    '--set-strap': theme.strap ?? theme.deep,
    '--set-ui': uiColor(theme),
    '--cover-ink': theme.ink ?? '#ffffff',
    // Heller Deckel: Schrift ohne dunklen Schein
    '--cover-glow': theme.ink ? '0 1px 0 rgba(255, 255, 255, 0.55)' : '0 2px 10px rgba(0, 0, 0, 0.25)',
    ...(theme.motif ? { '--set-mark': `url("${markUri(theme.motif)}")` } : {}),
  };
}
