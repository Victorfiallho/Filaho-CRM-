import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Makes this an installable PWA (manifest + service worker) — the
    // prerequisite for wrapping it as a real Android APK via a Trusted Web
    // Activity (e.g. PWABuilder.com), so the team can install it from a
    // WhatsApp-shared .apk instead of a bookmark. Deliberately does NOT
    // cache API/Supabase calls or navigations — only the built JS/CSS/icon
    // assets — so the app always shows live data and only ever goes stale
    // on the static shell, never on real CRM data.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.png'],
      manifest: {
        name: 'Fialho Home Improvement',
        short_name: 'Fialho CRM',
        description: "CRM for Fialho Home Improvement's home services companies",
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#f97316',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // Default globPatterns already limit precaching to the built
        // JS/CSS/HTML/icons in dist/ — no runtimeCaching rules added, so
        // every fetch("/api/...") and Supabase request bypasses the service
        // worker entirely and always hits the network.
        navigateFallbackDenylist: [/^\/api\//]
      }
    })
  ],
  server: {
    // `npm run dev` (plain Vite) doesn't serve web/api/* — those are Vercel
    // serverless functions, and plain Vite has no concept of them, so a
    // fetch("/api/...") from the app just 404s locally. `vercel dev` does
    // serve them, but as of Vercel CLI 54 has an unrelated bug where it
    // fails to parse this project's index.html (Vite v8 incompatibility),
    // making it unusable for browsing the app itself. Splitting the two —
    // `npm run dev` for the UI, `vercel dev --listen 3000` in a second
    // terminal just for its function runtime — and proxying /api there
    // gets both working at once. Production is unaffected: this `server`
    // block only applies to `vite dev`, never to `vite build`/Vercel prod,
    // which serves web/api/* natively.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
})
