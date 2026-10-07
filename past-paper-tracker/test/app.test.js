'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const L = require('../src/logic.js');
const Sample = require('../src/sample.js');
const { build, OUT } = require('../build.js');

function makeEnv() {
  let n = 0;
  return { id: () => `id${++n}`, now: () => new Date(Date.UTC(2026, 9, 7, 9, 0, n)).toISOString() };
}

test('built app file is up to date and self-contained', () => {
  const html = fs.readFileSync(OUT, 'utf8');
  assert.equal(html, build(), 'run npm run build');
  assert.doesNotMatch(html, /<script[^>]+src=/i, 'no external scripts');
  assert.doesNotMatch(html, /<link[^>]+rel="stylesheet"/i, 'no external stylesheets');
  assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/i, 'no network URLs');
  assert.doesNotMatch(html, /\/\*__(LOGIC|SAMPLE|APP)__\*\//, 'all placeholders filled');
});

test('sample data: valid and covers the requested cases', () => {
  const s = Sample.buildSampleData(L, makeEnv(), new Date(2026, 9, 7));
  assert.deepEqual(L.validateData(s), []);
  const maths = s.courses.find((c) => c.name === 'Maths').id;
  const fm = s.courses.find((c) => c.name === 'Further Maths').id;
  const mathsPapers = s.papers.filter((p) => p.courseId === maths);
  const fmPapers = s.papers.filter((p) => p.courseId === fm);
  assert.ok(mathsPapers.length >= 3 && fmPapers.length >= 3, 'a few papers per course');
  assert.ok(new Set(mathsPapers.map((p) => p.questionCount)).size > 1, 'Maths papers differ in length');
  assert.ok(new Set(fmPapers.map((p) => p.questionCount)).size > 1, 'FM papers differ in length');
  assert.ok(new Set(s.usages.map((u) => u.week)).size > 1, 'usages across more than one week');
  assert.equal(s.questions.filter((q) => q.unusable).length, 1, 'one unusable question');
  const inactiveWithUsage = s.classPapers.filter((r) => !r.active &&
    s.usages.some((u) => u.classId === r.classId && L.getQuestion(s, u.questionId).paperId === r.paperId));
  assert.ok(inactiveWithUsage.length >= 1, 'an inactive paper that has usage');
  const y12 = s.classes.find((c) => c.name === 'Y12 Maths').id;
  assert.equal(s.settings.selectedClassId, y12);
  const twice = s.questions.some((q) => L.cellState(s, y12, q.id).count > 1);
  assert.ok(twice, 'a question used twice shows ×2');
});

test('stress data: 50 papers × 20 questions, all active, valid', () => {
  const s = Sample.buildStressData(L, makeEnv(), new Date(2026, 9, 7));
  assert.deepEqual(L.validateData(s), []);
  assert.equal(s.papers.length, 50);
  assert.equal(s.questions.length, 1000);
  const g = L.buildGrid(s, s.settings.selectedClassId);
  assert.equal(g.columns.length, 50);
  assert.equal(g.rowCount, 20);
  assert.ok(s.usages.length > 200);
});
