/*
 * Past-Paper Tracker — sample and stress data, built through the normal logic
 * operations so the result is always valid. Loads as a CommonJS module (tests)
 * or as the global `PPTSample`.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PPTSample = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function run(res) {
    if (!res.ok) throw new Error(res.error);
    return res;
  }

  function courseId(s, name) {
    return s.courses.find((c) => c.name === name).id;
  }

  function questionId(L, s, paperId, number) {
    return L.questionsOfPaper(s, paperId).find((q) => q.number === number).id;
  }

  /**
   * Both courses; papers of differing lengths; usages over several weeks (one question
   * used twice); one unusable question; one inactive paper that has usage.
   */
  function buildSampleData(L, env, date) {
    let s = L.createInitialState(env, date);
    const maths = courseId(s, 'Maths');
    const fm = courseId(s, 'Further Maths');

    const addClass = (name, course) => {
      const r = run(L.createClass(s, { name, courseId: course }, env));
      s = r.state;
      return r.cls.id;
    };
    const y12 = addClass('Y12 Maths', maths);
    const y13 = addClass('Y13 Maths', maths);
    const fm12 = addClass('Y12 Further Maths', fm);

    const addPaper = (course, name, count, fromClassId) => {
      const r = run(L.addPaper(s, { courseId: course, name, questionCount: count, fromClassId }, env));
      s = r.state;
      return r.paper.id;
    };
    const m22p1 = addPaper(maths, '2022 P1', 14, y12);
    const m22p2 = addPaper(maths, '2022 P2', 16, y12);
    const m23p1 = addPaper(maths, '2023 P1', 15, y12);
    const m23p2 = addPaper(maths, '2023 P2', 18, y12);
    const m24p1 = addPaper(maths, '2024 P1', 12, y12);
    const f23c1 = addPaper(fm, '2023 CP1', 10, fm12);
    const f23c2 = addPaper(fm, '2023 CP2', 9, fm12);
    addPaper(fm, '2024 CP1', 11, fm12);

    s = run(L.setPaperActive(s, y13, m22p1, true)).state;
    s = run(L.setPaperActive(s, y13, m23p2, true)).state;

    // [class, paper, question number, week, pack question]
    const uses = [
      [y12, m22p1, 2, 1, 1], [y12, m22p1, 5, 1, 2], [y12, m23p1, 4, 1, 3], [y12, m22p2, 1, 1, 4],
      [y12, m22p1, 3, 2, 1], [y12, m24p1, 6, 2, 2], [y12, m23p2, 1, 2, 3],
      [y12, m22p2, 3, 3, 1], [y12, m23p1, 7, 3, 2], [y12, m22p1, 8, 3, 3], [y12, m23p2, 5, 3, 4],
      [y12, m22p1, 9, 4, 1], [y12, m22p2, 6, 4, 2], [y12, m23p1, 9, 4, 3],
      [y12, m23p2, 10, 5, 1], [y12, m22p2, 12, 5, 2], [y12, m22p1, 12, 5, 3],
      [y12, m23p1, 4, 6, 2], [y12, m23p2, 14, 6, 1], [y12, m22p1, 14, 6, 3],
      [y13, m22p1, 2, 2, 1], [y13, m23p2, 3, 2, 2], [y13, m23p2, 8, 4, 1], [y13, m22p1, 6, 5, 1],
      [fm12, f23c1, 1, 1, 1], [fm12, f23c1, 4, 2, 1], [fm12, f23c2, 2, 2, 2], [fm12, f23c1, 7, 5, 1],
    ];
    for (const [classId, paperId, number, week, pack] of uses) {
      s = run(L.setCurrentWeek(s, week)).state;
      s = run(L.createUsage(s, { classId, questionId: questionId(L, s, paperId, number), packQuestion: pack }, env)).state;
    }

    // 2024 P1 has usage (Week 2) but is unticked for Y12.
    s = run(L.setPaperActive(s, y12, m24p1, false)).state;
    s = run(L.setUnusable(s, questionId(L, s, m22p2, 11), true)).state;
    s = run(L.setCurrentWeek(s, 7)).state;
    s = run(L.selectClass(s, y12)).state;
    return s;
  }

  /** One class with `paperCount` active papers × `questionCount` questions and scattered usage. */
  function buildStressData(L, env, date, paperCount = 50, questionCount = 20) {
    let s = L.createInitialState(env, date);
    const maths = courseId(s, 'Maths');
    const cls = run(L.createClass(s, { name: 'Stress Maths', courseId: maths }, env));
    s = cls.state;
    const classId = cls.cls.id;
    const paperIds = [];
    for (let i = 1; i <= paperCount; i++) {
      const r = run(L.addPaper(s, { courseId: maths, name: `Stress P${String(i).padStart(2, '0')}`, questionCount, fromClassId: classId }, env));
      s = r.state;
      paperIds.push(r.paper.id);
    }
    let seed = 12345;
    const rand = (n) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let week = 1; week <= 30; week++) {
      s = run(L.setCurrentWeek(s, week)).state;
      for (let pack = 1; pack <= 10; pack++) {
        const qid = questionId(L, s, paperIds[rand(paperCount)], 1 + rand(questionCount));
        const r = L.createUsage(s, { classId, questionId: qid, packQuestion: pack }, env);
        if (r.ok) s = r.state;
      }
    }
    for (let i = 0; i < 20; i++) {
      s = run(L.setUnusable(s, questionId(L, s, paperIds[rand(paperCount)], 1 + rand(questionCount)), true)).state;
    }
    s = run(L.setCurrentWeek(s, 31)).state;
    s = run(L.selectClass(s, classId)).state;
    return s;
  }

  return { buildSampleData, buildStressData };
});
