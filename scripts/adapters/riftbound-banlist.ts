import { banKey, type BanEntry, type BanFormat, type BanlistFile } from '../../src/core/banlist';

/**
 * Riots Bann-Ankündigungen für Riftbound. Die Ankündigungen stehen auf playriftbound.com (dieselbe Seite wie
 * die Kartengalerie, also auch aus GitHub Actions erreichbar). Ein Bann-Artikel hat einen Slug mit „ban-list“,
 * im Text einen Satz wie „Eight cards and two battlefields are being added to the Standard and 2v2 Constructed
 * ban list:“ und darunter die Karten als Aufzählung, dazu „Effective: November 23, 2026“.
 */
export const NEWS_PAGES = ['https://playriftbound.com/en-us/news/announcements/', 'https://playriftbound.com/en-us/news/'];
const ORIGIN = 'https://playriftbound.com';
const USER_AGENT = 'Mozilla/5.0 (compatible; ScannR/0.1; +https://github.com/Tao2k/cardscanner)';

/** Links auf Bann-Artikel in einer Nachrichtenübersicht, ohne Doppelte, mit Schrägstrich am Ende. */
export function banArticleLinks(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/(?:https:\/\/playriftbound\.com)?(\/[a-z]{2}-[a-z]{2}\/news\/[a-z0-9-]+\/[a-z0-9-]*ban-?list[a-z0-9-]*)\/?/gi)) {
    out.add(`${ORIGIN}${m[1].toLowerCase()}/`);
  }
  return [...out];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—' };
const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? all,
  );

/** Seite als Textzeilen: Aufzählungen beginnen mit „• “, Trennlinien sind „---“. */
export function htmlLines(html: string): string[] {
  const text = html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, '')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<hr[^>]*>/gi, '\n---\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6]|li|ul|ol|div|section|article|header|footer|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decode(text)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Dieselben Zeilen aus den Seitendaten (__NEXT_DATA__), falls die Seite den Text erst im Browser zeichnet:
 * Riots CMS (Sanity) speichert Text als Blöcke mit `children[].text`, Aufzählungen mit `listItem`.
 */
export function nextDataLines(html: string): string[] {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return [];
  }
  const lines: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (o._type === 'block' && Array.isArray(o.children)) {
      const text = o.children.map((c) => (c && typeof c === 'object' ? String((c as Record<string, unknown>).text ?? '') : '')).join('');
      if (text.trim()) lines.push(`${o.listItem ? '• ' : ''}${text.replace(/\s+/g, ' ').trim()}`);
      return;
    }
    if (typeof o._type === 'string' && /divider|separator|^hr$|horizontal/i.test(o._type)) lines.push('---');
    Object.values(o).forEach(walk);
  };
  walk(data);
  return lines;
}

export interface ParsedBanArticle {
  url: string;
  title: string;
  /** Ab wann die Änderung gilt (ISO-Datum), falls im Artikel genannt. */
  effective?: string;
  formats: BanFormat[];
  added: string[];
  removed: string[];
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** „November 23, 2026“ → „2026-11-23“. */
export function isoDate(text: string): string | undefined {
  const m = text.match(/\b([A-Z][a-z]+)\s+(\d{1,2}),?\s+(\d{4})\b/);
  const month = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  if (!m || month < 0) return undefined;
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/**
 * Satz, nach dem die Karten aufgezählt werden: „… added to the … ban list:“ oder „… removed from the … ban list:“.
 * Ausnahmen für einzelne Regionen (z. B. Korea bis zum Erscheinen eines Sets) ändern die Liste nicht.
 */
const INTRO = /\b(added to|removed from)\b[^.]*\bban ?list\b/i;
const REGIONAL = /\b(region|regional|korea|korean|china|chinese|japan|japanese)\b/i;

/** Gebannte und freigegebene Karten aus einem Bann-Artikel. */
export function parseBanArticle(html: string, url: string): ParsedBanArticle {
  const fromHtml = htmlLines(html);
  const lines = fromHtml.some((l) => INTRO.test(l)) ? fromHtml : nextDataLines(html);
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim() || lines[0] || url;
  const effectiveLine = lines.find((l) => /\beffective\b/i.test(l) && isoDate(l)) ?? (isoDate(title) ? title : undefined);
  const added: string[] = [];
  const removed: string[] = [];
  let formats: BanFormat[] = ['standard', '2v2'];
  for (let i = 0; i < lines.length; i++) {
    const intro = lines[i];
    const m = intro.match(INTRO);
    if (!m || intro.startsWith('•') || REGIONAL.test(intro)) continue;
    const target = /^added/i.test(m[1]) ? added : removed;
    if (target === added) {
      const std = /standard/i.test(intro);
      const duo = /2v2/i.test(intro);
      if (std !== duo) formats = std ? ['standard'] : ['2v2'];
    }
    // Aufzählung direkt darunter; kurze Zwischenüberschriften („Cards“, „Battlefields“) überspringen
    let seen = false;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (line === '---') break;
      if (line.startsWith('• ')) {
        target.push(line.slice(2).trim());
        seen = true;
      } else if (seen && line.split(' ').length > 4) break;
      else if (!seen && line.split(' ').length > 8) break;
    }
  }
  return { url, title, effective: effectiveLine ? isoDate(effectiveLine) : undefined, formats, added: unique(added), removed: unique(removed) };
}

const unique = (names: string[]) => [...new Map(names.map((n) => [banKey(n), n])).values()];

export interface BanUpdate {
  file: BanlistFile;
  /** Neu gelesene Artikel. */
  articles: ParsedBanArticle[];
  /** Namen aus den Artikeln, die keiner Karte im Katalog entsprechen (nicht übernommen). */
  unknown: string[];
}

/**
 * Neue Bann-Artikel in die Liste einarbeiten. Artikel, die schon Quelle eines Eintrags sind, bleiben außen vor.
 * Nur Namen, die eine Karte im Katalog treffen, kommen auf die Liste: Ein falsch gelesener Satz soll keine
 * Karte sperren.
 */
export function mergeBanArticles(base: BanlistFile, articles: ParsedBanArticle[], knownNames: Set<string>, today: string): BanUpdate {
  const known = new Set(base.entries.map((e) => e.source.replace(/\/?$/, '/')));
  const fresh = articles.filter((a) => !known.has(a.url) && (a.added.length || a.removed.length));
  fresh.sort((a, b) => (a.effective ?? today).localeCompare(b.effective ?? today));
  let entries: BanEntry[] = [...base.entries];
  const unknown: string[] = [];
  let updatedAt = base.updatedAt;
  let sourceUrl = base.sourceUrl;
  let latest = '';
  for (const a of fresh) {
    const since = a.effective ?? today;
    const drop = new Set(a.removed.map(banKey));
    entries = entries.filter((e) => !drop.has(banKey(e.name)));
    for (const name of a.added) {
      if (!knownNames.has(banKey(name))) {
        unknown.push(name);
        continue;
      }
      if (!entries.some((e) => banKey(e.name) === banKey(name) && a.formats.every((f) => e.formats.includes(f)))) {
        entries.push({ name, since, formats: a.formats, source: a.url });
      }
    }
    if (since >= latest) {
      latest = since;
      sourceUrl = a.url;
    }
    // Stand der Liste: heute, damit sie neuer ist als die in der App eingebaute
    updatedAt = today;
  }
  return { file: { ...base, entries, updatedAt, sourceUrl, checkedAt: new Date().toISOString() }, articles: fresh, unknown };
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/** Nachrichtenübersichten lesen und alle Bann-Artikel darin auswerten. */
export async function fetchBanArticles(): Promise<ParsedBanArticle[]> {
  const links = new Set<string>();
  for (const page of NEWS_PAGES) {
    try {
      for (const link of banArticleLinks(await getText(page))) links.add(link);
    } catch (e) {
      console.warn(`[riftbound] Nachrichten nicht lesbar: ${(e as Error).message}`);
    }
  }
  const out: ParsedBanArticle[] = [];
  for (const url of links) out.push(parseBanArticle(await getText(url), url));
  return out;
}
