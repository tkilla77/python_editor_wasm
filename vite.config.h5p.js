// vite.config.h5p.js
// Produces the IIFE bundle for the H5P library package.
// Run with: npm run build:h5p
// Output: h5p/H5P.BottomExercise-1.0/scripts/bottom-exercise.iife.js
import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
    publicDir: false,
    worker: {
        format: 'iife',
        rollupOptions: {
            external: [
                'node-fetch', 'node:crypto', 'node:url', 'node:fs',
                'node:fs/promises', 'node:vm', 'node:path', 'node:child_process',
            ],
        },
    },
    build: {
        outDir: 'h5p/H5P.BottomExercise-1.0/scripts',
        emptyOutDir: false,
        lib: {
            entry: resolve(__dirname, 'src/exercise.ts'),
            name: 'BottomExercise',
            formats: ['iife'],
            fileName: () => 'bottom-exercise.iife.js',
        },
        rollupOptions: {
            // Everything bundled — H5P iframe has no external module loader
            external: [],
            output: {
                // Inline web workers as data URIs so the single JS file is
                // self-contained and the LMS doesn't need to serve worker files
                // at a predictable path.
                inlineDynamicImports: true,
            },
        },
    },
})
