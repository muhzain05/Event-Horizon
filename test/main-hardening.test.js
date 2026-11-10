// Guards against regressions in Electron security settings and privacy promises.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8');

test('renderer is sandboxed and isolated', () => {
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /sandbox: true/);
});

test('external links are limited to https', () => {
  assert.match(main, /protocol === 'https:'/);
  assert.doesNotMatch(main, /shell\.openExternal\(url\)\s*\)/);
});

test('renderer makes no network requests', () => {
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html + css, /https?:\/\/fonts\./);
});

test('development switches are disabled in packaged builds', () => {
  assert.match(main, /const DEV = !app\.isPackaged/);
  assert.match(main, /DEV && process\.env\.HORIZON_SHOT/);
});

test('PowerShell scripts are never written to disk before running elevated', () => {
  const ps = fs.readFileSync(path.join(root, 'src/main/powershell.js'), 'utf8');
  assert.doesNotMatch(ps, /writeFile|tmpdir|'-File'/);
  assert.match(ps, /-EncodedCommand/);
  assert.doesNotMatch(main, /writeFileSync\([^)]*stats-worker/);
  assert.doesNotMatch(main, /'-File'/);
});

test('tweak IDs are visible and selectable', () => {
  const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  assert.match(app, /<small class="muted tweak-id">ID: \$\{esc\(t\.id\)\}<\/small>/);
  assert.match(css, /\.tcard \.tweak-id\s*\{[^}]*user-select:\s*text/);
});

