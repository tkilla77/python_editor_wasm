// vite.config.js
import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
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
        main: resolve(__dirname, 'embed2.html'),
      },
      external: ["node-fetch"],
    },
  },
})