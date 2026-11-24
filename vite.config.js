import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: 'static',
  // Build the client into public/ for Express and Vercel while copying the
  // installable web app manifest, service worker, and icons from static/.
  build: { outDir: 'public', emptyOutDir: false },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4173',
    },
  },
})
