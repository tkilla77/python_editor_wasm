#!/usr/bin/env node
// Builds the H5P IIFE bundle and produces an installable .h5p content package.
// Run via: npm run package:h5p
// Output: h5p/H5P.H5P.BottomExercise-1.0.h5p
//
// An .h5p file is a zip with this root structure:
//   h5p.json                      ← content-package metadata
//   content/content.json          ← example content instance
//   H5P.H5P.BottomExercise-1.0/      ← library (installed as side-effect)
//     library.json
//     semantics.json
//     scripts/…

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT    = new URL('..', import.meta.url).pathname;
const H5P_DIR = join(ROOT, 'h5p');
const LIB_DIR = join(H5P_DIR, 'H5P.BottomExercise-1.0');
const STAGE   = join(H5P_DIR, '.stage');          // temporary assembly dir
const OUT     = join(H5P_DIR, 'H5P.BottomExercise-1.0.h5p');

// ── 1. Build IIFE ────────────────────────────────────────────────────────────
console.log('Building IIFE bundle…');
execSync('npm run build:h5p', { cwd: ROOT, stdio: 'inherit' });

// ── 2. Assemble staging directory ────────────────────────────────────────────
console.log('Assembling package…');
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(join(STAGE, 'content'), { recursive: true });

// h5p.json — content-package manifest (root level)
writeFileSync(join(STAGE, 'h5p.json'), JSON.stringify({
    title: 'Python Exercise',
    language: 'und',
    mainLibrary: 'H5P.BottomExercise',
    embedTypes: ['iframe'],
    license: 'U',
    defaultLanguage: 'en',
    preloadedDependencies: [
        { machineName: 'H5P.BottomExercise', majorVersion: '1', minorVersion: '0' },
    ],
}, null, 2));

// content/content.json — example exercise shown on first open in Lumi/Moodle
writeFileSync(join(STAGE, 'content', 'content.json'), JSON.stringify({
    exercise: {
        prompt: '<p>Write a function <code>greet(name)</code> that returns <code>\'Hello, name!\'</code>.</p>',
        starterCode: 'def greet(name):\n    pass',
        testCode: "assert greet('World') == 'Hello, World!'\nassert greet('Python') == 'Hello, Python!'",
        solutionCode: "def greet(name):\n    return f'Hello, {name}!'",
        layout: 'console',
    },
    behaviour: {
        enableSolutionsButton: true,
        enableRetry: true,
    },
}, null, 2));

// Copy library folder into staging root
execSync(`cp -r "${LIB_DIR}" "${join(STAGE, 'H5P.BottomExercise-1.0')}"`);

// ── 3. Zip staging dir → .h5p ────────────────────────────────────────────────
console.log('Zipping…');
rmSync(OUT, { force: true });
// -D: no directory entries — the H5P validator rejects them (no file extension).
execSync(
    `zip -rD "${OUT}" . -x "*.DS_Store" -x "*/.gitignore"`,
    { cwd: STAGE, stdio: 'inherit' }
);

rmSync(STAGE, { recursive: true });
console.log(`\nPackage written to: ${OUT}`);
