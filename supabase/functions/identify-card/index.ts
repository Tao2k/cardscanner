// ScannR: Cloud-Hilfe für unsichere Scans. Die App schickt das Kamerabild der Karte und die
// Kandidaten der Bilderkennung (mit Vergleichsbild); Claude liest Name und Sammlernummer und sagt,
// welcher Kandidat es ist. Nur für angemeldete Personen, mit Tageslimit (migrations/0007_cloud_scan.sql).
// Einrichten: supabase/README.md, Abschnitt „Cloud-Hilfe beim Scannen“.
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

/** Modell und Tageslimit lassen sich über Secrets ändern, ohne die Funktion neu zu verteilen. */
const MODEL = Deno.env.get('CLAUDE_MODEL') ?? 'claude-opus-5-5';
const MAX_PER_DAY = Number(Deno.env.get('CLOUD_SCANS_PER_DAY') ?? '200');
const MAX_CANDIDATES = 8;
/** Bilder als Base64; ein Kamerabild hat etwa 150 KB. */
const MAX_IMAGE_CHARS = 2_000_000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type MediaType = 'image/jpeg' | 'image/png' | 'image/webp';
interface Image {
  data: string;
  type: MediaType;
}
interface Candidate {
  id: string;
  name: string;
  set: string;
  number: string;
  variant: string;
  image?: Image;
}
interface ScanRequest {
  game: string;
  photo: Image;
  candidates: Candidate[];
}

/** Antwort von Claude (strukturierte Ausgabe). */
const SCHEMA = {
  type: 'object',
  properties: {
    candidate: { type: ['integer', 'null'], description: 'Nummer des passenden Kandidaten (1, 2, …) oder null, wenn keiner passt' },
    name: { type: ['string', 'null'], description: 'Kartenname, wie er auf dem Foto steht' },
    number: { type: ['string', 'null'], description: 'Sammlernummer vom Foto, z. B. 114/298 oder OGN-114' },
    sure: { type: 'boolean', description: 'true nur, wenn Name und Variante eindeutig zu erkennen sind' },
  },
  required: ['candidate', 'name', 'number', 'sure'],
  additionalProperties: false,
} as const;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const validImage = (img: unknown): img is Image =>
  !!img &&
  typeof (img as Image).data === 'string' &&
  (img as Image).data.length <= MAX_IMAGE_CHARS &&
  ['image/jpeg', 'image/png', 'image/webp'].includes((img as Image).type);

function parse(body: unknown): ScanRequest | null {
  const r = body as ScanRequest;
  if (!r || typeof r.game !== 'string' || !validImage(r.photo) || !Array.isArray(r.candidates)) return null;
  const candidates = r.candidates.slice(0, MAX_CANDIDATES).filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string');
  return {
    game: r.game.slice(0, 60),
    photo: r.photo,
    candidates: candidates.map((c) => ({
      id: c.id,
      name: String(c.name).slice(0, 100),
      set: String(c.set ?? '').slice(0, 20),
      number: String(c.number ?? '').slice(0, 20),
      variant: String(c.variant ?? '').slice(0, 30),
      image: validImage(c.image) ? c.image : undefined,
    })),
  };
}

function prompt(req: ScanRequest): Anthropic.Beta.BetaContentBlockParam[] {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: 'text', text: `Foto einer ${req.game}-Karte, aufgenommen mit der Handykamera (kann Spiegelung, Schatten oder Hülle haben):` },
    { type: 'image', source: { type: 'base64', media_type: req.photo.type, data: req.photo.data } },
    { type: 'text', text: 'Kandidaten aus der Bilderkennung, jeweils mit Originalbild, wo vorhanden:' },
  ];
  req.candidates.forEach((c, i) => {
    content.push({ type: 'text', text: `Kandidat ${i + 1}: ${c.name} · Set ${c.set} · Nr. ${c.number} · Variante ${c.variant}` });
    if (c.image) content.push({ type: 'image', source: { type: 'base64', media_type: c.image.type, data: c.image.data } });
  });
  content.push({
    type: 'text',
    text:
      'Welcher Kandidat ist die Karte auf dem Foto? Lies Name und Sammlernummer auf dem Foto und vergleiche Bildmotiv und ' +
      'Rahmen mit den Originalbildern, damit auch die Variante (z. B. alternatives Artwork, Showcase, Signatur) stimmt. ' +
      'Passt keiner, gib candidate = null und den gelesenen Namen und die Nummer zurück. ' +
      'sure = true nur, wenn du dir bei Karte und Variante sicher bist.',
  });
  return content;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Nur POST' }, 405);
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY fehlt (Supabase → Edge Functions → Secrets)' }, 503);

  // Angemeldet? Und noch im Tageslimit? (zählt mit der Anmeldung der Person, nicht mit Admin-Rechten)
  const auth = request.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: allowed, error: limitError } = await supabase.rpc('use_cloud_scan', { max_per_day: MAX_PER_DAY });
  if (limitError) return json({ error: `Tageslimit nicht prüfbar (${limitError.message}). Ist 0007_cloud_scan.sql ausgeführt?` }, 503);
  if (!allowed) return json({ error: 'Tageslimit erreicht' }, 429);

  const req = parse(await request.json().catch(() => null));
  if (!req) return json({ error: 'Ungültige Anfrage' }, 400);

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: prompt(req) }],
    });
    if (response.stop_reason === 'refusal') return json({ error: 'Abgelehnt' }, 502);
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return json({ error: 'Keine Antwort' }, 502);
    const answer = JSON.parse(text.text) as { candidate: number | null; name: string | null; number: string | null; sure: boolean };
    const picked = answer.candidate ? req.candidates[answer.candidate - 1] : undefined;
    return json({ printingId: picked?.id ?? null, name: answer.name, number: answer.number, sure: !!picked && answer.sure });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'Zu viele Anfragen, gleich nochmal' }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: 'ANTHROPIC_API_KEY ungültig' }, 503);
    if (e instanceof Anthropic.APIError) return json({ error: `Claude: ${e.status} ${e.message}` }, 502);
    return json({ error: (e as Error).message }, 500);
  }
});
