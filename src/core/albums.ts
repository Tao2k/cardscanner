/** Eigenes Album mit Lieblingskarten; Freunde können es ansehen. */
export interface Album {
  id: string;
  name: string;
  /** Karten als „gameId|printingId“, in der Reihenfolge, in der sie dazukamen. */
  cards: string[];
  createdAt: string;
  updatedAt: string;
}

/** Höchstzahl Karten je Album (wie in 0006_albums.sql). */
export const MAX_ALBUM_CARDS = 1000;
export const MAX_ALBUM_NAME = 40;

/** Name bereinigen: Leerraum zusammenfassen, kürzen; leer bleibt leer. */
export function albumName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_ALBUM_NAME);
}

/** Karte hinten anfügen (nur einmal je Album). */
export function withCard(album: Album, key: string): Album {
  if (album.cards.includes(key) || album.cards.length >= MAX_ALBUM_CARDS) return album;
  return { ...album, cards: [...album.cards, key] };
}

export function withoutCard(album: Album, key: string): Album {
  return album.cards.includes(key) ? { ...album, cards: album.cards.filter((k) => k !== key) } : album;
}

/** Alben nach Erstellen sortiert, älteste zuerst (so stehen sie auch als Chips). */
export function sortAlbums(albums: Album[]): Album[] {
  return [...albums].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));
}
