// vite.config.js
import { resolve } from 'path'
import { readFileSync, readdirSync } from 'fs'
import { defineConfig } from 'vite'
import { marked } from 'marked'

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

/** Convert one markdown string to an HTML page string.
 *  scriptTags: extra <script> tags to inject (already-escaped).
 *  depth: path depth below dist/ (1 = dist/doc/, so assets are at ../) */
function mdToHtml(md, scriptTags) {
    // marked treats blank lines inside unknown elements as paragraph boundaries.
    // Collapse them inside <bottom-editor> and <kara-editor> blocks first.
    // Mask fenced code blocks and inline code spans so the regex below doesn't
    // match <bottom-editor>/<kara-editor> tags that appear inside them.
    const masked = md
        .replace(/```[\s\S]*?```/g, m => m.replace(/</g, '\x00'))
        .replace(/`[^`\n]+`/g, m => m.replace(/</g, '\x00'));
    const cleaned = masked.replace(
        /(<(?:bottom|kara)-(?:editor|exercise)[^>]*>)([\s\S]*?)(<\/(?:bottom|kara)-(?:editor|exercise)>)/g,
        (_, open, content, close) => open + content.replace(/\n\n+/g, '\n') + close,
    );
    const clean = cleaned.replace(/\x00/g, '<');
    const body = marked.parse(clean);
    const titleMatch = md.match(/^#\s+(.+)/m);
    const title = titleMatch ? titleMatch[1] : 'Documentation';
    return `<!doctype html>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
${scriptTags}
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: system-ui, sans-serif;
    max-width: 860px;
    margin: 2rem auto;
    padding: 0 1.5rem 4rem;
    color: #1e293b;
    background: #fafafa;
    line-height: 1.6;
  }
  h1 { font-size: 1.875rem; font-weight: 800; margin-bottom: 0.25rem; }
  h2 { font-size: 1.25rem; font-weight: 700; margin: 2.5rem 0 0.5rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.25rem; }
  p  { margin: 0.5rem 0; color: #334155; }
  a  { color: #2563eb; }
  hr { border: none; border-top: 1px solid #e2e8f0; margin: 2rem 0; }
  pre {
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 0.4em;
    padding: 0.8em 1em;
    overflow-x: auto;
    font-size: 0.85em;
    margin: 0.75rem 0;
  }
  code { font-family: ui-monospace, monospace; font-size: 0.875em; }
  p code, li code { background: #f1f5f9; padding: 0.1em 0.3em; border-radius: 0.25em; }
  table { border-collapse: collapse; width: 100%; margin: 0.75rem 0; font-size: 0.875rem; }
  th { background: #f1f5f9; text-align: left; }
  th, td { padding: 0.4em 0.75em; border: 1px solid #e2e8f0; }
  bottom-editor, kara-editor { margin: 1rem 0; }
  .dark-editor {
    --be-border: none;
    --be-border-radius: 0.25em;
    --be-editor-bg: #1e1e1e;
    --be-output-bg: #111;
  }
</style>
<body>
${body}
</body>
`;
}

/** Vite plugin: converts doc/*.md → dist/doc/*.html at build time. */
function markdownDocPlugin() {
    const virtualId = 'virtual:doc-html';
    const resolvedId = '\0' + virtualId;
    return {
        name: 'markdown-doc',
        resolveId(id) { if (id === virtualId) return resolvedId; },
        load(id) { if (id === resolvedId) return ''; },
        generateBundle() {
            const docDir = resolve(__dirname, 'doc');
            const files = readdirSync(docDir).filter(f => f.endsWith('.md'));
            for (const file of files) {
                const md = readFileSync(resolve(docDir, file), 'utf8');
                // Inline <script> tags already present in kara.md (for kara-editor);
                // for index.md inject bottom-editor.js from the parent dir.
                const scripts = file === 'kara.md'
                    ? `<script type="module" src="../kara-editor.js"><\/script>`
                    : `<script type="module" src="../bottom-editor.js"><\/script>\n<script type="module" src="../bottom-exercise.js"><\/script>`;
                const html = mdToHtml(md, scripts, 1);
                const outName = file.replace(/\.md$/, '.html');
                this.emitFile({ type: 'asset', fileName: `doc/${outName}`, source: html });
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
    markdownDocPlugin(),
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
        index:       resolve(__dirname, 'index.html'),
        embed:       resolve(__dirname, 'embed.html'),
        exercise:    resolve(__dirname, 'exercise.html'),
        kara:        resolve(__dirname, 'kara.html'),
        'kara-demo': resolve(__dirname, 'kara-demo.html'),
      },
      output: {
        entryFileNames: '[name]-[hash].js',
      },
    },
  },
})