import { riftbound } from '../scripts/adapters/riftbound';
import { deckPool, mainCardsFor, kindOf } from '../src/core/deck';
const live: any = await (await fetch('https://tao2k.github.io/cardscanner/data/riftbound/catalog.json')).json();
console.log('LIVE builtAt', live.meta.builtAt, 'BT', JSON.stringify(live.printings.filter((p: any) => p.cardName === 'Bilgewater Tracker').map((p: any) => [p.printingId, p.attributes.domains])));
for (const [label, data] of [['LIVE', { sets: live.meta.sets, printings: live.printings }], ['NEU', await riftbound.fetchCatalog()]] as const) {
  const pool = deckPool('riftbound', data.printings as any, data.sets as any);
  const kaisa = pool.legends.filter((l) => l.championOf === "Kai'Sa" || l.name.includes("Kai'Sa") || l.id.includes('Daughter of the Void'));
  console.log(label, 'cards', pool.cards.size, 'kaisa legends', JSON.stringify(kaisa.map((l) => [l.id, l.name, l.domains])));
  for (const legend of kaisa) {
    const main = new Set(mainCardsFor(legend, pool).map((c) => c.id));
    const expected = [...pool.cards.values()].filter((c) => !['legend', 'rune', 'battlefield'].includes(c.kind) && c.domains.length && c.domains.every((d) => d === 'Colorless' || legend.domains.includes(d)) && (!c.signature || c.championOf === legend.championOf));
    const missing = expected.filter((c) => !main.has(c.id));
    console.log(label, legend.id, 'main', main.size, 'expected', expected.length, 'missing', JSON.stringify(missing.map((c) => c.id)), 'BT in deck', main.has('Bilgewater Tracker'));
  }
  // Karten im Pool ohne Domain (würden überall erscheinen)
  console.log(label, 'NODOMAIN', JSON.stringify([...pool.cards.values()].filter((c) => !c.domains.length && !['battlefield'].includes(c.kind)).map((c) => c.id)));
}
