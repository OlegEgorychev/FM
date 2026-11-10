#!/usr/bin/env node
/*
 * Youth Academy Manager — build script (no dependencies).
 * Concatenates src/css/*.css and src/js/*.js (in file-name order) into the
 * template src/index.html and writes the single playable file ./index.html.
 *
 *   node build.js          build index.html
 *   node build.js --check  fail if index.html is not up to date (use before committing)
 *
 * Versioning rule (enforced): APP_VERSION in src/js/08-version-patch-notes.js
 * must equal the newest PATCH_NOTES entry; the version is injected into <title>.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'index.html');

const read = p => fs.readFileSync(p, 'utf8');
const listDir = dir => fs.readdirSync(dir).filter(f => !f.startsWith('.')).sort();

function build() {
  const template = read(path.join(SRC, 'index.html'));
  const css = listDir(path.join(SRC, 'css')).filter(f => f.endsWith('.css')).map(f => read(path.join(SRC, 'css', f))).join('');
  const jsFiles = listDir(path.join(SRC, 'js')).filter(f => f.endsWith('.js'));
  const js = jsFiles.map(f => read(path.join(SRC, 'js', f))).join('');

  const verFile = jsFiles.map(f => read(path.join(SRC, 'js', f))).join('');
  const m = verFile.match(/const APP_VERSION = '([\d.]+)'/);
  if (!m) throw new Error('APP_VERSION not found in src/js');
  const version = m[1];
  const top = verFile.match(/const PATCH_NOTES = \[\s*\{\s*v: '([\d.]+)'/);
  if (!top) throw new Error('PATCH_NOTES not found in src/js');
  if (top[1] !== version) {
    throw new Error(`Versioning rule: APP_VERSION is ${version} but the newest PATCH_NOTES entry is ${top[1]}. Add patch notes for v${version} at the top.`);
  }

  for (const key of ['{{CSS}}', '{{JS}}', '{{VERSION}}']) {
    if (!template.includes(key)) throw new Error(`Template is missing ${key}`);
  }
  const html = template
    .replace('{{VERSION}}', version)
    .replace('{{CSS}}', () => css)
    .replace('{{JS}}', () => js);
  return { html, version };
}

const { html, version } = build();
if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? read(OUT) : '';
  if (current !== html) { console.error('index.html is out of date: run `node build.js`'); process.exit(1); }
  console.log(`index.html is up to date (v${version})`);
} else {
  fs.writeFileSync(OUT, html);
  console.log(`Built index.html  v${version}  ${(html.length / 1024).toFixed(0)} KB`);
}
