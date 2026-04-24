#!/usr/bin/env node
// Packages Moodle plugins as installable zips.
// Run via: npm run build:moodle
// Output:
//   dist/mod_bottomeditor.zip     — activity module  (install into mod/)
//   dist/filter_bottomeditor.zip  — filter plugin    (install into filter/)

import { execSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT   = new URL('..', import.meta.url).pathname;
const MOODLE = join(ROOT, 'moodle');
const DIST   = join(ROOT, 'dist');

const plugins = [
    { src: 'bottomeditor',        out: 'mod_bottomeditor.zip' },
    { src: 'filter_bottomeditor', out: 'filter_bottomeditor.zip' },
];

for (const { src, out } of plugins) {
    const srcPath = join(MOODLE, src);
    if (!existsSync(srcPath)) {
        console.error(`Plugin source not found: ${srcPath}`);
        process.exit(1);
    }
}

mkdirSync(DIST, { recursive: true });

for (const { src, out } of plugins) {
    const outPath = join(DIST, out);
    console.log(`Packaging ${src}…`);
    execSync(
        `zip -r "${outPath}" ${src} -x "*.DS_Store"`,
        { cwd: MOODLE, stdio: 'inherit' }
    );
    console.log(`Written to: ${outPath}`);
}
