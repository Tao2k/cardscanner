// Vorübergehend: Kartendaten für den Deckbau ansehen (wird wieder entfernt)
import { extractGallery, parseNextData } from './adapters/riftbound';

const res = await fetch('https://playriftbound.com/en-us/card-gallery/', { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ScannR/0.1)', Accept: 'text/html' } });
const { cards } = extractGallery(parseNextData(await res.text()));
const lbl = (o: any) => (o == null ? '' : typeof o === 'string' ? o : o.label ?? o.name ?? JSON.stringify(o));
const count = (f: (c: any) => string[]) => {
  const m = new Map<string, number>();
  for (const c of cards) for (const v of f(c)) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].map(([k, n]) => `${k}=${n}`).join(', ');
};
console.log('CARDS', cards.length);
console.log('KEYS', count((c) => Object.keys(c)));
console.log('TYPES', count((c: any) => (c.cardType?.type ?? []).map(lbl)));
console.log('SUPERTYPES', count((c: any) => (c.cardType?.superType ?? []).map(lbl)));
console.log('DOMAINS', count((c: any) => (c.domain?.values ?? []).map(lbl)));
console.log('TAGS RAW', JSON.stringify(cards.filter((c: any) => c.tags).slice(0, 3).map((c: any) => ({ name: c.name, tags: c.tags }))));
const tagsOf = (c: any): string => {
  const t = c.tags;
  if (!t) return '';
  if (Array.isArray(t)) return t.map(lbl).join('|');
  if (Array.isArray(t.values)) return t.values.map(lbl).join('|');
  if (Array.isArray(t.tags)) return t.tags.map(lbl).join('|');
  return JSON.stringify(t);
};
const line = (c: any) =>
  [c.publicCode, c.name, (c.cardType?.type ?? []).map(lbl).join('/'), (c.cardType?.superType ?? []).map(lbl).join('/'), (c.domain?.values ?? []).map(lbl).join('+'), tagsOf(c), c.rarity?.value?.label, c.energy?.value?.id, c.power?.value?.id].join(' ; ');
const is = (c: any, t: string) => (c.cardType?.type ?? []).some((x: any) => lbl(x) === t);
const sup = (c: any, t: string) => (c.cardType?.superType ?? []).some((x: any) => lbl(x) === t);
const strip = (s = '') => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
console.log('--- LEGENDS');
for (const c of cards.filter((c) => is(c, 'Legend'))) console.log(line(c), '::', strip((c as any).text?.richText?.body));
console.log('--- CHAMPIONS');
for (const c of cards.filter((c) => sup(c, 'Champion') && !is(c, 'Legend'))) console.log(line(c));
console.log('--- SIGNATURE');
for (const c of cards.filter((c) => sup(c, 'Signature'))) console.log(line(c));
console.log('--- BATTLEFIELDS');
for (const c of cards.filter((c) => is(c, 'Battlefield'))) console.log(line(c));
console.log('--- RUNES');
for (const c of cards.filter((c) => is(c, 'Rune'))) console.log(line(c));
console.log('--- TOKENS / OTHER SUPERTYPES');
for (const c of cards.filter((c: any) => (c.cardType?.superType ?? []).some((x: any) => !['Champion', 'Signature'].includes(lbl(x))))) console.log(line(c));
console.log('--- NO DOMAIN (not legend/battlefield/rune)');
for (const c of cards.filter((c: any) => !(c.domain?.values ?? []).length && !is(c, 'Battlefield'))) console.log(line(c));
console.log('--- MULTI DOMAIN non-legend');
for (const c of cards.filter((c: any) => (c.domain?.values ?? []).length > 1 && !is(c, 'Legend'))) console.log(line(c));
const first = (p: (c: any) => boolean) => cards.find(p);
console.log('--- RAW SAMPLES');
for (const c of [first((c) => is(c, 'Legend')), first((c) => sup(c, 'Champion') && !is(c, 'Legend')), first((c) => sup(c, 'Signature')), first((c) => is(c, 'Rune')), first((c) => is(c, 'Battlefield'))]) {
  if (!c) continue;
  const { text, cardImage, ...rest } = c as any;
  console.log(JSON.stringify(rest));
}
console.log('--- DUMP');
for (const c of cards as any[]) {
  console.log('DUMP ' + JSON.stringify({
    id: c.id, code: c.publicCode, n: c.name, s: c.subtitle ?? null, set: c.set?.value?.id,
    t: (c.cardType?.type ?? []).map(lbl), st: (c.cardType?.superType ?? []).map(lbl),
    d: (c.domain?.values ?? []).map(lbl), tg: c.tags?.tags ?? c.tags?.values?.map(lbl) ?? [], r: c.rarity?.value?.label, e: c.energy?.value?.id ?? null, m: c.might?.value?.id ?? null, p: c.power?.value?.id ?? null,
    img: c.cardImage?.url, o: c.orientation,
  }));
}
