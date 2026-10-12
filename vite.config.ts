import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

// Auf GitHub Pages liegt die App unter /<repo>/; lokal unter /.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'CardScanner',
        short_name: 'CardScanner',
        description: 'Sammelkarten mit der Handykamera erkennen und als Sammlung erfassen',
        lang: 'de',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f6f5f2',
        theme_color: '#2f6fdb',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App-Hülle vorab cachen; Katalog und Modell erst bei Bedarf (groß, ändern sich mit jedem Build).
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        globIgnores: ['data/**', 'models/**'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
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
