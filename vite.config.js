// vite.config.js
import { resolve } from 'path'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '',
  plugins: [
    tailwindcss(),
  ],
  optimizeDeps: {
    exclude: ['pyodide']
  },
  build: {
    lib: {
      // Could also be a dictionary or array of multiple entry points
      entry: resolve(__dirname, 'src/editor.js'),
      name: 'BottomEditor',
      formats: ['es'],
      // the proper extensions will be added
      fileName: 'bottom-editor',
    },
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        nested: resolve(__dirname, 'embed.html'),
      },
      output: {
        inlineDynamicImports: false,
        format: "module",
      },
      external: [
        "node-fetch",
        "node:crypto",
        "node:url",
        "node:fs",
        "node:fs/promises",
        "node:vm",
        "node:path",
        "node:child_process",
      ],
    },
  },
})