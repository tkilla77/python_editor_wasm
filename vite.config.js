// vite.config.js
import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    exclude: ['pyodided']
  },
  worker: {
    format: "es",
    rollupOptions: {
      output: {
        inlineDynamicImports: false,
        format: "module",
      },
      external: ["node-fetch"],
    },
  },
  build: {
    lib: {
      // Could also be a dictionary or array of multiple entry points
      entry: resolve(__dirname, 'src/editor.js'),
      name: 'BottomEditor',
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
      external: ["node-fetch"],
    },
  },
})