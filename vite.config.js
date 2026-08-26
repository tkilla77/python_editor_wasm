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
                const rel = resolve(import.meta.dirname, srcPath);
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
        // In dev, /bottom-editor.js etc. don't exist as files — serve shims
        // that re-export from the real source so doc pages work with `vite`.
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const url = (req.url ?? '').split('?')[0];
                for (const [name, srcPath] of Object.entries(entries)) {
                    if (url === `/${name}.js`) {
                        res.setHeader('Content-Type', 'application/javascript');
                        res.end(`export * from '/${srcPath}';\n`);
                        return;
                    }
                }
                next();
            });
        },
    };
}

export default defineConfig({
  base: '',
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        // Force everything (incl. CJS-interop helper chunks) into the single
        // blob — relative chunk imports can't resolve from a blob: URL.
        codeSplitting: false,
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
    }
  },
  plugins: [
    stableLibEntriesPlugin({
        'bottom-editor':      'src/editor.ts',
        'bottom-exercise':    'src/exercise.ts',
        'kara-editor':        'src/kara-editor.ts',
        'kara-editor-page':   'src/kara-editor-page.ts',
        'kara-exercise':      'src/kara-exercise.ts',
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
        'bottom-editor':   resolve(import.meta.dirname, 'src/editor.ts'),
        'bottom-exercise': resolve(import.meta.dirname, 'src/exercise.ts'),
        'kara-editor':     resolve(import.meta.dirname, 'src/kara-editor.ts'),
        'kara-exercise':   resolve(import.meta.dirname, 'src/kara-exercise.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      input: {
        index:             resolve(import.meta.dirname, 'index.html'),
        embed:             resolve(import.meta.dirname, 'embed.html'),
        exercise:          resolve(import.meta.dirname, 'exercise.html'),
        'exercise-view':   resolve(import.meta.dirname, 'exercise-view.html'),
        kara:              resolve(import.meta.dirname, 'kara.html'),
        'oauth-callback':  resolve(import.meta.dirname, 'oauth-callback.html'),
        // kara-exercise.ts has no HTML page importing it; add directly so
        // Rollup preserves it as an entry and stableLibEntriesPlugin can emit
        // the stable kara-exercise.js stub.
        'kara-exercise':   resolve(import.meta.dirname, 'src/kara-exercise.ts'),
      },
      output: {
        entryFileNames: '[name]-[hash].js',
      },
    },
  },
})