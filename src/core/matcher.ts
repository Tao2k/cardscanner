export interface Match {
  index: number;
  score: number;
}

/** Skaliert einen Vektor in-place auf Länge 1, damit das Skalarprodukt der Kosinus-Ähnlichkeit entspricht. */
export function l2normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

/**
 * Brute-Force-Suche über alle Referenz-Embeddings.
 * Bei einigen tausend Drucken × 384 Dimensionen dauert das auf dem Handy wenige Millisekunden;
 * ein ANN-Index lohnt sich erst bei deutlich größeren Katalogen.
 */
export function topK(query: Float32Array, embeddings: Float32Array, dim: number, k: number): Match[] {
  if (query.length !== dim) throw new Error(`Query hat ${query.length} Dimensionen, erwartet ${dim}`);
  const count = embeddings.length / dim;
  const best: Match[] = [];
  for (let row = 0; row < count; row++) {
    const offset = row * dim;
    let score = 0;
    for (let i = 0; i < dim; i++) score += query[i] * embeddings[offset + i];
    if (best.length < k || score > best[best.length - 1].score) {
      best.push({ index: row, score });
      best.sort((a, b) => b.score - a.score);
      if (best.length > k) best.pop();
    }
  }
  return best;
}
