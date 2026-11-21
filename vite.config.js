import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: false,
  // Keep existing public assets in place while Vercel packages the Express
  // function and CDN files from the same directory.
  build: { outDir: 'public', emptyOutDir: false },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4173',
    },
  },
})
