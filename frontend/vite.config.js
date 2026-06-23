import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// STAFF APP build → served at /app/ (its own bundle, separate from the homepage).
// The homepage is built separately via vite.home.config.js into the dist root.
export default defineConfig({
  plugins: [react()],
  base: '/app/',
  build: {
    outDir: 'dist/app',
    emptyOutDir: true,           // only empties dist/app, never the homepage at dist root
    rollupOptions: { input: 'app.html' },
  },
  server: {
    proxy: { '/api': 'http://localhost:8000' },
  },
})
