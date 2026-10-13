/**
 * Ende-zu-Ende-Test mit Kamera-Attrappe: Chromium bekommt ein Video, in dem eine echte Karte
 * (Referenzbild mit künstlicher Kantenabnutzung) auf einer grauen Unterlage liegt. Geprüft wird,
 * dass die App die Karte speichert und Sprache und Zustand selbst einträgt.
 *   npm run build && npx tsx scripts/e2e-scan.ts
 * Voraussetzung: `npm run catalog -- riftbound` ist gelaufen (Bild-Cache), Port 4173 ist frei.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { chromium } from 'playwright';
import type { CatalogFile } from '../src/core/catalog';
import { imageIn } from '../src/core/catalog';
import { boxToVideo, guideRect } from '../src/core/geometry';
import { finishesOf } from '../src/core/foil';

const VIEWPORT = { width: 390, height: 844 };
// So groß, wie die App die Kamera anfragt; Chromium beschneidet andere Formate
const VIDEO = { width: 1920, height: 1080 };
const PORT = 4173;
const URL_ = `http://localhost:${PORT}/`;

let seed = 11;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

export async function cardFrame(image: Buffer, guide: { x: number; y: number; width: number; height: number }, specks: number, out: string, foil = 0) {
  const h = Math.round(guide.height * 0.95);
  const { data, info } = await sharp(image).resize({ height: h }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const r = (3 / 63) * w;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const cx = Math.min(Math.max(x + 0.5, r), w - r), cy = Math.min(Math.max(y + 0.5, r), h - r);
    if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) data[(y * w + x) * 4 + 3] = 0;
  }
  // Foil: Regenbogenschimmer über die ganze Karte
  if (foil) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = (y * w + x) * 4;
    const t = ((x / w) * 2.5 + (y / h) * 1.7) * Math.PI * 2 + (rand() - 0.5) * 1.5;
    for (let i = 0; i < 3; i++) data[k + i] = Math.max(0, Math.min(255, data[k + i] + foil * 127 * Math.sin(t + i * 2.1)));
  }
  for (let i = 0; i < specks; i++) {
    const side = Math.floor(rand() * 4), t = rand(), rad = 2 + rand() * 3;
    const [sx, sy] = side === 0 ? [t * w, 0] : side === 1 ? [w - 1, t * h] : side === 2 ? [t * w, h - 1] : [0, t * h];
    for (let y = Math.floor(sy - rad); y <= sy + rad; y++) for (let x = Math.floor(sx - rad); x <= sx + rad; x++) {
      const k = (y * w + x) * 4;
      if (x < 0 || y < 0 || x >= w || y >= h || Math.hypot(x - sx, y - sy) > rad || data[k + 3] === 0) continue;
      data[k] = data[k + 1] = data[k + 2] = 240;
    }
  }
  const rotated = await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .rotate(1.5, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer({ resolveWithObject: true });
  const left = Math.round(guide.x + guide.width / 2 - rotated.info.width / 2);
  const top = Math.round(guide.y + guide.height / 2 - rotated.info.height / 2);
  const { data: rgb } = await sharp({ create: { width: VIDEO.width, height: VIDEO.height, channels: 3, background: { r: 105, g: 110, b: 112 } } })
    .composite([{ input: rotated.data, left, top }])
    .blur(0.7)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  await writeFile(out, toY4m(rgb, VIDEO.width, VIDEO.height, 20));
}

/** Standbild als Y4M-Video (YUV 4:2:0), das Format, das Chromium als Kamera-Attrappe abspielt. */
function toY4m(rgb: Buffer, w: number, h: number, frames: number): Buffer {
  const Y = Buffer.alloc(w * h);
  const U = Buffer.alloc((w / 2) * (h / 2));
  const V = Buffer.alloc((w / 2) * (h / 2));
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = (y * w + x) * 3;
    Y[y * w + x] = clamp(0.299 * rgb[k] + 0.587 * rgb[k + 1] + 0.114 * rgb[k + 2]);
  }
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    let r = 0, g = 0, b = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const k = ((y + dy) * w + (x + dx)) * 3;
      r += rgb[k] / 4;
      g += rgb[k + 1] / 4;
      b += rgb[k + 2] / 4;
    }
    const i = (y / 2) * (w / 2) + x / 2;
    U[i] = clamp(128 - 0.168736 * r - 0.331264 * g + 0.5 * b);
    V[i] = clamp(128 + 0.5 * r - 0.418688 * g - 0.081312 * b);
  }
  const frame = Buffer.concat([Buffer.from('FRAME\n'), Y, U, V]);
  return Buffer.concat([Buffer.from(`YUV4MPEG2 W${w} H${h} F10:1 Ip A1:1 C420jpeg\n`), ...Array(frames).fill(frame)]);
}

async function main() {
  const file: CatalogFile = JSON.parse(await readFile('public/data/riftbound/catalog.json', 'utf8'));
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'inherit' });
  await new Promise((r) => setTimeout(r, 3000));
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'e2e-'));
  let failures = 0;

  // Größe des Suchers messen, damit die Karte im Video genau im Zielrahmen liegt
  const probe = await chromium.launch();
  const probePage = await probe.newPage({ viewport: VIEWPORT });
  await probePage.goto(URL_);
  const box = await probePage.locator('.viewfinder').boundingBox();
  await probe.close();
  if (!box) throw new Error('Sucher nicht gefunden');
  const guideScreen = guideRect(box.width, box.height);
  const guide = boxToVideo(guideScreen, VIDEO.width, VIDEO.height, box.width, box.height);

  const cases = [
    { lang: 'en', specks: 0, foil: 0, rarity: 'Common' },
    { lang: 'en', specks: 40, foil: 0, rarity: '' },
    { lang: 'zh-CN', specks: 0, foil: 0, rarity: '' },
    { lang: 'en', specks: 0, foil: 0.08, rarity: 'Common' },
  ];
  for (const c of cases) {
    const row = file.refs.findIndex(
      (r, i) =>
        r.lang === c.lang &&
        file.printings[r.p].variant === 'normal' &&
        file.printings[r.p].type !== 'Rune' &&
        (!c.rarity || file.printings[r.p].rarity === c.rarity) &&
        i % 7 === 3,
    );
    const printing = file.printings[file.refs[row].p];
    const url = imageIn(printing, c.lang).imageUrl;
    const image = await readFile(path.join('.cache/images', createHash('sha1').update(url).digest('hex')));
    const video = path.join(tmp, `card-${c.lang}-${c.specks}-${c.foil}.y4m`);
    await cardFrame(image, guide, c.specks, video, c.foil);
    const finishes = finishesOf(printing);
    const expectedFinish = finishes.length === 1 ? finishes[0] : c.foil ? 'foil' : 'normal';

    const browser = await chromium.launch({
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
    });
    const context = await browser.newContext({ viewport: VIEWPORT, permissions: ['camera'] });
    const page = await context.newPage();
    page.on('pageerror', (e) => console.log(`  Seitenfehler: ${e.message}`));
    page.on('console', (m) => m.type() !== 'debug' && console.log(`  Konsole ${m.type()}: ${m.text().slice(0, 200)}`));
    await page.goto(URL_);
    const start = page.getByRole('button', { name: 'Scannen starten' });
    await start.waitFor({ timeout: 180_000 });
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('.overlay button')?.disabled, null, { timeout: 180_000 });
    await start.click();
    // Alle 10 s zeigen, was die App gerade anzeigt, damit ein Hänger nachvollziehbar ist
    const hud = setInterval(async () => {
      const text = await page.locator('.hud, .banner').allInnerTexts().catch(() => []);
      console.log(`  [${c.lang}] ${text.join(' | ').replace(/\s+/g, ' ')}`);
    }, 10_000);
    // Bei knappen Treffern fragt die App nach: dann wie ein Mensch die richtige Karte antippen
    const outcome = await Promise.race([
      page.locator('.recent li').first().waitFor({ timeout: 120_000 }).then(() => 'saved' as const),
      page.locator('.ask').waitFor({ timeout: 120_000 }).then(() => 'asked' as const),
    ]).catch(() => 'timeout' as const);
    let asked = false;
    if (outcome === 'asked') {
      asked = true;
      const shownCandidates = await page.locator('.ask .candidate small').allInnerTexts();
      console.log(`  [${c.lang}] nachgefragt: ${shownCandidates.join(' | ')}`);
      const right = page.locator('.ask .candidate', { hasText: `${printing.setCode} ${printing.collectorNumber}` }).first();
      if (await right.count()) await right.click();
      else await page.getByRole('button', { name: 'Nicht speichern, neu scannen' }).click();
    }
    const saved = await page.locator('.recent li').first().waitFor({ timeout: outcome === 'timeout' ? 1 : 120_000 }).then(() => true, () => false);
    clearInterval(hud);
    if (!saved) {
      failures++;
      console.log(`FEHLER ${printing.printingId} [${c.lang}]: nach 120 s nichts gespeichert`);
      await browser.close();
      continue;
    }
    const shown = (await page.locator('.recent li').first().innerText()).replace(/\s+/g, ' ');
    const items = await page.evaluate(
      () =>
        new Promise<{ printingId: string; language: string; condition: string; finish: string; confirmed: boolean }[]>((resolve, reject) => {
          const req = indexedDB.open('cardscanner');
          req.onsuccess = () => {
            const all = req.result.transaction('collection').objectStore('collection').getAll();
            all.onsuccess = () => resolve(all.result);
            all.onerror = () => reject(all.error);
          };
          req.onerror = () => reject(req.error);
        }),
    );
    // Automatisch gespeichert: „Richtig“ bestätigen
    let verified = true;
    const rightButton = page.locator('.recent li').first().getByRole('button', { name: 'Richtig' });
    if (await rightButton.count()) {
      await rightButton.click();
      verified = await page.locator('.recent li').first().getByText('✓ bestätigt').waitFor({ timeout: 5000 }).then(() => true, () => false);
      console.log(`  [${c.lang}] „Richtig“ gedrückt: ${verified ? 'bestätigt' : 'NICHT bestätigt'}`);
    }
    await page.screenshot({ path: path.join(tmp, `scan-${c.lang}-${c.specks}.png`) });
    await browser.close();

    const item = items[0];
    // Gespeichert mit erkannter Sprache, angezeigt aber immer mit englischem Namen
    const ok = !!item && item.printingId === printing.printingId && item.language === c.lang && !!item.condition && item.finish === expectedFinish && shown.includes(printing.cardName) && verified;
    const estimated = /Zustand geschätzt/.test(shown);
    if (!ok) failures++;
    console.log(
      `${ok ? 'OK  ' : 'FEHLER'} ${printing.printingId} [${c.lang}, ${c.specks} Abnutzungsflecken, Foil ${c.foil}, ${printing.rarity}, erwartet ${expectedFinish}${asked ? ', nach Nachfrage' : ''}] → gespeichert: ${item ? `${item.printingId}, Sprache ${item.language}, Zustand ${item.condition}, ${item.finish}` : 'nichts'}; ${estimated ? 'Zustand geschätzt' : 'Zustand NICHT geschätzt'}\n     Anzeige: ${shown}`,
    );
  }
  server.kill();
  if (failures) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
