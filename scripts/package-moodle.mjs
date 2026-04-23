#!/usr/bin/env node
// Packages the Moodle bottomeditor activity plugin as an installable zip.
// Run via: npm run build:moodle
// Output:  dist/bottomeditor-moodle.zip
//
// Install on Moodle: extract into mod/ so the result is
//   mod/bottomeditor/version.php  (and siblings)

import { execSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC  = join(ROOT, 'moodle', 'bottomeditor');
const DIST = join(ROOT, 'dist');
const OUT  = join(DIST, 'bottomeditor-moodle.zip');

if (!existsSync(SRC)) {
    console.error(`Plugin source not found: ${SRC}`);
    process.exit(1);
}

mkdirSync(DIST, { recursive: true });

console.log('Packaging Moodle plugin…');
execSync(
    `zip -r "${OUT}" bottomeditor -x "*.DS_Store"`,
    { cwd: join(ROOT, 'moodle'), stdio: 'inherit' }
);
console.log(`Written to: ${OUT}`);
