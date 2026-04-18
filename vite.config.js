// vite.config.js
import { resolve } from 'path'
import { defineConfig } from 'vite'

/**
 * Vite plugin: emits stable-named lib entry files that re-export from the
 * hashed chunk. Needed because lib entries get merged with HTML page entries
 * in Vite's combined lib+MPA build and lose their stable names.
 *
 * entries: { 'bottom-editor': 'src/editor.ts', 'kara-editor': 'src/kara-editor.ts' }
 * emits: bottom-editor.js → "export * from './editor-[hash].js'"
 */
function stableLibEntriesPlugin(entries) {
    return {
        name: 'stable-lib-entries',
        generateBundle(_, bundle) {
            for (const [name, srcPath] of Object.entries(entries)) {
                const rel = resolve(__dirname, srcPath);
                // Prefer exact facadeModuleId match; fall back to the chunk
                // with fewest modules (avoids matching large HTML page bundles).
                const chunks = Object.values(bundle).filter(
                    c => c.type === 'chunk' && c.moduleIds?.includes(rel)
                );
                const chunk = chunks.find(c => c.facadeModuleId === rel)
                    ?? chunks.sort((a, b) => a.moduleIds.length - b.moduleIds.length)[0];
                if (chunk) {
                    this.emitFile({
                        type: 'asset',
                        fileName: `${name}.js`,
                        source: `export * from './${chunk.fileName}';\n`,
                    });
                }
            }
        },
    };
}

export default defineConfig({
  base: '',
  worker: {
    format: 'iife',
    rollupOptions: {
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
    }
  },
  plugins: [
    stableLibEntriesPlugin({
        'bottom-editor':      'src/editor.ts',
        'bottom-exercise':    'src/exercise.ts',
        'kara-editor':        'src/kara-editor.ts',
        'kara-editor-page':   'src/kara-editor-page.ts',
    }),
    {
      // Plugin to set COOP/COEP headers for SharedArrayBuffer support in dev/preview
      name: 'coop-coep-headers',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
          next();
        });
      }
    }
  ],
  build: {
    lib: {
      entry: {
        'bottom-editor':   resolve(__dirname, 'src/editor.ts'),
        'bottom-exercise': resolve(__dirname, 'src/exercise.ts'),
        'kara-editor':     resolve(__dirname, 'src/kara-editor.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      input: {
        index:             resolve(__dirname, 'index.html'),
        embed:             resolve(__dirname, 'embed.html'),
        exercise:          resolve(__dirname, 'exercise.html'),
        'exercise-view':   resolve(__dirname, 'exercise-view.html'),
        kara:              resolve(__dirname, 'kara.html'),
        'kara-demo':       resolve(__dirname, 'kara-demo.html'),
        'oauth-callback':  resolve(__dirname, 'oauth-callback.html'),
      },
      output: {
        entryFileNames: '[name]-[hash].js',
      },
    },
  },
})