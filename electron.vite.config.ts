import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'scan-worker': resolve('src/main/ingest/scan-worker.ts')
        }
      }
    }
  },
  preload: { build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } } } },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
