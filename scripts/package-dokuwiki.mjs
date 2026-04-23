#!/usr/bin/env node
// Packages the DokuWiki bottomeditor plugin as a installable zip.
// Run via: npm run build:dokuwiki
// Output:  dist/bottomeditor.zip
//
// Install on DokuWiki: extract into lib/plugins/ so the result is
//   lib/plugins/bottomeditor/plugin.info.txt  (and siblings)

import { execSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT   = new URL('..', import.meta.url).pathname;
const SRC    = join(ROOT, 'dokuwiki', 'bottomeditor');
const DIST   = join(ROOT, 'dist');
const OUT    = join(DIST, 'bottomeditor.zip');

if (!existsSync(SRC)) {
    console.error(`Plugin source not found: ${SRC}`);
    process.exit(1);
}

mkdirSync(DIST, { recursive: true });

console.log('Packaging DokuWiki plugin…');
execSync(
    `zip -r "${OUT}" bottomeditor -x "*.DS_Store" -x "*/test.php"`,
    { cwd: join(ROOT, 'dokuwiki'), stdio: 'inherit' }
);
console.log(`Written to: ${OUT}`);
