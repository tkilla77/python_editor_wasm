#!/usr/bin/env node
// Builds the H5P IIFE bundle and zips the library folder into an installable
// .h5p package. Run via: npm run package:h5p
// Output: h5p/H5P.BottomExercise-1.0.h5p

import { execSync } from 'node:child_process';
import { createWriteStream, readFileSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { readdir, stat } from 'node:fs/promises';

const ROOT    = new URL('..', import.meta.url).pathname;
const LIB_DIR = join(ROOT, 'h5p', 'BottomExercise-1.0');
const OUT     = join(ROOT, 'h5p', 'H5P.BottomExercise-1.0.h5p');

console.log('Building IIFE bundle…');
execSync('npm run build:h5p', { cwd: ROOT, stdio: 'inherit' });

console.log('Zipping H5P package…');

// Use system zip (available on macOS/Linux)
execSync(`zip -r "${OUT}" . -x "*.DS_Store" -x "*/.gitignore" -x "*/.htaccess"`, { cwd: LIB_DIR, stdio: 'inherit' });

console.log(`\nPackage written to: h5p/H5P.BottomExercise-1.0.h5p`);
