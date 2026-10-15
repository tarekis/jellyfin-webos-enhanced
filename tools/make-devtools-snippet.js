#!/usr/bin/env node

// Writes build/seerr-devtools-snippet.js: paste it into the DevTools console of
// the Jellyfin web UI in a desktop browser to try the Seerr overlay without a TV.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'frontend/css/seerr.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'frontend/js/seerr.js'), 'utf8');

const snippet = [
  '(function () {',
  '  var style = document.createElement("style");',
  `  style.textContent = ${JSON.stringify(css)};`,
  '  document.head.appendChild(style);',
  '})();',
  js,
  '',
].join('\n');

fs.mkdirSync(path.join(root, 'build'), { recursive: true });
const out = path.join(root, 'build/seerr-devtools-snippet.js');
fs.writeFileSync(out, snippet);
console.log(`Wrote ${out}`);
