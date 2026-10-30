// Vorübergehend: welche Promo-Sets kennen Riot-Galerie und dotgg?
import { extractGallery, parseNextData } from './adapters/riftbound';
import { DOTGG_URL, PRODUCT_LIST_URL } from './adapters/riftbound-prices';

const UA = 'Mozilla/5.0 (compatible; ScannR/0.1; +https://github.com/Tao2k/cardscanner)';
const html = await (await fetch('https://playriftbound.com/en-us/card-gallery/', { headers: { 'User-Agent': UA } })).text();
const g = extractGallery(parseNextData(html));
console.log('GALLERY sets', JSON.stringify(g.sets).slice(0, 3000));
const bySet = new Map<string, number>();
for (const c of g.cards) bySet.set(`${c.set?.value?.id}|${c.set?.value?.label}`, (bySet.get(`${c.set?.value?.id}|${c.set?.value?.label}`) ?? 0) + 1);
console.log('GALLERY cards by set', [...bySet]);
const odd = g.cards.filter((c) => !/^[A-Z]{3}-\d+[a-z]?\*?\/\d+$/.test(c.publicCode ?? ''));
console.log('GALLERY odd codes', odd.length, odd.slice(0, 40).map((c) => `${c.publicCode} ${c.name} ${c.set?.value?.id}`));

const d = (await (await fetch(DOTGG_URL, { headers: { 'User-Agent': UA } })).json()) as { names: string[]; data: unknown[][] };
console.log('DOTGG names', d.names);
console.log('DOTGG rows', d.data.length, 'sample', JSON.stringify(d.data[0]).slice(0, 2000));
const idCol = d.names.indexOf('id');
const prefixes = new Map<string, number>();
for (const r of d.data) {
  const p = String(r[idCol]).split('-')[0];
  prefixes.set(p, (prefixes.get(p) ?? 0) + 1);
}
console.log('DOTGG prefixes', [...prefixes]);
const known = new Set(['OGN', 'OGS', 'SFD', 'UNL', 'VEN', 'RAD']);
const promo = d.data.filter((r) => !known.has(String(r[idCol]).split('-')[0].toUpperCase()));
console.log('DOTGG non-main', promo.length);
for (const r of promo.slice(0, 60)) console.log(' ', JSON.stringify(Object.fromEntries(d.names.map((n, i) => [n, r[i]]).filter(([n]) => !/text|effect|flavor/i.test(n as string)))).slice(0, 900));
// auch hinten: verschiedene Gruppen
for (const p of [...prefixes.keys()].filter((p) => !known.has(p.toUpperCase()))) {
  const r = d.data.find((x) => String(x[idCol]).split('-')[0] === p)!;
  console.log('FIRST', p, JSON.stringify(Object.fromEntries(d.names.map((n, i) => [n, r[i]]))).slice(0, 1500));
}

const pl = (await (await fetch(PRODUCT_LIST_URL)).json()) as { products: { idProduct: number; name: string; idExpansion: number }[] };
const exp = new Map<number, string[]>();
for (const p of pl.products) exp.set(p.idExpansion, [...(exp.get(p.idExpansion) ?? []), p.name]);
for (const [e, names] of exp) console.log('CM expansion', e, names.length, names.slice(0, 6));
