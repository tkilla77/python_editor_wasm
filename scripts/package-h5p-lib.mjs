#!/usr/bin/env node
// Produces a library-only .h5p zip for installing via
// Moodle → Site admin → H5P → Manage H5P content types → Upload content types.
//
// Format: library folder(s) at zip root, no h5p.json or content/.
// Run via: npm run package:h5p-lib
// Output:  h5p/H5P.BottomExercise-1.0.lib.h5p

import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT    = new URL('..', import.meta.url).pathname;
const H5P_DIR = join(ROOT, 'h5p');
const LIB_DIR = join(H5P_DIR, 'H5P.BottomExercise-1.0');
const OUT     = join(H5P_DIR, 'H5P.BottomExercise-1.0.lib.h5p');

console.log('Building IIFE bundle…');
execSync('npm run build:h5p', { cwd: ROOT, stdio: 'inherit' });

console.log('Zipping library…');
rmSync(OUT, { force: true });
execSync(
    `zip -rD "${OUT}" H5P.BottomExercise-1.0 -x "*.DS_Store" -x "*/.gitignore"`,
    { cwd: H5P_DIR, stdio: 'inherit' }
);

console.log(`\nLibrary package written to: ${OUT}`);
