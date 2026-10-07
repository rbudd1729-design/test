'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/logic.js');

// ---------- fixtures ----------

function makeEnv(start = '2026-10-07T09:00:00.000Z') {
  let n = 0;
  let t = Date.parse(start);
  return {
    id: () => `id${++n}`,
    now: () => new Date((t += 1000)).toISOString(),
  };
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/** Unwraps a successful result, checks the state is still valid, and freezes it so later mutation throws. */
function must(res) {
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(L.validateData(res.state), [], 'state invariants');
  deepFreeze(res.state);
  return res;
}

const course = (s, name) => s.courses.find((c) => c.name === name).id;
const q = (s, paperId, number) => s.questions.find((x) => x.paperId === paperId && x.number === number);

/** Two Maths classes, one Further Maths class, two Maths papers. */
function setup() {
  const env = makeEnv();
  let s = deepFreeze(L.createInitialState(env, new Date(2026, 9, 7)));
  const maths = course(s, 'Maths');
  const fm = course(s, 'Further Maths');
  const y12 = must(L.createClass(s, { name: 'Y12 Maths', courseId: maths }, env));
  s = y12.state;
  const y13 = must(L.createClass(s, { name: 'Y13 Maths', courseId: maths }, env));
  s = y13.state;
  const fm12 = must(L.createClass(s, { name: 'Y12 FM', courseId: fm }, env));
  s = fm12.state;
  const p1 = must(L.addPaper(s, { courseId: maths, name: '2024 P1', questionCount: 10, fromClassId: y12.cls.id }, env));
  s = p1.state;
  const p2 = must(L.addPaper(s, { courseId: maths, name: '2024 P2', questionCount: 20, fromClassId: y12.cls.id }, env));
  s = p2.state;
  s = L.setPaperActive(s, y13.cls.id, p1.paper.id, true).state; // Y13 has P1 active only
  s = deepFreeze(s);
  return { env, s, maths, fm, y12: y12.cls.id, y13: y13.cls.id, fm12: fm12.cls.id, p1: p1.paper.id, p2: p2.paper.id };
}

function setWeek(s, week) {
  return deepFreeze(Object.assign({}, s, { settings: Object.assign({}, s.settings, { currentWeek: week }) }));
}

// ---------- academic year & parsing ----------

test('academic year: inference from date (September to August)', () => {
  assert.equal(L.inferAcademicYear(new Date(2026, 9, 7)), '2026–27');
  assert.equal(L.inferAcademicYear(new Date(2026, 8, 1)), '2026–27');
  assert.equal(L.inferAcademicYear(new Date(2026, 7, 31)), '2025–26');
  assert.equal(L.inferAcademicYear(new Date(2027, 0, 15)), '2026–27');
  assert.equal(L.inferAcademicYear(new Date(2099, 10, 1)), '2099–00');
});

test('academic year: format validation and parsing', () => {
  assert.ok(L.isValidAcademicYear('2026–27'));
  assert.ok(!L.isValidAcademicYear('2026-27'), 'stored form must use en dash');
  assert.ok(!L.isValidAcademicYear('2026–28'), 'years must be consecutive');
  assert.ok(!L.isValidAcademicYear('26–27'));
  assert.ok(!L.isValidAcademicYear('2026–2027'));
  assert.ok(L.isValidAcademicYear('2099–00'));
  assert.equal(L.parseAcademicYear(' 2026-27 '), '2026–27');
  assert.equal(L.parseAcademicYear('2026–27'), '2026–27');
  assert.equal(L.parseAcademicYear('2026-28'), null);
  assert.equal(L.parseAcademicYear('nonsense'), null);
  assert.equal(L.nextAcademicYear('2026–27'), '2027–28');
  assert.equal(L.nextAcademicYear('2099–00'), '2100–01');
});

test('positive integer parsing', () => {
  assert.equal(L.parsePositiveInt('4'), 4);
  assert.equal(L.parsePositiveInt(' 07 '), 7);
  assert.equal(L.parsePositiveInt(3), 3);
  for (const bad of ['0', '-1', '1.5', '1e2', '', ' ', 'abc', '4a', 0, -2, 2.5, NaN, null, undefined]) {
    assert.equal(L.parsePositiveInt(bad), null, `rejects ${JSON.stringify(bad)}`);
  }
});

// ---------- initial state ----------

test('first run seeds exactly Maths and Further Maths and default settings', () => {
  const s = L.createInitialState(makeEnv(), new Date(2026, 9, 7));
  assert.deepEqual(s.courses.map((c) => c.name), ['Maths', 'Further Maths']);
  assert.deepEqual(s.settings, {
    academicYear: '2026–27', currentWeek: 1, selectedClassId: null, weekFilter: 'all', lastExportedAt: null,
  });
  assert.deepEqual(L.validateData(s), []);
});

// ---------- usage constraints ----------

test('usage: create records current year/week and validates pack question', () => {
  const f = setup();
  const s = setWeek(f.s, 7);
  const q7 = q(s, f.p2, 7);
  const r = must(L.createUsage(s, { classId: f.y12, questionId: q7.id, packQuestion: '4' }, f.env));
  assert.equal(r.usage.academicYear, '2026–27');
  assert.equal(r.usage.week, 7);
  assert.equal(r.usage.packQuestion, 4);
  assert.equal(r.usage.createdAt, r.usage.updatedAt);
  for (const bad of ['', '0', '-3', '2.5', 'x']) {
    const e = L.createUsage(s, { classId: f.y12, questionId: q7.id, packQuestion: bad }, f.env);
    assert.equal(e.ok, false);
    assert.match(e.error, /positive whole number/);
  }
});

test('usage: same source question twice in one class/year/week is rejected', () => {
  const f = setup();
  const s = setWeek(f.s, 7);
  const qid = q(s, f.p2, 7).id;
  const s1 = must(L.createUsage(s, { classId: f.y12, questionId: qid, packQuestion: 4 }, f.env)).state;
  const e = L.createUsage(s1, { classId: f.y12, questionId: qid, packQuestion: 5 }, f.env);
  assert.equal(e.ok, false);
  assert.match(e.error, /2024 P2 Q7 is already used in Week 7/);
});

test('usage: same pack question number twice in one class/year/week is rejected', () => {
  const f = setup();
  const s = setWeek(f.s, 7);
  const s1 = must(L.createUsage(s, { classId: f.y12, questionId: q(s, f.p2, 7).id, packQuestion: 4 }, f.env)).state;
  const e = L.createUsage(s1, { classId: f.y12, questionId: q(s, f.p2, 8).id, packQuestion: 4 }, f.env);
  assert.equal(e.ok, false);
  assert.match(e.error, /7\.4 is already assigned to 2024 P2 Q7/);
});

test('usage: reuse allowed across weeks, years and classes', () => {
  const f = setup();
  const qid = q(f.s, f.p1, 3).id;
  let s = setWeek(f.s, 7);
  s = must(L.createUsage(s, { classId: f.y12, questionId: qid, packQuestion: 4 }, f.env)).state;
  // other class, same week, same pack number and question
  s = must(L.createUsage(s, { classId: f.y13, questionId: qid, packQuestion: 4 }, f.env)).state;
  // same class, different week
  s = setWeek(s, 18);
  s = must(L.createUsage(s, { classId: f.y12, questionId: qid, packQuestion: 5 }, f.env)).state;
  // same class, same week number, next academic year
  s = must(L.startNextAcademicYear(s)).state;
  s = setWeek(s, 7);
  s = must(L.createUsage(s, { classId: f.y12, questionId: qid, packQuestion: 4 }, f.env)).state;
  assert.equal(L.usageHistory(s, f.y12, qid).length, 3);
});

test('usage: rejects question from another course, missing class/question', () => {
  const f = setup();
  const e1 = L.createUsage(f.s, { classId: f.fm12, questionId: q(f.s, f.p1, 1).id, packQuestion: 1 }, f.env);
  assert.equal(e1.ok, false);
  assert.match(e1.error, /course/);
  assert.equal(L.createUsage(f.s, { classId: 'nope', questionId: q(f.s, f.p1, 1).id, packQuestion: 1 }, f.env).ok, false);
  assert.equal(L.createUsage(f.s, { classId: f.y12, questionId: 'nope', packQuestion: 1 }, f.env).ok, false);
});

test('usage: cannot record a new use on an unusable question', () => {
  const f = setup();
  const qid = q(f.s, f.p1, 2).id;
  const s = must(L.setUnusable(f.s, qid, true)).state;
  const e = L.createUsage(s, { classId: f.y12, questionId: qid, packQuestion: 1 }, f.env);
  assert.equal(e.ok, false);
  assert.match(e.error, /unusable/);
});

test('usage: edit rechecks constraints, ignores itself, updates updatedAt', () => {
  const f = setup();
  let s = setWeek(f.s, 7);
  const a = must(L.createUsage(s, { classId: f.y12, questionId: q(s, f.p2, 7).id, packQuestion: 4 }, f.env));
  s = a.state;
  const b = must(L.createUsage(s, { classId: f.y12, questionId: q(s, f.p2, 8).id, packQuestion: 5 }, f.env));
  s = b.state;

  // unchanged values are fine (doesn't collide with itself)
  must(L.editUsage(s, a.usage.id, { academicYear: '2026–27', week: '7', packQuestion: '4' }, f.env));
  // collides with b's pack number
  const e = L.editUsage(s, a.usage.id, { academicYear: '2026–27', week: 7, packQuestion: 5 }, f.env);
  assert.equal(e.ok, false);
  assert.match(e.error, /already assigned/);
  // invalid fields
  assert.match(L.editUsage(s, a.usage.id, { academicYear: '2026-28', week: 7, packQuestion: 4 }, f.env).error, /Academic year/);
  assert.match(L.editUsage(s, a.usage.id, { academicYear: '2026-27', week: '0', packQuestion: 4 }, f.env).error, /Week/);
  assert.match(L.editUsage(s, a.usage.id, { academicYear: '2026-27', week: 7, packQuestion: 'x' }, f.env).error, /Pack question/);
  // valid move to another year/week (hyphen input accepted)
  const ok = must(L.editUsage(s, a.usage.id, { academicYear: '2025-26', week: '30', packQuestion: '5' }, f.env));
  assert.equal(ok.usage.academicYear, '2025–26');
  assert.equal(ok.usage.week, 30);
  assert.equal(ok.usage.packQuestion, 5);
  assert.equal(ok.usage.createdAt, a.usage.createdAt);
  assert.notEqual(ok.usage.updatedAt, a.usage.updatedAt);
  assert.equal(L.editUsage(s, 'nope', { academicYear: '2026-27', week: 1, packQuestion: 1 }, f.env).ok, false);
});

test('usage: delete; deleting the last use returns cell to green', () => {
  const f = setup();
  const qid = q(f.s, f.p1, 1).id;
  const a = must(L.createUsage(f.s, { classId: f.y12, questionId: qid, packQuestion: 1 }, f.env));
  assert.equal(L.cellState(a.state, f.y12, qid).status, 'used');
  const d = must(L.deleteUsage(a.state, a.usage.id));
  assert.equal(L.cellState(d.state, f.y12, qid).status, 'available');
  assert.equal(L.deleteUsage(d.state, a.usage.id).ok, false);
});

// ---------- cell states ----------

test('cell state: green / red / dark grey with precedence and labels', () => {
  const f = setup();
  const qid = q(f.s, f.p2, 7).id;
  let s = f.s;
  assert.deepEqual(L.cellState(s, f.y12, qid), { status: 'available', label: '', count: 0, latest: null });

  s = must(L.createUsage(setWeek(s, 7), { classId: f.y12, questionId: qid, packQuestion: 4 }, f.env)).state;
  let c = L.cellState(s, f.y12, qid);
  assert.equal(c.status, 'used');
  assert.equal(c.label, '7.4');

  // red is per class: Y13 still green
  assert.equal(L.cellState(s, f.y13, qid).status, 'available');

  s = must(L.createUsage(setWeek(s, 18), { classId: f.y12, questionId: qid, packQuestion: 5 }, f.env)).state;
  c = L.cellState(s, f.y12, qid);
  assert.equal(c.label, '18.5 ×2');
  assert.equal(c.count, 2);

  // unusable wins over usage, history retained
  s = must(L.setUnusable(s, qid, true)).state;
  c = L.cellState(s, f.y12, qid);
  assert.equal(c.status, 'unusable');
  assert.equal(c.label, '');
  assert.equal(c.count, 2);
  // unusable is universal
  assert.equal(L.cellState(s, f.y13, qid).status, 'unusable');

  // restore: red for class with usage, green for the other
  s = must(L.setUnusable(s, qid, false)).state;
  assert.equal(L.cellState(s, f.y12, qid).status, 'used');
  assert.equal(L.cellState(s, f.y13, qid).status, 'available');
});

test('cell state: most recent is by academic year then week, not creation order', () => {
  const f = setup();
  const qid = q(f.s, f.p1, 1).id;
  let s = must(L.createUsage(setWeek(f.s, 20), { classId: f.y12, questionId: qid, packQuestion: 1 }, f.env)).state;
  // recorded later but for an earlier week
  s = must(L.createUsage(setWeek(s, 3), { classId: f.y12, questionId: qid, packQuestion: 2 }, f.env)).state;
  assert.equal(L.cellState(s, f.y12, qid).label, '20.1 ×2');
  s = must(L.startNextAcademicYear(s)).state;
  s = must(L.createUsage(setWeek(s, 2), { classId: f.y12, questionId: qid, packQuestion: 9 }, f.env)).state;
  assert.equal(L.cellState(s, f.y12, qid).label, '2.9 ×3');
  assert.deepEqual(L.usageHistory(s, f.y12, qid).map(L.historyLabel),
    ['2027–28 · 2.9', '2026–27 · 20.1', '2026–27 · 3.2']);
});

test('cell state: used last year stays red this year', () => {
  const f = setup();
  const qid = q(f.s, f.p1, 1).id;
  let s = must(L.createUsage(f.s, { classId: f.y12, questionId: qid, packQuestion: 1 }, f.env)).state;
  s = must(L.startNextAcademicYear(s)).state;
  assert.equal(L.cellState(s, f.y12, qid).status, 'used');
});

// ---------- classes ----------

test('class create: needs name and course; new class has all papers inactive in default order', () => {
  const f = setup();
  assert.match(L.createClass(f.s, { name: '  ', courseId: f.maths }, f.env).error, /required/);
  assert.match(L.createClass(f.s, { name: 'X', courseId: 'nope' }, f.env).error, /Course/);
  assert.match(L.createClass(f.s, { name: ' y12 maths ', courseId: f.maths }, f.env).error, /already exists/);
  const r = must(L.createClass(f.s, { name: ' Y11 Maths ', courseId: f.maths }, f.env));
  assert.equal(r.cls.name, 'Y11 Maths');
  const list = L.checklist(r.state, r.cls.id);
  assert.deepEqual(list.map((x) => [x.paper.name, x.active]), [['2024 P1', false], ['2024 P2', false]]);
  assert.equal(r.state.usages.filter((u) => u.classId === r.cls.id).length, 0);
  // FM class sees no Maths papers
  assert.deepEqual(L.checklist(r.state, f.fm12), []);
});

test('class rename keeps history, active papers and order; course unchanged', () => {
  const f = setup();
  let s = must(L.createUsage(f.s, { classId: f.y12, questionId: q(f.s, f.p1, 1).id, packQuestion: 1 }, f.env)).state;
  s = must(L.movePaper(s, f.y12, f.p2, -1)).state;
  const before = { cp: L.checklist(s, f.y12), u: s.usages };
  const r = must(L.renameClass(s, f.y12, 'Y13 Maths 2027'));
  assert.equal(L.getClass(r.state, f.y12).name, 'Y13 Maths 2027');
  assert.equal(L.getClass(r.state, f.y12).courseId, f.maths);
  assert.deepEqual(L.checklist(r.state, f.y12), before.cp);
  assert.deepEqual(r.state.usages, before.u);
  assert.match(L.renameClass(s, f.y12, 'Y13 Maths').error, /already exists/);
  must(L.renameClass(s, f.y12, 'y12 MATHS')); // own name in different case is fine
  assert.equal(L.renameClass(s, f.y12, '').ok, false);
});

test('class delete removes its usages and paper settings only', () => {
  const f = setup();
  const qid = q(f.s, f.p1, 1).id;
  let s = must(L.createUsage(f.s, { classId: f.y12, questionId: qid, packQuestion: 1 }, f.env)).state;
  s = must(L.createUsage(s, { classId: f.y13, questionId: qid, packQuestion: 1 }, f.env)).state;
  s = must(L.setUnusable(s, q(s, f.p2, 5).id, true)).state;
  s = must(L.selectClass(s, f.y12)).state;
  const r = must(L.deleteClass(s, f.y12));
  assert.equal(L.getClass(r.state, f.y12), null);
  assert.equal(r.state.usages.length, 1);
  assert.equal(r.state.usages[0].classId, f.y13);
  assert.ok(r.state.classPapers.every((x) => x.classId !== f.y12));
  assert.deepEqual(r.state.papers, s.papers);
  assert.deepEqual(r.state.questions, s.questions); // unusable flags untouched
  assert.deepEqual(r.state.courses, s.courses);
  assert.equal(r.state.settings.selectedClassId, f.y13, 'selection falls back to another class');
  assert.equal(L.deleteClass(r.state, f.y12).ok, false);
});

// ---------- papers ----------

test('paper add: Q1..Qn, appended for every course class, active only for origin class', () => {
  const f = setup();
  const r = must(L.addPaper(f.s, { courseId: f.maths, name: '2025 P1', questionCount: '3', fromClassId: f.y13 }, f.env));
  assert.deepEqual(L.questionsOfPaper(r.state, r.paper.id).map((x) => [x.number, x.unusable]), [[1, false], [2, false], [3, false]]);
  const y12 = L.checklist(r.state, f.y12), y13 = L.checklist(r.state, f.y13);
  assert.deepEqual(y12.map((x) => [x.paper.name, x.active]), [['2024 P1', true], ['2024 P2', true], ['2025 P1', false]]);
  assert.deepEqual(y13.map((x) => [x.paper.name, x.active]), [['2024 P1', true], ['2024 P2', false], ['2025 P1', true]]);
  assert.deepEqual(L.checklist(r.state, f.fm12), []);
});

test('paper add: appended after a class-specific reorder', () => {
  const f = setup();
  const s = must(L.movePaper(f.s, f.y12, f.p2, -1)).state;
  const r = must(L.addPaper(s, { courseId: f.maths, name: '2025 P1', questionCount: 3, fromClassId: f.y12 }, f.env));
  assert.deepEqual(L.checklist(r.state, f.y12).map((x) => x.paper.name), ['2024 P2', '2024 P1', '2025 P1']);
});

test('paper add: validation', () => {
  const f = setup();
  assert.match(L.addPaper(f.s, { courseId: f.maths, name: '2024 p1', questionCount: 5 }, f.env).error, /already exists/);
  assert.match(L.addPaper(f.s, { courseId: f.maths, name: '', questionCount: 5 }, f.env).error, /required/);
  assert.match(L.addPaper(f.s, { courseId: f.maths, name: 'X', questionCount: '0' }, f.env).error, /positive/);
  assert.match(L.addPaper(f.s, { courseId: f.maths, name: 'X', questionCount: 5, fromClassId: f.fm12 }, f.env).error, /different course/);
  // same name allowed on the other course
  must(L.addPaper(f.s, { courseId: f.fm, name: '2024 P1', questionCount: 5, fromClassId: f.fm12 }, f.env));
  // no origin class: inactive everywhere
  const r = must(L.addPaper(f.s, { courseId: f.maths, name: 'X', questionCount: 2 }, f.env));
  assert.ok(r.state.classPapers.filter((x) => x.paperId === r.paper.id).every((x) => !x.active));
});

test('paper rename: unique within course, history unaffected', () => {
  const f = setup();
  const qid = q(f.s, f.p1, 1).id;
  const s = must(L.createUsage(f.s, { classId: f.y12, questionId: qid, packQuestion: 1 }, f.env)).state;
  assert.match(L.renamePaper(s, f.p1, ' 2024 P2 ').error, /already exists/);
  const r = must(L.renamePaper(s, f.p1, '2024 Paper 1'));
  assert.equal(L.getPaper(r.state, f.p1).name, '2024 Paper 1');
  assert.equal(L.cellState(r.state, f.y12, qid).label, '1.1');
});

test('paper activate/deactivate is per class and deletes nothing', () => {
  const f = setup();
  const qid = q(f.s, f.p1, 1).id;
  let s = must(L.createUsage(f.s, { classId: f.y12, questionId: qid, packQuestion: 1 }, f.env)).state;
  s = must(L.setPaperActive(s, f.y12, f.p1, false)).state;
  assert.deepEqual(L.buildGrid(s, f.y12).columns.map((c) => c.paper.name), ['2024 P2']);
  assert.deepEqual(L.buildGrid(s, f.y13).columns.map((c) => c.paper.name), ['2024 P1']);
  assert.equal(s.usages.length, 1);
  s = must(L.setPaperActive(s, f.y12, f.p1, true)).state;
  assert.equal(L.buildGrid(s, f.y12).columns[0].cells[0].label, '1.1');
  assert.equal(L.setPaperActive(s, f.fm12, f.p1, true).ok, false);
});

test('paper reorder: class-specific, swaps with nearest active neighbour', () => {
  const f = setup();
  let s = must(L.addPaper(f.s, { courseId: f.maths, name: '2025 P1', questionCount: 3, fromClassId: f.y12 }, f.env)).state;
  const p3 = s.papers[2].id;
  // Y12: P1 ✓, P2 ✓, P3 ✓
  s = must(L.movePaper(s, f.y12, p3, -1)).state;
  assert.deepEqual(L.checklist(s, f.y12).map((x) => x.paper.name), ['2024 P1', '2025 P1', '2024 P2']);
  assert.deepEqual(L.checklist(s, f.y13).map((x) => x.paper.name), ['2024 P1', '2024 P2', '2025 P1'], 'other class unaffected');
  assert.equal(L.movePaper(s, f.y12, f.p1, -1).error, 'Already first.');
  assert.equal(L.movePaper(s, f.y12, f.p2, 1).error, 'Already last.');
  // skip inactive: Y12 order P1, P3, P2 with P3 inactive → moving P2 left swaps with P1
  s = must(L.setPaperActive(s, f.y12, p3, false)).state;
  s = must(L.movePaper(s, f.y12, f.p2, -1)).state;
  assert.deepEqual(L.checklist(s, f.y12).map((x) => x.paper.name), ['2024 P2', '2025 P1', '2024 P1']);
  assert.deepEqual(L.buildGrid(s, f.y12).columns.map((c) => c.paper.name), ['2024 P2', '2024 P1']);
});

test('question count: increase creates questions; reduce allowed when clean', () => {
  const f = setup();
  let s = must(L.setQuestionCount(f.s, f.p1, '12', f.env)).state;
  assert.deepEqual(L.questionsOfPaper(s, f.p1).map((x) => x.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(L.getPaper(s, f.p1).questionCount, 12);
  s = must(L.setQuestionCount(s, f.p1, 8, f.env)).state;
  assert.equal(L.questionsOfPaper(s, f.p1).length, 8);
  assert.equal(L.setQuestionCount(s, f.p1, 0, f.env).ok, false);
  assert.equal(must(L.setQuestionCount(s, f.p1, 8, f.env)).state, s, 'no-op returns same state');
});

test('question count: reduction blocked by usage in any class or unusable, listing blockers', () => {
  const f = setup();
  let s = must(L.createUsage(setWeek(f.s, 7), { classId: f.y12, questionId: q(f.s, f.p2, 19).id, packQuestion: 4 }, f.env)).state;
  s = must(L.setUnusable(s, q(s, f.p2, 20).id, true)).state;
  s = must(L.createUsage(setWeek(s, 8), { classId: f.y13, questionId: q(s, f.p2, 17).id, packQuestion: 2 }, f.env)).state;
  const r = L.setQuestionCount(s, f.p2, 15, f.env);
  assert.equal(r.ok, false);
  assert.deepEqual(r.blockers.map((b) => b.message), [
    'Y13 Maths: 2024 P2 Q17, used 8.2',
    'Y12 Maths: 2024 P2 Q19, used 7.4',
    '2024 P2 Q20, marked unusable',
  ]);
  assert.match(r.error, /Y12 Maths: 2024 P2 Q19, used 7.4/);
  // reducing above the blockers is fine
  must(L.setQuestionCount(s, f.p2, 20, f.env));
  const r2 = L.setQuestionCount(must(L.setUnusable(s, q(s, f.p2, 20).id, false)).state, f.p2, 19, f.env);
  assert.equal(r2.ok, true);
});

test('paper delete: blocked by data, otherwise removes paper, questions and class settings', () => {
  const f = setup();
  // blocked by usage
  const used = must(L.createUsage(f.s, { classId: f.y12, questionId: q(f.s, f.p1, 2).id, packQuestion: 1 }, f.env)).state;
  const e1 = L.deletePaper(used, f.p1);
  assert.equal(e1.ok, false);
  assert.match(e1.error, /untick/);
  assert.equal(e1.blockers[0].message, 'Y12 Maths: 2024 P1 Q2, used 1.1');
  // blocked by unusable
  const flagged = must(L.setUnusable(f.s, q(f.s, f.p1, 3).id, true)).state;
  assert.equal(L.deletePaper(flagged, f.p1).ok, false);
  assert.equal(L.paperDeletionBlockers(f.s, f.p1).length, 0);
  // allowed
  const r = must(L.deletePaper(f.s, f.p1));
  assert.equal(L.getPaper(r.state, f.p1), null);
  assert.ok(r.state.questions.every((x) => x.paperId !== f.p1));
  assert.deepEqual(L.checklist(r.state, f.y12).map((x) => [x.paper.name, x.position]), [['2024 P2', 0]]);
});

// ---------- academic year & week ----------

test('start next academic year: year+1, week 1, filter reset, no data change', () => {
  const f = setup();
  let s = must(L.createUsage(setWeek(f.s, 33), { classId: f.y12, questionId: q(f.s, f.p1, 1).id, packQuestion: 1 }, f.env)).state;
  s = must(L.setWeekFilter(s, 33)).state;
  s = must(L.selectClass(s, f.y12)).state;
  const r = must(L.startNextAcademicYear(s));
  assert.deepEqual(r.state.settings, {
    academicYear: '2027–28', currentWeek: 1, selectedClassId: f.y12, weekFilter: 'all', lastExportedAt: null,
  });
  for (const k of ['courses', 'papers', 'questions', 'classes', 'classPapers', 'usages']) assert.equal(r.state[k], s[k]);
});

test('increment and decrement week', () => {
  const f = setup();
  const r = must(L.incrementWeek(f.s));
  assert.equal(r.state.settings.currentWeek, 2);
  const r3 = must(L.incrementWeek(r.state));
  assert.equal(r3.state.settings.currentWeek, 3);
  const back = must(L.decrementWeek(r3.state));
  assert.equal(back.state.settings.currentWeek, 2);
  for (const k of ['usages', 'classPapers', 'questions']) assert.equal(back.state[k], r3.state[k], 'no data change');
  assert.equal(back.state.settings.weekFilter, r3.state.settings.weekFilter);
  const atOne = L.decrementWeek(f.s);
  assert.equal(atOne.ok, false);
  assert.match(atOne.error, /first week/);
});

test('set current week directly, validated', () => {
  const f = setup();
  const r = must(L.setCurrentWeek(f.s, ' 12 '));
  assert.equal(r.state.settings.currentWeek, 12);
  assert.equal(r.state.usages, f.s.usages);
  for (const bad of ['0', '-1', '2.5', '', 'x']) {
    const e = L.setCurrentWeek(f.s, bad);
    assert.equal(e.ok, false, bad);
    assert.match(e.error, /positive whole number/);
  }
});

// ---------- grid & week filter ----------

test('grid: active papers only, class order, ragged rows are null', () => {
  const f = setup();
  const g = L.buildGrid(f.s, f.y12);
  assert.equal(g.rowCount, 20);
  assert.deepEqual(g.columns.map((c) => c.paper.name), ['2024 P1', '2024 P2']);
  assert.equal(g.columns[0].cells.length, 20);
  assert.equal(g.columns[0].cells[9].question.number, 10);
  assert.equal(g.columns[0].cells[10], null);
  assert.equal(g.columns[1].cells[19].question.number, 20);
  const fm = L.buildGrid(f.s, f.fm12);
  assert.deepEqual(fm, { columns: [], rowCount: 0 });
});

test('week filter: highlights that week for current class and year, mutes others, state unchanged', () => {
  const f = setup();
  let s = setWeek(f.s, 7);
  const q3 = q(s, f.p1, 3).id, q5 = q(s, f.p2, 5).id, q6 = q(s, f.p2, 6).id;
  s = must(L.createUsage(s, { classId: f.y12, questionId: q3, packQuestion: 4 }, f.env)).state;
  s = must(L.createUsage(s, { classId: f.y13, questionId: q5, packQuestion: 1 }, f.env)).state; // other class
  s = setWeek(s, 8);
  s = must(L.createUsage(s, { classId: f.y12, questionId: q6, packQuestion: 2 }, f.env)).state; // other week
  s = must(L.setUnusable(s, q(s, f.p2, 1).id, true)).state;

  // All weeks: nothing muted or highlighted
  let g = L.buildGrid(s, f.y12);
  assert.ok(g.columns.every((c) => c.cells.every((x) => !x || (!x.muted && !x.highlight))));

  const filtered = must(L.setWeekFilter(s, '7')).state;
  assert.equal(filtered.usages, s.usages, 'filter never changes data');
  g = L.buildGrid(filtered, f.y12);
  const cell = (pi, n) => g.columns[pi].cells[n - 1];
  assert.deepEqual([cell(0, 3).highlight, cell(0, 3).muted, cell(0, 3).filterLabel, cell(0, 3).status], [true, false, '4', 'used']);
  assert.deepEqual([cell(1, 5).highlight, cell(1, 5).muted, cell(1, 5).status], [false, true, 'available']);
  assert.deepEqual([cell(1, 6).highlight, cell(1, 6).muted, cell(1, 6).status], [false, true, 'used']);
  assert.deepEqual([cell(1, 1).muted, cell(1, 1).status], [true, 'unusable']);
  assert.equal(g.columns[0].cells[15], null);

  // inactive papers stay hidden while filtering
  const hidden = must(L.setPaperActive(filtered, f.y12, f.p1, false)).state;
  assert.deepEqual(L.buildGrid(hidden, f.y12).columns.map((c) => c.paper.name), ['2024 P2']);

  // only the current academic year counts
  let next = must(L.startNextAcademicYear(s)).state;
  next = must(L.setWeekFilter(next, 7)).state;
  assert.equal(L.buildGrid(next, f.y12).columns[0].cells[2].highlight, false);
  assert.equal(L.buildGrid(next, f.y12).columns[0].cells[2].status, 'used');

  assert.equal(L.setWeekFilter(s, '0').ok, false);
  assert.equal(must(L.setWeekFilter(filtered, 'all')).state.settings.weekFilter, 'all');
});

// ---------- export / import ----------

function richState() {
  const f = setup();
  let s = setWeek(f.s, 7);
  s = must(L.createUsage(s, { classId: f.y12, questionId: q(s, f.p1, 1).id, packQuestion: 1 }, f.env)).state;
  s = must(L.createUsage(s, { classId: f.y13, questionId: q(s, f.p1, 1).id, packQuestion: 1 }, f.env)).state;
  s = must(L.setUnusable(s, q(s, f.p2, 4).id, true)).state;
  s = must(L.selectClass(s, f.y12)).state;
  s = must(L.setWeekFilter(s, 7)).state;
  return Object.assign(f, { s });
}

test('export: filename, metadata and lastExportedAt recorded', () => {
  const f = richState();
  const date = new Date(2026, 9, 7, 15, 30);
  const r = must(L.exportBackup(f.s, date));
  assert.equal(r.filename, 'past-paper-tracker-backup-2026-10-07.json');
  assert.equal(r.backup.schemaVersion, L.SCHEMA_VERSION);
  assert.equal(r.backup.appVersion, L.APP_VERSION);
  assert.equal(r.backup.exportedAt, date.toISOString());
  assert.equal(r.state.settings.lastExportedAt, date.toISOString());
  assert.equal(r.backup.data.settings.lastExportedAt, date.toISOString());
  assert.deepEqual(JSON.parse(r.json), r.backup);
});

test('export/import round trip restores identical data', () => {
  const f = richState();
  const ex = must(L.exportBackup(f.s, new Date(2026, 9, 7)));
  const v = L.validateBackup(ex.json);
  assert.equal(v.ok, true, v.error);
  assert.deepEqual(v.summary, { classes: 3, papers: 2, questions: 30, unusableQuestions: 1, usages: 2 });
  const imported = must(L.applyImport(v)).state;
  assert.deepEqual(imported, JSON.parse(JSON.stringify(ex.state)));
  // and again from the imported state
  const ex2 = must(L.exportBackup(imported, new Date(2026, 9, 7)));
  assert.deepEqual(ex2.backup.data, ex.backup.data);
});

test('import: rejects invalid backups and never returns data', () => {
  const f = richState();
  const good = must(L.exportBackup(f.s, new Date(2026, 9, 7))).backup;
  const mut = (fn) => { const b = JSON.parse(JSON.stringify(good)); fn(b); return b; };
  const cases = {
    'not JSON': '{oops',
    'not an object': '[]',
    'no schema version': mut((b) => { delete b.schemaVersion; }),
    'newer schema': mut((b) => { b.schemaVersion = L.SCHEMA_VERSION + 1; }),
    'bad exportedAt': mut((b) => { b.exportedAt = 'yesterday'; }),
    'missing collection': mut((b) => { delete b.data.usages; }),
    'three courses': mut((b) => { b.data.courses.push({ id: 'c3', name: 'Stats' }); }),
    'duplicate id': mut((b) => { b.data.questions[1].id = b.data.questions[0].id; }),
    'paper → missing course': mut((b) => { b.data.papers[0].courseId = 'zzz'; }),
    'duplicate paper name': mut((b) => { b.data.papers[1].name = b.data.papers[0].name.toUpperCase(); }),
    'question gap': mut((b) => { b.data.questions = b.data.questions.filter((x, i) => i !== 3); }),
    'question count mismatch': mut((b) => { b.data.papers[0].questionCount = 11; }),
    'question → missing paper': mut((b) => { b.data.questions[0].paperId = 'zzz'; }),
    'unusable not boolean': mut((b) => { b.data.questions[0].unusable = 'yes'; }),
    'duplicate class name': mut((b) => { b.data.classes[1].name = b.data.classes[0].name; }),
    'classPaper → missing paper': mut((b) => { b.data.classPapers[0].paperId = 'zzz'; }),
    'classPaper → missing class': mut((b) => { b.data.classPapers[0].classId = 'zzz'; }),
    'classPaper missing row': mut((b) => { b.data.classPapers.shift(); }),
    'classPaper bad positions': mut((b) => { b.data.classPapers[0].position = 5; }),
    'usage → missing question': mut((b) => { b.data.usages[0].questionId = 'zzz'; }),
    'usage → missing class': mut((b) => { b.data.usages[0].classId = 'zzz'; }),
    'usage bad year': mut((b) => { b.data.usages[0].academicYear = '2026-27'; }),
    'usage bad week': mut((b) => { b.data.usages[0].week = 0; }),
    'usage bad pack question': mut((b) => { b.data.usages[0].packQuestion = 1.5; }),
    'usage bad timestamps': mut((b) => { b.data.usages[0].createdAt = 'x'; }),
    'usage duplicate question in week': mut((b) => {
      b.data.usages.push(Object.assign({}, b.data.usages[0], { id: 'dup', packQuestion: 9 }));
    }),
    'usage duplicate pack number in week': mut((b) => {
      const other = b.data.questions.find((x) => x.paperId === b.data.papers[0].id && x.number === 2);
      b.data.usages.push(Object.assign({}, b.data.usages[0], { id: 'dup', questionId: other.id }));
    }),
    'settings bad year': mut((b) => { b.data.settings.academicYear = '2026'; }),
    'settings bad week': mut((b) => { b.data.settings.currentWeek = -1; }),
    'settings missing class': mut((b) => { b.data.settings.selectedClassId = 'zzz'; }),
    'settings bad filter': mut((b) => { b.data.settings.weekFilter = 'some'; }),
  };
  for (const [name, input] of Object.entries(cases)) {
    const v = L.validateBackup(input);
    assert.equal(v.ok, false, `should reject: ${name}`);
    assert.equal(v.data, undefined, name);
    assert.ok(v.errors.length > 0, name);
    assert.equal(L.applyImport(v).ok, false, name);
  }
  assert.match(L.validateBackup(cases['newer schema']).error, /newer version/);
});

test('import: unusable question with history is valid (history is never deleted)', () => {
  const f = richState();
  const s = must(L.setUnusable(f.s, f.s.usages[0].questionId, true)).state;
  const v = L.validateBackup(must(L.exportBackup(s, new Date())).json);
  assert.equal(v.ok, true, v.error);
});

test('last exported text', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  assert.equal(L.lastExportedText(null, now), 'never');
  assert.equal(L.lastExportedText('2026-10-07T01:00:00Z', now), 'today');
  assert.equal(L.lastExportedText('2026-10-06T11:00:00Z', now), '1 day ago');
  assert.equal(L.lastExportedText('2026-09-27T12:00:00Z', now), '10 days ago');
});

test('operations never mutate their input (frozen state)', () => {
  // `must` deep-freezes every result; in strict mode any mutation would throw.
  // This test exercises a mixed sequence on frozen states end to end.
  const f = richState();
  let s = f.s;
  s = must(L.renameClass(s, f.y12, 'Renamed')).state;
  s = must(L.movePaper(s, f.y12, f.p2, -1)).state;
  s = must(L.setQuestionCount(s, f.p2, 25, f.env)).state;
  s = must(L.incrementWeek(s)).state;
  s = must(L.editUsage(s, s.usages[0].id, { academicYear: '2026-27', week: 3, packQuestion: 3 }, f.env)).state;
  s = must(L.deleteClass(s, f.y13)).state;
  s = must(L.applyImport(L.validateBackup(must(L.exportBackup(s, new Date())).json))).state;
  assert.equal(L.getClass(s, f.y12).name, 'Renamed');
});
