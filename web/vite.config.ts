import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
