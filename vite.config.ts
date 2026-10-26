import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Auf GitHub Pages liegt die App unter /<repo>/; lokal unter /.
const base = process.env.BASE_PATH ?? '/';

// Versionsangabe für die Einstellungen: Paketversion, Commit und dessen Datum. Bewusst nicht die
// Bauzeit: der tägliche Preis-Build soll keine neue App-Version erzeugen.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const git = (args: string) => {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
};
const commit = git('rev-parse --short HEAD');
const committed = git('log -1 --format=%cI') || new Date().toISOString();

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commit),
    __APP_BUILT__: JSON.stringify(committed),
  },
  plugins: [
    preact(),
    VitePWA({
      // Neue Version übernimmt sofort; wann die Seite neu lädt, entscheidet src/app/updates.ts.
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
      manifest: {
        name: 'ScannR',
        short_name: 'ScannR',
        description: 'Sammelkarten mit der Handykamera erkennen und als Sammlung erfassen',
        lang: 'de',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App-Hülle vorab cachen; Katalog und Modell erst bei Bedarf (groß, ändern sich mit jedem Build).
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        globIgnores: ['data/**', 'models/**'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            // Preise ändern sich täglich und sind klein: immer erst frisch laden, offline aus dem Cache.
            urlPattern: ({ url }) => /\/data\/.+\/price(s|-history)\.json$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: { cacheName: 'prices', networkTimeoutSeconds: 5 },
          },
          {
            urlPattern: ({ url }) => url.pathname.includes('/data/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'catalog' },
          },
          {
            // ONNX-Laufzeit (~20 MB) erst beim ersten Scan laden, danach aus dem Cache.
            urlPattern: ({ url }) => url.pathname.endsWith('.wasm'),
            handler: 'CacheFirst',
            options: { cacheName: 'runtime-wasm', expiration: { maxEntries: 4 } },
          },
          {
            urlPattern: ({ url }) => /\.(png|jpe?g|webp)$/i.test(url.pathname) && url.hostname !== self.location.hostname,
            handler: 'CacheFirst',
            options: { cacheName: 'card-images', expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 90 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  build: { target: 'es2022' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
