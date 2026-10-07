/*
 * Past-Paper Tracker — pure data logic.
 *
 * Every operation takes the current state (never mutated) and returns either
 *   { ok: true, state, ...extra }   or   { ok: false, error, ...extra }.
 * IDs and timestamps come from an injected env: { id(): string, now(): ISO string }.
 * Derived state (cell colours, labels, grid) is computed here and never stored.
 *
 * Loads as a CommonJS module (tests) or as the global `PPT` (inlined in the app).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PPT = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const APP_VERSION = '1.0.0';
  const COURSE_NAMES = ['Maths', 'Further Maths'];
  const EN_DASH = '–';
  const COLLECTIONS = ['courses', 'papers', 'questions', 'classes', 'classPapers', 'usages'];

  // ---------- small helpers ----------

  const ok = (state, extra) => Object.assign({ ok: true, state }, extra);
  const fail = (error, extra) => Object.assign({ ok: false, error }, extra);
  const clone = (x) => JSON.parse(JSON.stringify(x));

  const isPosInt = (n) => Number.isInteger(n) && n > 0;
  const isNonEmptyString = (s) => typeof s === 'string' && s.trim() !== '';
  const isIsoDate = (s) => typeof s === 'string' && s !== '' && !Number.isNaN(Date.parse(s));
  const nameKey = (s) => String(s).trim().toLowerCase();

  /** Strict positive integer from a number or a string of digits ("07" → 7). Otherwise null. */
  function parsePositiveInt(input) {
    if (typeof input === 'number') return isPosInt(input) ? input : null;
    if (typeof input !== 'string') return null;
    const s = input.trim();
    if (!/^[0-9]+$/.test(s)) return null;
    const n = Number(s);
    return isPosInt(n) ? n : null;
  }

  // ---------- academic year ----------

  const YEAR_RE = /^(\d{4})–(\d{2})$/;

  /** Canonical form is "2026–27" (en dash) and the second part must follow the first. */
  function isValidAcademicYear(ay) {
    if (typeof ay !== 'string') return false;
    const m = YEAR_RE.exec(ay);
    return !!m && (Number(m[1]) + 1) % 100 === Number(m[2]);
  }

  /** User input: accepts a hyphen or en/em dash; returns the canonical form or null. */
  function parseAcademicYear(input) {
    if (typeof input !== 'string') return null;
    const s = input.trim().replace(/[-‐-―−]/, EN_DASH);
    return isValidAcademicYear(s) ? s : null;
  }

  function formatAcademicYear(startYear) {
    return `${startYear}${EN_DASH}${String((startYear + 1) % 100).padStart(2, '0')}`;
  }

  const academicYearStart = (ay) => Number(ay.slice(0, 4));
  const nextAcademicYear = (ay) => formatAcademicYear(academicYearStart(ay) + 1);

  /** September to August: Oct 2026 → "2026–27", Mar 2027 → "2026–27". */
  function inferAcademicYear(date) {
    const y = date.getFullYear();
    return formatAcademicYear(date.getMonth() >= 8 ? y : y - 1);
  }

  // ---------- initial state & lookups ----------

  function createInitialState(env, date) {
    return {
      courses: COURSE_NAMES.map((name) => ({ id: env.id(), name })),
      papers: [],
      questions: [],
      classes: [],
      classPapers: [],
      usages: [],
      settings: {
        academicYear: inferAcademicYear(date),
        currentWeek: 1,
        selectedClassId: null,
        weekFilter: 'all',
        lastExportedAt: null,
      },
    };
  }

  const getCourse = (s, id) => s.courses.find((c) => c.id === id) || null;
  const getClass = (s, id) => s.classes.find((c) => c.id === id) || null;
  const getPaper = (s, id) => s.papers.find((p) => p.id === id) || null;
  const getQuestion = (s, id) => s.questions.find((q) => q.id === id) || null;
  const getUsage = (s, id) => s.usages.find((u) => u.id === id) || null;
  const questionsOfPaper = (s, paperId) =>
    s.questions.filter((q) => q.paperId === paperId).sort((a, b) => a.number - b.number);

  function questionTitle(s, q) {
    const p = getPaper(s, q.paperId);
    return `${p ? p.name : '?'} Q${q.number}`;
  }

  // ---------- usage ordering & labels ----------

  /** Most recent first: academic year, then week, then creation time. */
  function compareUsageRecency(a, b) {
    return (
      academicYearStart(b.academicYear) - academicYearStart(a.academicYear) ||
      b.week - a.week ||
      String(b.createdAt).localeCompare(String(a.createdAt))
    );
  }

  const usageLabel = (u) => `${u.week}.${u.packQuestion}`;
  const historyLabel = (u) => `${u.academicYear} · ${usageLabel(u)}`;

  function usageHistory(s, classId, questionId) {
    return s.usages
      .filter((u) => u.classId === classId && u.questionId === questionId)
      .sort(compareUsageRecency);
  }

  // ---------- cell state ----------

  /**
   * status: 'unusable' (dark grey) > 'used' (red) > 'available' (green).
   * label: most recent use ("7.4"), with "×n" when used more than once; only for 'used'.
   */
  function cellState(s, classId, questionId) {
    const q = getQuestion(s, questionId);
    if (!q) return null;
    const history = usageHistory(s, classId, questionId);
    const status = q.unusable ? 'unusable' : history.length ? 'used' : 'available';
    let label = '';
    if (status === 'used') {
      label = usageLabel(history[0]) + (history.length > 1 ? ` ×${history.length}` : '');
    }
    return { status, label, count: history.length, latest: history[0] || null };
  }

  // ---------- usage constraints ----------

  /**
   * Checks one candidate usage against the state (ignoring the record `excludeId`).
   * Returns an error string or null.
   */
  function checkUsage(s, cand, excludeId) {
    const cls = getClass(s, cand.classId);
    if (!cls) return 'Class not found.';
    const q = getQuestion(s, cand.questionId);
    if (!q) return 'Question not found.';
    const paper = getPaper(s, q.paperId);
    if (!paper || paper.courseId !== cls.courseId) return 'Question does not belong to this class’s course.';
    if (!isValidAcademicYear(cand.academicYear)) return 'Academic year must look like 2026–27.';
    if (!isPosInt(cand.week)) return 'Week must be a positive whole number.';
    if (!isPosInt(cand.packQuestion)) return 'Pack question must be a positive whole number.';
    for (const u of s.usages) {
      if (u.id === excludeId) continue;
      if (u.classId !== cand.classId || u.academicYear !== cand.academicYear || u.week !== cand.week) continue;
      if (u.questionId === cand.questionId) {
        return `${questionTitle(s, q)} is already used in Week ${u.week} (${u.academicYear}) as ${usageLabel(u)}.`;
      }
      if (u.packQuestion === cand.packQuestion) {
        const other = getQuestion(s, u.questionId);
        return `Pack question ${usageLabel(u)} is already assigned to ${other ? questionTitle(s, other) : 'another question'}.`;
      }
    }
    return null;
  }

  /** Records a use for the current academic year and week. packQuestion may be raw input. */
  function createUsage(s, { classId, questionId, packQuestion }, env) {
    const q = getQuestion(s, questionId);
    if (q && q.unusable) return fail('This question is marked unusable. Restore it first.');
    const pq = parsePositiveInt(packQuestion);
    if (pq === null) return fail('Pack question must be a positive whole number.');
    const cand = {
      classId,
      questionId,
      academicYear: s.settings.academicYear,
      week: s.settings.currentWeek,
      packQuestion: pq,
    };
    const err = checkUsage(s, cand);
    if (err) return fail(err);
    const now = env.now();
    const usage = Object.assign({ id: env.id() }, cand, { createdAt: now, updatedAt: now });
    return ok(Object.assign({}, s, { usages: s.usages.concat([usage]) }), { usage });
  }

  /** Edits academic year, week and pack question (each may be raw input). */
  function editUsage(s, usageId, { academicYear, week, packQuestion }, env) {
    const u = getUsage(s, usageId);
    if (!u) return fail('Usage not found.');
    const ay = parseAcademicYear(academicYear);
    if (!ay) return fail('Academic year must look like 2026–27.');
    const wk = parsePositiveInt(week);
    if (wk === null) return fail('Week must be a positive whole number.');
    const pq = parsePositiveInt(packQuestion);
    if (pq === null) return fail('Pack question must be a positive whole number.');
    const updated = Object.assign({}, u, { academicYear: ay, week: wk, packQuestion: pq });
    const err = checkUsage(s, updated, usageId);
    if (err) return fail(err);
    updated.updatedAt = env.now();
    return ok(Object.assign({}, s, { usages: s.usages.map((x) => (x.id === usageId ? updated : x)) }), { usage: updated });
  }

  function deleteUsage(s, usageId) {
    if (!getUsage(s, usageId)) return fail('Usage not found.');
    return ok(Object.assign({}, s, { usages: s.usages.filter((u) => u.id !== usageId) }));
  }

  // ---------- unusable ----------

  function setUnusable(s, questionId, unusable) {
    if (!getQuestion(s, questionId)) return fail('Question not found.');
    return ok(Object.assign({}, s, {
      questions: s.questions.map((q) => (q.id === questionId ? Object.assign({}, q, { unusable: !!unusable }) : q)),
    }));
  }

  // ---------- classes ----------

  function classNameError(s, name, exceptId) {
    if (!isNonEmptyString(name)) return 'Class name is required.';
    if (s.classes.some((c) => c.id !== exceptId && nameKey(c.name) === nameKey(name))) {
      return `A class called “${name.trim()}” already exists.`;
    }
    return null;
  }

  /** New class: no history, every course paper inactive, in the course's default (creation) order. */
  function createClass(s, { name, courseId }, env) {
    const err = classNameError(s, name);
    if (err) return fail(err);
    if (!getCourse(s, courseId)) return fail('Course not found.');
    const cls = { id: env.id(), name: name.trim(), courseId };
    const rows = s.papers
      .filter((p) => p.courseId === courseId)
      .map((p, i) => ({ classId: cls.id, paperId: p.id, active: false, position: i }));
    return ok(Object.assign({}, s, {
      classes: s.classes.concat([cls]),
      classPapers: s.classPapers.concat(rows),
    }), { cls });
  }

  function renameClass(s, classId, name) {
    if (!getClass(s, classId)) return fail('Class not found.');
    const err = classNameError(s, name, classId);
    if (err) return fail(err);
    return ok(Object.assign({}, s, {
      classes: s.classes.map((c) => (c.id === classId ? Object.assign({}, c, { name: name.trim() }) : c)),
    }));
  }

  /** Removes the class, its usages and its paper settings. Shared papers/questions untouched. */
  function deleteClass(s, classId) {
    if (!getClass(s, classId)) return fail('Class not found.');
    const classes = s.classes.filter((c) => c.id !== classId);
    const settings = Object.assign({}, s.settings);
    if (settings.selectedClassId === classId) settings.selectedClassId = classes.length ? classes[0].id : null;
    return ok(Object.assign({}, s, {
      classes,
      classPapers: s.classPapers.filter((r) => r.classId !== classId),
      usages: s.usages.filter((u) => u.classId !== classId),
      settings,
    }));
  }

  function selectClass(s, classId) {
    if (classId !== null && !getClass(s, classId)) return fail('Class not found.');
    return ok(Object.assign({}, s, { settings: Object.assign({}, s.settings, { selectedClassId: classId }) }));
  }

  // ---------- papers ----------

  function paperNameError(s, courseId, name, exceptId) {
    if (!isNonEmptyString(name)) return 'Paper name is required.';
    if (s.papers.some((p) => p.id !== exceptId && p.courseId === courseId && nameKey(p.name) === nameKey(name))) {
      return `A paper called “${name.trim()}” already exists for this course.`;
    }
    return null;
  }

  const makeQuestions = (env, paperId, from, to) => {
    const out = [];
    for (let n = from; n <= to; n++) out.push({ id: env.id(), paperId, number: n, unusable: false });
    return out;
  };

  /**
   * Adds a paper with Q1..Qn, appended to every course class's order;
   * active only for `fromClassId` (if given).
   */
  function addPaper(s, { courseId, name, questionCount, fromClassId }, env) {
    if (!getCourse(s, courseId)) return fail('Course not found.');
    const err = paperNameError(s, courseId, name);
    if (err) return fail(err);
    const count = parsePositiveInt(questionCount);
    if (count === null) return fail('Question count must be a positive whole number.');
    if (fromClassId != null) {
      const from = getClass(s, fromClassId);
      if (!from) return fail('Class not found.');
      if (from.courseId !== courseId) return fail('That class is on a different course.');
    }
    const paper = { id: env.id(), courseId, name: name.trim(), questionCount: count };
    const rows = s.classes
      .filter((c) => c.courseId === courseId)
      .map((c) => ({
        classId: c.id,
        paperId: paper.id,
        active: c.id === fromClassId,
        position: s.classPapers.filter((r) => r.classId === c.id).length,
      }));
    return ok(Object.assign({}, s, {
      papers: s.papers.concat([paper]),
      questions: s.questions.concat(makeQuestions(env, paper.id, 1, count)),
      classPapers: s.classPapers.concat(rows),
    }), { paper });
  }

  function renamePaper(s, paperId, name) {
    const paper = getPaper(s, paperId);
    if (!paper) return fail('Paper not found.');
    const err = paperNameError(s, paper.courseId, name, paperId);
    if (err) return fail(err);
    return ok(Object.assign({}, s, {
      papers: s.papers.map((p) => (p.id === paperId ? Object.assign({}, p, { name: name.trim() }) : p)),
    }));
  }

  /**
   * Reasons the given questions cannot be removed: usage in any class, or unusable.
   * Each blocker has a `message`, e.g. "Y12 Maths: 2024 P2 Q19, used 7.4".
   */
  function questionBlockers(s, questions) {
    const out = [];
    for (const q of questions) {
      const title = questionTitle(s, q);
      for (const cls of s.classes) {
        const hist = usageHistory(s, cls.id, q.id);
        if (hist.length) {
          out.push({
            kind: 'usage', questionId: q.id, classId: cls.id,
            message: `${cls.name}: ${title}, used ${hist.map(usageLabel).join(', ')}`,
          });
        }
      }
      if (q.unusable) out.push({ kind: 'unusable', questionId: q.id, message: `${title}, marked unusable` });
    }
    return out;
  }

  function setQuestionCount(s, paperId, questionCount, env) {
    const paper = getPaper(s, paperId);
    if (!paper) return fail('Paper not found.');
    const count = parsePositiveInt(questionCount);
    if (count === null) return fail('Question count must be a positive whole number.');
    if (count === paper.questionCount) return ok(s);
    let questions;
    if (count > paper.questionCount) {
      questions = s.questions.concat(makeQuestions(env, paperId, paper.questionCount + 1, count));
    } else {
      const removed = questionsOfPaper(s, paperId).filter((q) => q.number > count);
      const blockers = questionBlockers(s, removed);
      if (blockers.length) {
        return fail(`Cannot reduce ${paper.name} to ${count} questions:\n` + blockers.map((b) => b.message).join('\n'), { blockers });
      }
      const ids = new Set(removed.map((q) => q.id));
      questions = s.questions.filter((q) => !ids.has(q.id));
    }
    return ok(Object.assign({}, s, {
      papers: s.papers.map((p) => (p.id === paperId ? Object.assign({}, p, { questionCount: count }) : p)),
      questions,
    }));
  }

  /** Renumbers each class's positions to 0..n-1, keeping relative order. */
  function compactPositions(rows) {
    const byClass = new Map();
    for (const r of rows) {
      if (!byClass.has(r.classId)) byClass.set(r.classId, []);
      byClass.get(r.classId).push(r);
    }
    const pos = new Map();
    for (const list of byClass.values()) {
      list.slice().sort((a, b) => a.position - b.position).forEach((r, i) => pos.set(r, i));
    }
    return rows.map((r) => (pos.get(r) === r.position ? r : Object.assign({}, r, { position: pos.get(r) })));
  }

  /** Deletion check without deleting (so the UI can block before asking to confirm). */
  function paperDeletionBlockers(s, paperId) {
    return questionBlockers(s, questionsOfPaper(s, paperId));
  }

  function deletePaper(s, paperId) {
    const paper = getPaper(s, paperId);
    if (!paper) return fail('Paper not found.');
    const blockers = paperDeletionBlockers(s, paperId);
    if (blockers.length) {
      return fail(`Cannot delete ${paper.name} because it has recorded data (untick it instead):\n` +
        blockers.map((b) => b.message).join('\n'), { blockers });
    }
    return ok(Object.assign({}, s, {
      papers: s.papers.filter((p) => p.id !== paperId),
      questions: s.questions.filter((q) => q.paperId !== paperId),
      classPapers: compactPositions(s.classPapers.filter((r) => r.paperId !== paperId)),
    }));
  }

  function classPaperRows(s, classId) {
    return s.classPapers.filter((r) => r.classId === classId).sort((a, b) => a.position - b.position);
  }

  function setPaperActive(s, classId, paperId, active) {
    if (!s.classPapers.some((r) => r.classId === classId && r.paperId === paperId)) {
      return fail('Paper not available for this class.');
    }
    return ok(Object.assign({}, s, {
      classPapers: s.classPapers.map((r) =>
        r.classId === classId && r.paperId === paperId ? Object.assign({}, r, { active: !!active }) : r),
    }));
  }

  /**
   * Moves a paper one step left (-1) or right (+1) for one class. It swaps places with the
   * nearest *active* paper in that direction, so the move is always visible in the grid.
   */
  function movePaper(s, classId, paperId, direction) {
    const rows = classPaperRows(s, classId);
    const i = rows.findIndex((r) => r.paperId === paperId);
    if (i < 0) return fail('Paper not available for this class.');
    let j = i + direction;
    while (j >= 0 && j < rows.length && !rows[j].active) j += direction;
    if (j < 0 || j >= rows.length) return fail(direction < 0 ? 'Already first.' : 'Already last.');
    const a = rows[i], b = rows[j];
    return ok(Object.assign({}, s, {
      classPapers: s.classPapers.map((r) => {
        if (r === a) return Object.assign({}, r, { position: b.position });
        if (r === b) return Object.assign({}, r, { position: a.position });
        return r;
      }),
    }));
  }

  /** Active-paper checklist in the class's order. */
  function checklist(s, classId) {
    return classPaperRows(s, classId).map((r) => ({ paper: getPaper(s, r.paperId), active: r.active, position: r.position }));
  }

  // ---------- academic year / week / filter ----------

  /** New academic year: week → 1, filter → All weeks. No class or usage data changes. */
  function startNextAcademicYear(s) {
    return ok(Object.assign({}, s, {
      settings: Object.assign({}, s.settings, {
        academicYear: nextAcademicYear(s.settings.academicYear),
        currentWeek: 1,
        weekFilter: 'all',
      }),
    }));
  }

  function incrementWeek(s) {
    return ok(Object.assign({}, s, { settings: Object.assign({}, s.settings, { currentWeek: s.settings.currentWeek + 1 }) }));
  }

  /** 'all' or a week number (raw input allowed). View-only setting. */
  function setWeekFilter(s, value) {
    let wf = 'all';
    if (value !== 'all') {
      wf = parsePositiveInt(value);
      if (wf === null) return fail('Week must be a positive whole number.');
    }
    return ok(Object.assign({}, s, { settings: Object.assign({}, s.settings, { weekFilter: wf }) }));
  }

  // ---------- grid ----------

  /**
   * Grid for a class: one column per active paper (class order), `rowCount` rows.
   * columns[c].cells[r] is null beyond the paper's length (blank, not clickable). Otherwise
   * it has the cell state plus week-filter flags: `highlight` + `filterLabel` (pack question)
   * when used in the filtered week of the current academic year, `muted` otherwise.
   */
  function buildGrid(s, classId) {
    const wf = s.settings.weekFilter;
    const ay = s.settings.academicYear;
    const inWeek = new Map();
    if (wf !== 'all') {
      for (const u of s.usages) {
        if (u.classId === classId && u.academicYear === ay && u.week === wf) inWeek.set(u.questionId, u);
      }
    }
    const columns = classPaperRows(s, classId)
      .filter((r) => r.active)
      .map((r) => {
        const paper = getPaper(s, r.paperId);
        const cells = questionsOfPaper(s, paper.id).map((q) => {
          const cell = Object.assign({ question: q }, cellState(s, classId, q.id));
          const hit = inWeek.get(q.id);
          cell.highlight = !!hit;
          cell.muted = wf !== 'all' && !hit;
          cell.filterLabel = hit ? String(hit.packQuestion) : '';
          return cell;
        });
        return { paper, cells };
      });
    const rowCount = columns.reduce((m, c) => Math.max(m, c.paper.questionCount), 0);
    for (const col of columns) while (col.cells.length < rowCount) col.cells.push(null);
    return { columns, rowCount };
  }

  // ---------- data validation (used by import; also a state invariant check) ----------

  function validateData(d) {
    const errors = [];
    const err = (m) => errors.push(m);
    if (!d || typeof d !== 'object') return ['Missing data.'];
    for (const k of COLLECTIONS) if (!Array.isArray(d[k])) err(`"${k}" must be a list.`);
    if (!d.settings || typeof d.settings !== 'object') err('"settings" is missing.');
    if (errors.length) return errors;

    const indexById = (list, label) => {
      const m = new Map();
      list.forEach((x, i) => {
        if (!x || typeof x !== 'object' || !isNonEmptyString(x.id)) err(`${label} #${i + 1} has no valid id.`);
        else if (m.has(x.id)) err(`Duplicate ${label} id ${x.id}.`);
        else m.set(x.id, x);
      });
      return m;
    };

    const courses = indexById(d.courses, 'course');
    const names = d.courses.map((c) => c && c.name).sort();
    if (d.courses.length !== 2 || JSON.stringify(names) !== JSON.stringify(COURSE_NAMES.slice().sort())) {
      err('There must be exactly two courses: Maths and Further Maths.');
    }

    const papers = indexById(d.papers, 'paper');
    const paperNames = new Set();
    for (const p of papers.values()) {
      if (!courses.has(p.courseId)) err(`Paper ${p.id} refers to a missing course.`);
      if (!isNonEmptyString(p.name)) err(`Paper ${p.id} has no name.`);
      else {
        const key = p.courseId + '\u0000' + nameKey(p.name);
        if (paperNames.has(key)) err(`Duplicate paper name "${p.name}" in a course.`);
        paperNames.add(key);
      }
      if (!isPosInt(p.questionCount)) err(`Paper "${p.name}" has an invalid question count.`);
    }

    const questions = indexById(d.questions, 'question');
    const numbersByPaper = new Map();
    for (const q of questions.values()) {
      if (!papers.has(q.paperId)) { err(`Question ${q.id} refers to a missing paper.`); continue; }
      if (!isPosInt(q.number)) err(`Question ${q.id} has an invalid number.`);
      if (typeof q.unusable !== 'boolean') err(`Question ${q.id} has an invalid unusable flag.`);
      if (!numbersByPaper.has(q.paperId)) numbersByPaper.set(q.paperId, []);
      numbersByPaper.get(q.paperId).push(q.number);
    }
    for (const p of papers.values()) {
      const nums = (numbersByPaper.get(p.id) || []).slice().sort((a, b) => a - b);
      const contiguous = nums.length === p.questionCount && nums.every((n, i) => n === i + 1);
      if (!contiguous) err(`Paper "${p.name}" must have questions numbered 1 to ${p.questionCount}.`);
    }

    const classes = indexById(d.classes, 'class');
    const classNames = new Set();
    for (const c of classes.values()) {
      if (!courses.has(c.courseId)) err(`Class ${c.id} refers to a missing course.`);
      if (!isNonEmptyString(c.name)) err(`Class ${c.id} has no name.`);
      else {
        if (classNames.has(nameKey(c.name))) err(`Duplicate class name "${c.name}".`);
        classNames.add(nameKey(c.name));
      }
    }

    const cpSeen = new Map();
    d.classPapers.forEach((r, i) => {
      if (!r || typeof r !== 'object') { err(`Class-paper entry #${i + 1} is invalid.`); return; }
      const c = classes.get(r.classId), p = papers.get(r.paperId);
      if (!c) { err(`Class-paper entry #${i + 1} refers to a missing class.`); return; }
      if (!p) { err(`Class-paper entry #${i + 1} refers to a missing paper.`); return; }
      if (p.courseId !== c.courseId) err(`Class "${c.name}" lists paper "${p.name}" from another course.`);
      if (typeof r.active !== 'boolean') err(`Class-paper entry #${i + 1} has an invalid active flag.`);
      if (!Number.isInteger(r.position) || r.position < 0) err(`Class-paper entry #${i + 1} has an invalid position.`);
      if (!cpSeen.has(c.id)) cpSeen.set(c.id, new Map());
      if (cpSeen.get(c.id).has(p.id)) err(`Class "${c.name}" lists paper "${p.name}" twice.`);
      cpSeen.get(c.id).set(p.id, r);
    });
    for (const c of classes.values()) {
      const rows = cpSeen.get(c.id) || new Map();
      const coursePapers = [...papers.values()].filter((p) => p.courseId === c.courseId);
      for (const p of coursePapers) if (!rows.has(p.id)) err(`Class "${c.name}" has no setting for paper "${p.name}".`);
      const positions = [...rows.values()].map((r) => r.position).sort((a, b) => a - b);
      if (!positions.every((n, i) => n === i)) err(`Class "${c.name}" has an invalid paper order.`);
    }

    indexById(d.usages, 'usage');
    const slotQ = new Set(), slotPQ = new Set();
    d.usages.forEach((u, i) => {
      if (!u || typeof u !== 'object') return;
      const label = `Usage #${i + 1}`;
      const c = classes.get(u.classId), q = questions.get(u.questionId);
      if (!c) { err(`${label} refers to a missing class.`); return; }
      if (!q) { err(`${label} refers to a missing question.`); return; }
      const p = papers.get(q.paperId);
      if (p && p.courseId !== c.courseId) err(`${label} links a question to a class on another course.`);
      if (!isValidAcademicYear(u.academicYear)) err(`${label} has an invalid academic year.`);
      if (!isPosInt(u.week)) err(`${label} has an invalid week.`);
      if (!isPosInt(u.packQuestion)) err(`${label} has an invalid pack question.`);
      if (!isIsoDate(u.createdAt) || !isIsoDate(u.updatedAt)) err(`${label} has invalid timestamps.`);
      const slot = `${u.classId}\u0000${u.academicYear}\u0000${u.week}`;
      const kq = slot + '\u0000' + u.questionId, kp = slot + '\u0000' + u.packQuestion;
      if (slotQ.has(kq)) err(`${label}: question used twice in ${c.name} week ${u.week} (${u.academicYear}).`);
      if (slotPQ.has(kp)) err(`${label}: pack question ${u.week}.${u.packQuestion} assigned twice in ${c.name}.`);
      slotQ.add(kq); slotPQ.add(kp);
    });

    const st = d.settings;
    if (!isValidAcademicYear(st.academicYear)) err('Settings: invalid academic year.');
    if (!isPosInt(st.currentWeek)) err('Settings: invalid current week.');
    if (st.selectedClassId !== null && !classes.has(st.selectedClassId)) err('Settings: selected class is missing.');
    if (st.weekFilter !== 'all' && !isPosInt(st.weekFilter)) err('Settings: invalid week filter.');
    if (st.lastExportedAt !== null && !isIsoDate(st.lastExportedAt)) err('Settings: invalid last-exported date.');
    return errors;
  }

  // ---------- backup / restore ----------

  function localDateStamp(date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  }

  const exportFilename = (date) => `past-paper-tracker-backup-${localDateStamp(date)}.json`;

  /** Records the export time and builds the backup from the updated state. */
  function exportBackup(s, date) {
    const exportedAt = date.toISOString();
    const state = Object.assign({}, s, { settings: Object.assign({}, s.settings, { lastExportedAt: exportedAt }) });
    const backup = { schemaVersion: SCHEMA_VERSION, exportedAt, appVersion: APP_VERSION, data: clone(state) };
    return ok(state, { backup, filename: exportFilename(date), json: JSON.stringify(backup, null, 2) });
  }

  /** "never", "today", "1 day ago", "N days ago". */
  function lastExportedText(lastExportedAt, now) {
    if (!lastExportedAt) return 'never';
    const days = Math.floor((now.getTime() - Date.parse(lastExportedAt)) / 86400000);
    if (days <= 0) return 'today';
    return days === 1 ? '1 day ago' : `${days} days ago`;
  }

  function summarise(d) {
    return {
      classes: d.classes.length,
      papers: d.papers.length,
      questions: d.questions.length,
      unusableQuestions: d.questions.filter((q) => q.unusable).length,
      usages: d.usages.length,
    };
  }

  /**
   * Validates a backup (JSON text or parsed object). Nothing is changed.
   * Success: { ok, data, summary } — pass `data` to applyImport after confirmation.
   */
  function validateBackup(input) {
    let b = input;
    if (typeof input === 'string') {
      try { b = JSON.parse(input); } catch (e) { return fail('The file is not valid JSON.', { errors: ['The file is not valid JSON.'] }); }
    }
    const reject = (errors) => fail('This backup cannot be imported:\n' + errors.join('\n'), { errors });
    if (!b || typeof b !== 'object' || Array.isArray(b)) return reject(['Not a Past-Paper Tracker backup.']);
    if (!Number.isInteger(b.schemaVersion) || b.schemaVersion < 1) return reject(['Missing or invalid schema version.']);
    if (b.schemaVersion > SCHEMA_VERSION) {
      return reject([`This backup was made by a newer version of the app (schema ${b.schemaVersion}; this app supports ${SCHEMA_VERSION}).`]);
    }
    if (!isIsoDate(b.exportedAt)) return reject(['Missing or invalid export date.']);
    const errors = validateData(b.data);
    if (errors.length) return reject(errors);
    const data = clone(b.data);
    const out = { courses: data.courses, papers: data.papers, questions: data.questions, classes: data.classes,
      classPapers: data.classPapers, usages: data.usages, settings: {
        academicYear: data.settings.academicYear, currentWeek: data.settings.currentWeek,
        selectedClassId: data.settings.selectedClassId, weekFilter: data.settings.weekFilter,
        lastExportedAt: data.settings.lastExportedAt,
      } };
    return { ok: true, data: out, summary: summarise(out) };
  }

  /** Replaces all data with a validated backup's data. */
  function applyImport(validated) {
    if (!validated || !validated.ok) return fail('Backup has not been validated.');
    return ok(clone(validated.data));
  }

  return {
    SCHEMA_VERSION, APP_VERSION, COURSE_NAMES,
    parsePositiveInt, isValidAcademicYear, parseAcademicYear, formatAcademicYear, nextAcademicYear, inferAcademicYear,
    createInitialState, getCourse, getClass, getPaper, getQuestion, getUsage, questionsOfPaper,
    compareUsageRecency, usageLabel, historyLabel, usageHistory, cellState,
    checkUsage, createUsage, editUsage, deleteUsage, setUnusable,
    createClass, renameClass, deleteClass, selectClass,
    addPaper, renamePaper, setQuestionCount, paperDeletionBlockers, deletePaper, setPaperActive, movePaper, checklist,
    startNextAcademicYear, incrementWeek, setWeekFilter,
    buildGrid, validateData, exportFilename, exportBackup, lastExportedText, validateBackup, applyImport,
  };
});
