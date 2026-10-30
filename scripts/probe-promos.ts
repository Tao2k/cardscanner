// Vorübergehend: welche Promo-Karten kennt dotgg?
import { DOTGG_URL, PRODUCT_LIST_URL } from './adapters/riftbound-prices';

const UA = 'Mozilla/5.0 (compatible; ScannR/0.1; +https://github.com/Tao2k/cardscanner)';
const d = (await (await fetch(DOTGG_URL, { headers: { 'User-Agent': UA } })).json()) as { names: string[]; data: unknown[][] };
const col = (n: string) => d.names.indexOf(n);
const rows = d.data.map((r) => Object.fromEntries(d.names.map((n, i) => [n, r[i]])) as Record<string, unknown>);
const groups = new Map<string, string[]>();
for (const r of rows) {
  const id = String(r.id);
  const shape = id.replace(/\d+/g, '#');
  const k = `${r.set_name} | promo=${r.promo} | ${shape}`;
  groups.set(k, [...(groups.get(k) ?? []), `${id} ${r.name}`]);
}
for (const [k, v] of [...groups].sort()) console.log('G', k, v.length, JSON.stringify(v.slice(0, 4)));
const promos = rows.filter((r) => String(r.promo) === '1');
console.log('PROMO', promos.length);
for (const r of promos) console.log('P', r.id, '|', r.name, '|', r.set_name, '|', r.rarity, '| cmid', r.cmid, '| mk', r.marketIds, '| n', r.hasNormal, 'f', r.hasFoil, '|', r.image);
void col;
const pl = (await (await fetch(PRODUCT_LIST_URL)).json()) as { products: Record<string, unknown>[] };
console.log('CM keys', Object.keys(pl.products[0]));
for (const e of [6322, 6480, 6938, 6921, 6567, 6588, 6483, 6289, 6681, 6705]) {
  const ps = pl.products.filter((p) => p.idExpansion === e);
  console.log('CM', e, ps.length, JSON.stringify(ps.slice(0, 3)), JSON.stringify(ps.map((p) => p.name)).slice(0, 1500));
}
