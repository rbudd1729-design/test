'use strict';
// Builds the single self-contained app file from src/. Usage: node build.js [--check]
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'past-paper-tracker.html');

function build() {
  const read = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
  // Guard against a stray "</script>" ending an inline script early.
  const inline = (f) => {
    const js = read(f);
    if (/<\/script/i.test(js)) throw new Error(`${f} contains "</script"`);
    return js.trimEnd();
  };
  return read('app.html')
    .replace('/*__LOGIC__*/', () => inline('logic.js'))
    .replace('/*__SAMPLE__*/', () => inline('sample.js'))
    .replace('/*__APP__*/', () => inline('app.js'));
}

if (require.main === module) {
  const html = build();
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (current !== html) { console.error('past-paper-tracker.html is out of date: run npm run build'); process.exit(1); }
    console.log('past-paper-tracker.html is up to date');
  } else {
    fs.writeFileSync(OUT, html);
    console.log(`Wrote ${path.relative(process.cwd(), OUT)} (${html.length} bytes)`);
  }
}

module.exports = { build, OUT };
