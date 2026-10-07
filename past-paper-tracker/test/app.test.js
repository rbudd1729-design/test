'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { build, OUT } = require('../build.js');

test('built app file is up to date and self-contained', () => {
  const html = fs.readFileSync(OUT, 'utf8');
  assert.equal(html, build(), 'run npm run build');
  assert.doesNotMatch(html, /<script[^>]+src=/i, 'no external scripts');
  assert.doesNotMatch(html, /<link[^>]+rel="stylesheet"/i, 'no external stylesheets');
  assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/i, 'no network URLs');
  assert.doesNotMatch(html, /\/\*__(LOGIC|APP)__\*\//, 'all placeholders filled');
});
