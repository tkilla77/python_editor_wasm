#!/usr/bin/env node
// Usage:
//   node scripts/deploy.js            — build + push to latest
//   node scripts/deploy.js --stable   — build + push to latest + flip stable
//   node scripts/deploy.js --no-build — skip the build step

import { execSync } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// --- config ---
const configPath = resolve(root, 'deploy.config.json')
if (!existsSync(configPath)) {
    console.error('deploy.config.json not found — copy deploy.config.example.json and fill in host/path')
    process.exit(1)
}
const { host, path: remotePath } = JSON.parse(readFileSync(configPath, 'utf8'))
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

// --- flags ---
const stable  = process.argv.includes('--stable')
const noBuild = process.argv.includes('--no-build')

const run = cmd => execSync(cmd, { stdio: 'inherit', cwd: root })

// --- build ---
if (!noBuild) {
    console.log('\nBuilding (--mode prod)...')
    run('npm run build -- --mode prod')
    console.log('\nPackaging DokuWiki plugin...')
    run('npm run build:dokuwiki')
}

// --- deploy versioned dir ---
console.log(`\nDeploying v${version} → ${host}:${remotePath}/${version}/`)
run(`rsync -a --delete dist/ ${host}:${remotePath}/${version}/`)

// --- update latest ---
console.log(`Updating latest → ${version}`)
run(`ssh ${host} "ln -sfn ${version} ${remotePath}/latest"`)

// --- optionally flip stable ---
if (stable) {
    console.log(`Updating stable → ${version}`)
    run(`ssh ${host} "ln -sfn ${version} ${remotePath}/stable"`)
}

console.log('\nDone.')
