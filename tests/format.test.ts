import { describe, expect, it } from 'vitest';
import { cardSrcSet } from '../src/app/format';

describe('cardSrcSet', () => {
  it('liefert das Bild in mehreren Breiten als WebP', () => {
    const set = cardSrcSet('https://cdn.example.com/card.png?w=480&fm=png', [240, 720]);
    expect(set).toBe('https://cdn.example.com/card.png?w=240&fm=webp 240w, https://cdn.example.com/card.png?w=720&fm=webp 720w');
  });

  it('lässt Bilder ohne Breitenangabe und relative Pfade in Ruhe', () => {
    expect(cardSrcSet('https://cdn.example.com/card.png', [240])).toBeUndefined();
    expect(cardSrcSet('data/cards/a.svg', [240])).toBeUndefined();
  });
});
