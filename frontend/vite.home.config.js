import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// PUBLIC MARKETING HOMEPAGE build → served at / (dist root). Separate bundle from the
// staff app so the two can never break each other and can be rolled out independently.
// Built FIRST in the npm script (it empties dist), then the app build adds dist/app/.
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { input: 'index.html' },
  },
})
