/**
 * Banlist für den Deckbau: Karten, die bei offiziellen Turnieren (Constructed) nicht gespielt werden dürfen.
 *
 * Grundstock ist die Liste unten (mit Quelle und Datum je Welle). Der Katalog-Build schaut täglich in Riots
 * Ankündigungen nach neuen Bann-Artikeln (scripts/build-banlist.ts) und schreibt `data/<gameId>/banlist.json`;
 * fehlt die Datei, gilt die Liste hier. Riot bannt immer die ganze Karte, also alle Drucke mit diesem Namen.
 */

/** Spielformat; der Deckbau der App ist Standard (1 gegen 1). */
export type BanFormat = 'standard' | '2v2';

export interface BanEntry {
  /** Kartenname wie in Riots Ankündigung, Champions mit Titel („Riven, Broken Blade“). */
  name: string;
  /** Ab diesem Tag gesperrt (ISO-Datum). */
  since: string;
  formats: BanFormat[];
  /** Artikel, der den Bann angekündigt hat. */
  source: string;
}

export interface BanlistFile {
  gameId: string;
  /** Neueste Bann-Welle (Tag der Ankündigung). */
  updatedAt: string;
  /** Wer die Liste herausgibt, z. B. „Riot Games“. */
  source: string;
  /** Neueste Ankündigung. */
  sourceUrl: string;
  entries: BanEntry[];
  /** Wann der Build zuletzt nachgesehen hat. */
  checkedAt?: string;
}

/** Was der Deckbau zu einer gesperrten Karte zeigt. */
export interface Ban {
  since: string;
  source: string;
}

const RIOT_NOV_2026 = 'https://playriftbound.com/en-us/news/announcements/radiance-ban-list-updates-effective-november-23-2026/';
/**
 * Ältere Wellen: Riots Artikel dazu sind nicht mehr auf der ersten Seite der Ankündigungen; Karten und Daten
 * nach der Übersicht von riftbound.gg (gleicht Riots Liste ab), Daten der Wellen im März und Juli nach riftcompare.com.
 */
const OVERVIEW = 'https://riftbound.gg/rules/banned-cards/';

const both: BanFormat[] = ['standard', '2v2'];
const wave = (since: string, source: string, names: string[], formats = both): BanEntry[] => names.map((name) => ({ name, since, formats, source }));

/** Stand: Riots Ankündigung vom 13. November 2026 (gültig ab 23. November 2026). */
export const RIFTBOUND_BANLIST: BanlistFile = {
  gameId: 'riftbound',
  updatedAt: '2026-11-13',
  source: 'Riot Games',
  sourceUrl: RIOT_NOV_2026,
  entries: [
    ...wave('2026-03-31', OVERVIEW, ['Scrapheap', 'Called Shot', 'Draven, Vanquisher', "Reaver's Row", 'Fight or Flight', 'The Dreaming Tree', 'Obelisk of Power']),
    ...wave('2026-07-24', OVERVIEW, ['Stealthy Pursuer', "The Arena's Greatest", "Aspirant's Climb"]),
    ...wave('2026-07-24', OVERVIEW, ['Master Yi, Wuju Bladesman'], ['2v2']),
    ...wave('2026-09-18', OVERVIEW, ['Ekko, Recurrent', 'Stacked Deck']),
    ...wave('2026-11-23', RIOT_NOV_2026, [
      'Riven, Broken Blade',
      "Zhonya's Hourglass",
      'Stellacorn Herder',
      'Nocturne, Horrifying',
      'Rhasa the Sunderer',
      'Brynhir Thundersong',
      'Dazzling Aurora',
      'Baited Hook',
      "Emperor's Dais",
      'Star Spring',
    ]),
  ],
};

export const BUILTIN_BANLISTS: Record<string, BanlistFile> = { riftbound: RIFTBOUND_BANLIST };

/**
 * Vergleichbarer Name: ohne Groß/klein, typografische Apostrophe und Bindestriche wie bei dotgg
 * („Draven - Vanquisher“ = „Draven, Vanquisher“).
 */
export function banKey(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/\s+[-–—]\s+/g, ', ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Gesperrte Karten eines Formats: vergleichbarer Name → Bann (bei mehreren Wellen die früheste). */
export function bannedNames(file: BanlistFile | null | undefined, format: BanFormat = 'standard'): Map<string, Ban> {
  const out = new Map<string, Ban>();
  for (const e of file?.entries ?? []) {
    if (!e.formats.includes(format)) continue;
    const key = banKey(e.name);
    const current = out.get(key);
    if (!current || e.since < current.since) out.set(key, { since: e.since, source: e.source });
  }
  return out;
}

/** Neuere von zwei Listen: die vom Build, außer die eingebaute ist neuer (App-Update vor dem nächsten Build). */
export function newerBanlist(a: BanlistFile | null | undefined, b: BanlistFile | null | undefined): BanlistFile | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return b.updatedAt > a.updatedAt ? b : a;
}

export async function loadBanlist(baseUrl: string, gameId: string): Promise<BanlistFile | null> {
  try {
    const res = await fetch(`${baseUrl}data/${gameId}/banlist.json`, { cache: 'no-cache' });
    return res.ok ? ((await res.json()) as BanlistFile) : null;
  } catch {
    return null;
  }
}

const DATE = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'numeric', year: 'numeric' });

/** „Gesperrt seit 18.9.2026“ oder, wenn der Bann erst kommt, „Gesperrt ab 23.11.2026“. */
export function banLabel(ban: Ban, today = new Date().toISOString().slice(0, 10)): string {
  const day = DATE.format(new Date(`${ban.since}T12:00:00Z`));
  return ban.since > today ? `Gesperrt ab ${day}` : `Gesperrt seit ${day}`;
}
