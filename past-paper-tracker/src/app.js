/*
 * Past-Paper Tracker — UI. All data changes go through PPT (logic.js) via commit().
 * Interim build: in-memory state, with working JSON backup/restore. Persistent browser storage can be added separately.
 */
(function () {
  'use strict';

  const L = window.PPT;
  const env = {
    id: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  };

  let state = L.createInitialState(env, new Date());

  // Backup baseline: kept in memory for this interim build. When persistence is added,
  // this can move to the same browser-backed baseline used by Retrieval Tracker.
  function backupDataHash(value) {
    const data = JSON.parse(JSON.stringify(value));
    if (data.settings) data.settings.lastExportedAt = null;
    const json = JSON.stringify(data);
    let h = 0;
    for (let i = 0; i < json.length; i++) h = (h * 31 + json.charCodeAt(i)) | 0;
    return String(h);
  }
  let backupBaselineHash = backupDataHash(state);

  function updateBackupUI() {
    const btn = $('exportBtn');
    const indicator = $('backup-needed-indicator');
    if (!btn) return;
    const needsBackup = backupDataHash(state) !== backupBaselineHash;
    btn.classList.toggle('needs-backup', needsBackup);
    if (indicator) indicator.classList.toggle('visible', needsBackup);
  }

  function markBackupClean() {
    backupBaselineHash = backupDataHash(state);
    updateBackupUI();
  }

  const $ = (id) => document.getElementById(id);
  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);

  /** Applies a logic result. Returns the error message, or null on success. */
  function commit(res) {
    if (!res.ok) return res.error;
    state = res.state;
    render();
    updateBackupUI();
    return null;
  }

  // ---------- selection helpers ----------

  function sortedClasses() {
    return state.classes.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  function currentClass() {
    return L.getClass(state, state.settings.selectedClassId);
  }

  /** Keeps a valid class selected whenever classes exist. */
  function ensureSelection() {
    if (!currentClass() && state.classes.length) {
      state = L.selectClass(state, sortedClasses()[0].id).state;
    }
  }

  // ---------- render ----------

  function render() {
    ensureSelection();
    renderTop();
    renderPapersRow();
    renderGrid();
    if (popup) renderPopup();
  }

  function renderTop() {
    const cls = currentClass();
    const sel = $('classSel');
    sel.innerHTML = state.classes.length
      ? sortedClasses().map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')
      : '<option value="">No classes yet</option>';
    sel.value = cls ? cls.id : '';
    sel.disabled = !state.classes.length;
    $('classRename').disabled = !cls;
    $('classDelete').disabled = !cls;

    $('yearVal').textContent = state.settings.academicYear;

    const weekIn = $('weekIn');
    if (document.activeElement !== weekIn) {
      weekIn.value = state.settings.currentWeek;
      weekIn.classList.remove('invalid');
      $('weekErr').textContent = '';
    }
    $('weekDown').disabled = state.settings.currentWeek <= 1;

    // Week filter: All weeks, plus every week up to the current week or the latest used week.
    const wf = state.settings.weekFilter;
    let maxWeek = state.settings.currentWeek;
    for (const u of state.usages) {
      if (cls && u.classId === cls.id && u.academicYear === state.settings.academicYear) maxWeek = Math.max(maxWeek, u.week);
    }
    if (wf !== 'all') maxWeek = Math.max(maxWeek, wf);
    let opts = '<option value="all">All weeks</option>';
    for (let w = 1; w <= maxWeek; w++) opts += `<option value="${w}">Week ${w}</option>`;
    const fs = $('filterSel');
    fs.innerHTML = opts;
    fs.value = String(wf);

    const last = L.lastExportedText(state.settings.lastExportedAt, new Date());
    $('lastExported').textContent = 'Last backup: ' + (last === 'never' ? 'Never' : last);
    updateBackupUI();
  }

  function renderPapersRow() {
    const cls = currentClass();
    const row = $('papersRow');
    if (!cls) {
      row.innerHTML = '';
      return;
    }
    const papers = L.checklist(state, cls.id);
    const activeCount = papers.filter((x) => x.active).length;
    const options = papers.map((x) =>
      `<label class="paper-option${x.active ? ' on' : ''}">` +
      `<input type="checkbox" data-paper="${esc(x.paper.id)}"${x.active ? ' checked' : ''}>` +
      `<span class="paper-name">${esc(x.paper.name)}</span>` +
      `<span class="paper-count">${x.paper.questionCount} Q</span>` +
      `</label>`
    ).join('');

    row.innerHTML =
      `<div class="paper-selector-wrap">` +
        `<button class="paper-selector-btn" id="paperSelectorBtn" type="button" aria-expanded="false">` +
          `Select papers <span class="count">(${activeCount} active)</span>` +
        `</button>` +
        `<div class="paper-selector" id="paperSelector" hidden>` +
          `<div class="paper-selector-head">` +
            `<span class="paper-selector-title">Active papers</span>` +
            `<span class="paper-selector-actions">` +
              `<button class="link" type="button" data-paper-select="all">All</button>` +
              `<button class="link" type="button" data-paper-select="none">None</button>` +
            `</span>` +
          `</div>` +
          `<div class="paper-selector-list">${options}</div>` +
        `</div>` +
      `</div>` +
      `<button class="link" id="paperAdd">+ Add paper</button>` +
      `<span class="legend">` +
        `<span><span class="sw" style="background:var(--cell-green-bg);border-color:var(--cell-green-border)"></span>Available</span>` +
        `<span><span class="sw" style="background:var(--cell-red-bg);border-color:var(--cell-red-border)"></span>Used</span>` +
        `<span><span class="sw" style="background:repeating-linear-gradient(135deg,var(--cell-grey-bg) 0 3px,var(--cell-grey-stripe) 3px 6px);border-color:#4d4d4d"></span>Unusable</span>` +
      `</span>`;
  }

  function renderGrid() {
    const wrap = $('gridWrap');
    const top = wrap.scrollTop, left = wrap.scrollLeft;
    const cls = currentClass();
    if (!cls) {
      wrap.innerHTML = '<div class="empty-msg">No classes yet. Use <b>New</b> next to Class to create one, or <b>Import</b> a backup.</div>';
      return;
    }
    const grid = L.buildGrid(state, cls.id);
    if (!grid.columns.length) {
      wrap.innerHTML = '<div class="empty-msg">No active papers for this class. Tick papers above, or use <b>+ Add paper</b>.</div>';
      return;
    }
    const last = grid.columns.length - 1;
    const head = grid.columns.map((col, i) => {
      const m = /^(\d{4})\s+(.+)$/.exec(col.paper.name.trim());
      const paperHeader = m
        ? `<span class="pname" title="${esc(col.paper.name)} (${col.paper.questionCount} questions)"><span class="pyear">${esc(m[1])}</span><span class="pcode">${esc(m[2])}</span></span>`
        : `<span class="pname" title="${esc(col.paper.name)} (${col.paper.questionCount} questions)">${esc(col.paper.name)}</span>`;
      return `<th data-paper="${esc(col.paper.id)}"><div class="ph">` +
      paperHeader +
      `<span class="pctl">` +
      `<button data-act="left" title="Move left"${i === 0 ? ' disabled' : ''}>&#8249;</button>` +
      `<button data-act="menu" title="Paper options">&#8943;</button>` +
      `<button data-act="right" title="Move right"${i === last ? ' disabled' : ''}>&#8250;</button>` +
      `</span></div></th>`;
    }).join('');
    const openQ = popup ? popup.questionId : null;
    const rows = [];
    for (let r = 0; r < grid.rowCount; r++) {
      let tr = `<tr><th>Q${r + 1}</th>`;
      for (const col of grid.columns) {
        const c = col.cells[r];
        if (!c) { tr += '<td class="c none"></td>'; continue; }
        let cl = 'c ' + c.status;
        if (c.muted) cl += ' muted';
        if (c.highlight) cl += ' hl';
        if (c.question.id === openQ) cl += ' open';
        const text = c.highlight ? c.filterLabel : c.label;
        tr += `<td class="${cl}" data-q="${esc(c.question.id)}">${esc(text)}</td>`;
      }
      rows.push(tr + '</tr>');
    }
    wrap.innerHTML = `<table class="grid"><thead><tr><th class="corner"></th>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
    wrap.scrollTop = top;
    wrap.scrollLeft = left;
  }

  // ---------- cell popup ----------

  /** { questionId, editingId } while open. */
  let popup = null;

  function openPopup(questionId) {
    closeMenu();
    popup = { questionId, editingId: null };
    markOpenCell();
    renderPopup();
  }

  function closePopup() {
    if (!popup) return;
    popup = null;
    $('popup').hidden = true;
    $('popup').innerHTML = '';
    markOpenCell();
  }

  function markOpenCell() {
    const wrap = $('gridWrap');
    wrap.querySelectorAll('td.c.open').forEach((td) => td.classList.remove('open'));
    if (popup) {
      const td = wrap.querySelector(`td.c[data-q="${CSS.escape(popup.questionId)}"]`);
      if (td) td.classList.add('open');
    }
  }

  function recordForm(label) {
    return `<form data-form="record" class="rec" autocomplete="off">` +
      `<label for="pqIn">${label}</label><input type="text" id="pqIn" inputmode="numeric" autocomplete="off">` +
      `</form><div class="err" data-err="record"></div>`;
  }

  function renderPopup() {
    const el = $('popup');
    const cls = currentClass();
    const q = popup && L.getQuestion(state, popup.questionId);
    if (!cls || !q) { closePopup(); return; }
    const paper = L.getPaper(state, q.paperId);
    const cell = L.cellState(state, cls.id, q.id);
    const st = state.settings;
    const history = L.usageHistory(state, cls.id, q.id);

    let html = `<div class="ctx"><b>${esc(cls.name)}</b> · ${esc(st.academicYear)} · Week ${st.currentWeek} · <b>${esc(paper.name)} Q${q.number}</b></div>`;

    if (cell.status === 'unusable') {
      html += `<p class="note">Marked unusable for all classes.`;
      if (history.length) html += ` This class used it: ${history.map((u) => esc(L.historyLabel(u))).join(', ')}.`;
      html += `</p><div class="foot" style="border:0;margin:0;padding:0"><button class="btn small" data-act="restore">Restore</button></div>`;
    } else {
      if (cell.status === 'used') {
        html += `<div class="sec">History</div><ul class="hist">`;
        for (const u of history) {
          if (u.id === popup.editingId) {
            html += `<li><form data-form="edit" data-u="${esc(u.id)}" autocomplete="off">` +
              `<input type="text" class="y" name="academicYear" value="${esc(u.academicYear)}" aria-label="Academic year">` +
              `<span class="muted-text">Wk</span><input type="text" class="w" name="week" inputmode="numeric" value="${u.week}" aria-label="Week">` +
              `<span class="muted-text">Q</span><input type="text" class="p" name="packQuestion" inputmode="numeric" value="${u.packQuestion}" aria-label="Pack question">` +
              `<button class="btn small" type="submit">Save</button>` +
              `<button class="link" type="button" data-act="edit-cancel">Cancel</button>` +
              `</form></li><li><div class="err" data-err="edit"></div></li>`;
          } else {
            html += `<li><span class="h">${esc(L.historyLabel(u))}</span>` +
              `<button class="link" data-act="edit" data-u="${esc(u.id)}">Edit</button>` +
              `<button class="link danger" data-act="delete" data-u="${esc(u.id)}">Delete</button></li>`;
          }
        }
        html += `</ul><div class="sec">Record another use</div>`;
      }
      html += recordForm('Pack question');
      html += `<div class="foot"><button class="link danger" data-act="unusable">Mark unusable (all classes)</button></div>`;
    }

    el.innerHTML = html;
    el.hidden = false;
    positionPopup();

    const focusTarget = popup.editingId
      ? el.querySelector('form[data-form="edit"] input[name="packQuestion"]')
      : el.querySelector('#pqIn') || el.querySelector('[data-act="restore"]');
    if (focusTarget) {
      focusTarget.focus({ preventScroll: true });
      if (focusTarget.select) focusTarget.select();
    }
  }

  /** Places a floating element next to an anchor rect, kept inside the viewport. */
  function placeNear(el, rect) {
    const pad = 8;
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = rect.right + 6;
    if (x + w > window.innerWidth - pad) x = rect.left - w - 6;
    if (x < pad) x = Math.max(pad, Math.min(rect.left, window.innerWidth - w - pad));
    let y = rect.top - 4;
    if (y + h > window.innerHeight - pad) y = window.innerHeight - h - pad;
    if (y < pad) y = pad;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }

  function positionPopup() {
    if (!popup) return;
    const td = $('gridWrap').querySelector(`td.c[data-q="${CSS.escape(popup.questionId)}"]`);
    if (td) placeNear($('popup'), td.getBoundingClientRect());
  }

  function popupError(kind, msg) {
    const e = $('popup').querySelector(`[data-err="${kind}"]`);
    if (e) e.textContent = msg || '';
  }

  $('popup').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const cls = currentClass();
    if (form.dataset.form === 'record') {
      const input = form.querySelector('input');
      const res = L.createUsage(state, { classId: cls.id, questionId: popup.questionId, packQuestion: input.value }, env);
      if (!res.ok) { popupError('record', res.error); input.focus(); return; }
      closePopup();
      commit(res);
    } else if (form.dataset.form === 'edit') {
      const v = (n) => form.querySelector(`[name="${n}"]`).value;
      const res = L.editUsage(state, form.dataset.u, { academicYear: v('academicYear'), week: v('week'), packQuestion: v('packQuestion') }, env);
      if (!res.ok) { popupError('edit', res.error); return; }
      popup.editingId = null;
      commit(res);
    }
  });

  $('popup').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'edit') { popup.editingId = b.dataset.u; renderPopup(); }
    else if (act === 'edit-cancel') { popup.editingId = null; renderPopup(); }
    else if (act === 'delete') { if (popup.editingId === b.dataset.u) popup.editingId = null; commit(L.deleteUsage(state, b.dataset.u)); }
    else if (act === 'unusable') { const qid = popup.questionId; closePopup(); commit(L.setUnusable(state, qid, true)); }
    else if (act === 'restore') { const qid = popup.questionId; closePopup(); commit(L.setUnusable(state, qid, false)); }
  });

  // ---------- grid events ----------

  $('gridWrap').addEventListener('click', (ev) => {
    const td = ev.target.closest('td.c');
    if (td && !td.classList.contains('none')) {
      if (popup && popup.questionId === td.dataset.q) closePopup();
      else openPopup(td.dataset.q);
      return;
    }
    const btn = ev.target.closest('th[data-paper] button[data-act]');
    if (!btn) return;
    const paperId = btn.closest('th').dataset.paper;
    const cls = currentClass();
    if (btn.dataset.act === 'left' || btn.dataset.act === 'right') {
      closePopup();
      commit(L.movePaper(state, cls.id, paperId, btn.dataset.act === 'left' ? -1 : 1));
    } else if (btn.dataset.act === 'menu') {
      openMenu(paperId, btn);
    }
  });

  $('gridWrap').addEventListener('scroll', () => {
    positionPopup();
    if (menuPaperId) closeMenu();
  });
  window.addEventListener('resize', positionPopup);

  // ---------- column menu ----------

  let menuPaperId = null;

  function openMenu(paperId, anchor) {
    closePopup();
    if (menuPaperId === paperId) { closeMenu(); return; }
    menuPaperId = paperId;
    const m = $('menu');
    m.innerHTML =
      '<button data-act="rename">Rename…</button>' +
      '<button data-act="count">Change question count…</button>' +
      '<button data-act="deactivate">Untick for this class</button>' +
      '<button data-act="delete" class="danger">Delete paper…</button>';
    m.hidden = false;
    const r = anchor.getBoundingClientRect();
    placeNear(m, { left: r.left, right: r.left - 6, top: r.bottom + 8, bottom: r.bottom });
  }

  function closeMenu() {
    menuPaperId = null;
    $('menu').hidden = true;
  }

  $('menu').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-act]');
    if (!b) return;
    const paper = L.getPaper(state, menuPaperId);
    closeMenu();
    if (!paper) return;
    if (b.dataset.act === 'rename') renamePaperDialog(paper);
    else if (b.dataset.act === 'count') countDialog(paper);
    else if (b.dataset.act === 'deactivate') commit(L.setPaperActive(state, currentClass().id, paper.id, false));
    else if (b.dataset.act === 'delete') deletePaperDialog(paper);
  });

  // ---------- global close behaviour ----------

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || $('dlg').open) return;
    if (popup) { ev.preventDefault(); closePopup(); }
    if (menuPaperId) closeMenu();
    const selector = $('paperSelector');
    if (selector && !selector.hidden) {
      selector.hidden = true;
      $('paperSelectorBtn')?.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('mousedown', (ev) => {
    if ($('dlg').open) return;
    if (popup && !$('popup').contains(ev.target) && !ev.target.closest('td.c')) closePopup();
    if (menuPaperId && !$('menu').contains(ev.target) && !ev.target.closest('button[data-act="menu"]')) closeMenu();

    const selector = $('paperSelector');
    if (selector && !selector.hidden &&
        !selector.contains(ev.target) &&
        !ev.target.closest('#paperSelectorBtn')) {
      selector.hidden = true;
      $('paperSelectorBtn')?.setAttribute('aria-expanded', 'false');
    }
  });

  // ---------- dialogs ----------

  let dlgSubmit = null;

  /**
   * fields: [{ name, label, value, type: 'text'|'select', options: [{value,label}] }]
   * onSubmit(values) returns an error message to show (dialog stays open) or null to close.
   * Pass submit: null for an information-only dialog.
   */
  function openDialog({ title, message = '', fields = [], submit = 'OK', danger = false, cancel = 'Cancel', onSubmit }) {
    closePopup();
    closeMenu();
    $('dlgTitle').textContent = title;
    $('dlgMsg').textContent = message;
    $('dlgMsg').hidden = !message;
    $('dlgErr').textContent = '';
    $('dlgFields').innerHTML = fields.map((f, i) => {
      const id = `dlgF${i}`;
      const input = f.type === 'select'
        ? `<select id="${id}" name="${f.name}">${f.options.map((o) =>
          `<option value="${esc(o.value)}"${o.value === f.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
        : `<input type="text" id="${id}" name="${f.name}" value="${esc(f.value ?? '')}" autocomplete="off"${f.numeric ? ' inputmode="numeric"' : ''}>`;
      return `<div class="fld"><label for="${id}">${esc(f.label)}</label>${input}</div>`;
    }).join('');
    const ok = $('dlgOk');
    ok.hidden = submit === null;
    ok.textContent = submit || '';
    ok.className = danger ? 'btn danger' : 'btn';
    $('dlgCancel').textContent = submit === null ? 'Close' : cancel;
    dlgSubmit = onSubmit || null;
    $('dlg').showModal();
    const first = $('dlgFields').querySelector('input, select');
    if (first) { first.focus(); if (first.select) first.select(); }
    else if (submit !== null) ok.focus();
    else $('dlgCancel').focus();
  }

  $('dlgForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!dlgSubmit) { $('dlg').close(); return; }
    const values = {};
    $('dlgFields').querySelectorAll('[name]').forEach((el) => { values[el.name] = el.value; });
    const err = dlgSubmit(values);
    if (err) $('dlgErr').textContent = err;
    else $('dlg').close();
  });
  $('dlgCancel').addEventListener('click', () => $('dlg').close());

  const courseOptions = () => state.courses.map((c) => ({ value: c.id, label: c.name }));

  // ---------- class actions ----------

  $('classSel').addEventListener('change', (ev) => {
    closePopup();
    $('gridWrap').scrollTop = 0;
    $('gridWrap').scrollLeft = 0;
    commit(L.selectClass(state, ev.target.value));
  });

  $('classNew').addEventListener('click', () => {
    openDialog({
      title: 'New class',
      fields: [
        { name: 'name', label: 'Class name', value: '' },
        { name: 'courseId', label: 'Course (cannot be changed later)', type: 'select', options: courseOptions(), value: state.courses[0].id },
      ],
      submit: 'Create class',
      onSubmit: (v) => {
        const res = L.createClass(state, { name: v.name, courseId: v.courseId }, env);
        if (!res.ok) return res.error;
        commit(L.selectClass(res.state, res.cls.id));
        return null;
      },
    });
  });

  $('classRename').addEventListener('click', () => {
    const cls = currentClass();
    openDialog({
      title: 'Rename class',
      message: 'History, active papers and paper order are kept.',
      fields: [{ name: 'name', label: 'Class name', value: cls.name }],
      submit: 'Rename',
      onSubmit: (v) => commit(L.renameClass(state, cls.id, v.name)),
    });
  });

  $('classDelete').addEventListener('click', () => {
    const cls = currentClass();
    const n = state.usages.filter((u) => u.classId === cls.id).length;
    openDialog({
      title: `Delete ${cls.name}?`,
      message: `This permanently removes the class, its ${n} usage record${n === 1 ? '' : 's'}, its active papers and its paper order.\n\nPapers, questions and unusable flags are shared and are not affected.`,
      submit: 'Delete class',
      danger: true,
      onSubmit: () => commit(L.deleteClass(state, cls.id)),
    });
  });

  // ---------- year / week / filter ----------

  $('yearNext').addEventListener('click', () => {
    const next = L.nextAcademicYear(state.settings.academicYear);
    openDialog({
      title: `Start ${next}?`,
      message: `The academic year becomes ${next}, the current week resets to 1 and the week filter resets to All weeks.\n\nNo class data or usage history changes; used questions stay red.`,
      submit: `Start ${next}`,
      onSubmit: () => commit(L.startNextAcademicYear(state)),
    });
  });

  $('weekUp').addEventListener('click', () => commit(L.incrementWeek(state)));
  $('weekDown').addEventListener('click', () => commit(L.decrementWeek(state)));

  function applyWeekInput() {
    const input = $('weekIn');
    if (String(state.settings.currentWeek) === input.value.trim()) {
      input.classList.remove('invalid');
      $('weekErr').textContent = '';
      return true;
    }
    const res = L.setCurrentWeek(state, input.value);
    if (!res.ok) {
      input.classList.add('invalid');
      $('weekErr').textContent = res.error;
      return false;
    }
    input.classList.remove('invalid');
    $('weekErr').textContent = '';
    commit(res);
    input.value = state.settings.currentWeek;
    return true;
  }

  $('weekIn').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      if (applyWeekInput()) $('weekIn').blur();
    } else if (ev.key === 'Escape') {
      $('weekIn').value = state.settings.currentWeek;
      $('weekIn').blur();
      renderTop();
    }
  });
  // On leaving the field: apply if valid, otherwise keep the typed value and show the error.
  $('weekIn').addEventListener('blur', applyWeekInput);

  $('filterSel').addEventListener('change', (ev) => commit(L.setWeekFilter(state, ev.target.value)));

  // ---------- papers ----------

  $('papersRow').addEventListener('change', (ev) => {
    const cb = ev.target.closest('input[data-paper]');
    if (!cb) return;
    closePopup();
    commit(L.setPaperActive(state, currentClass().id, cb.dataset.paper, cb.checked));
  });

  $('papersRow').addEventListener('click', (ev) => {
    const selectorBtn = ev.target.closest('#paperSelectorBtn');
    if (selectorBtn) {
      const panel = $('paperSelector');
      const isOpen = !panel.hidden;
      panel.hidden = isOpen;
      selectorBtn.setAttribute('aria-expanded', String(!isOpen));
      return;
    }

    const selectAction = ev.target.closest('[data-paper-select]');
    if (selectAction) {
      const cls = currentClass();
      const wantActive = selectAction.dataset.paperSelect === 'all';
      let next = state;
      for (const item of L.checklist(state, cls.id)) {
        next = L.setPaperActive(next, cls.id, item.paper.id, wantActive).state;
      }
      closePopup();
      commit({ ok: true, state: next });
      return;
    }

    if (!ev.target.closest('#paperAdd')) return;
    const cls = currentClass();
    openDialog({
      title: 'Add paper',
      message: `The paper is added to every class on its course, ticked only for ${cls.name}. The question count can be corrected later.`,
      fields: [
        { name: 'courseId', label: 'Course', type: 'select', options: courseOptions(), value: cls.courseId },
        { name: 'name', label: 'Paper name (e.g. 2024 P2)', value: '' },
        { name: 'questionCount', label: 'Number of questions', value: '', numeric: true },
      ],
      submit: 'Add paper',
      onSubmit: (v) => commit(L.addPaper(state, {
        courseId: v.courseId,
        name: v.name,
        questionCount: v.questionCount,
        fromClassId: v.courseId === cls.courseId ? cls.id : null,
      }, env)),
    });
  });

  function renamePaperDialog(paper) {
    openDialog({
      title: 'Rename paper',
      message: 'The new name applies to every class on this course. History is kept.',
      fields: [{ name: 'name', label: 'Paper name', value: paper.name }],
      submit: 'Rename',
      onSubmit: (v) => commit(L.renamePaper(state, paper.id, v.name)),
    });
  }

  function countDialog(paper) {
    openDialog({
      title: `Question count for ${paper.name}`,
      message: 'Increasing adds questions. Reducing is only allowed if none of the removed questions has been used by any class or marked unusable.',
      fields: [{ name: 'count', label: 'Number of questions', value: String(paper.questionCount), numeric: true }],
      submit: 'Save',
      onSubmit: (v) => commit(L.setQuestionCount(state, paper.id, v.count, env)),
    });
  }

  function deletePaperDialog(paper) {
    const blockers = L.paperDeletionBlockers(state, paper.id);
    if (blockers.length) {
      openDialog({
        title: `${paper.name} cannot be deleted`,
        message: 'It has recorded data. You can untick it instead, which hides it without deleting anything.\n\n' +
          blockers.map((b) => b.message).join('\n'),
        submit: null,
      });
      return;
    }
    openDialog({
      title: `Delete ${paper.name}?`,
      message: `This removes the paper and its ${paper.questionCount} questions for every class on the course.`,
      submit: 'Delete paper',
      danger: true,
      onSubmit: () => commit(L.deletePaper(state, paper.id)),
    });
  }

  // ---------- backup / restore ----------

  function downloadBackup() {
    const res = L.exportBackup(state, new Date());
    if (!res.ok) {
      openDialog({ title: 'Backup failed', message: res.error, submit: null });
      return;
    }
    const blob = new Blob([res.json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = res.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);

    state = res.state;
    markBackupClean();
    render();
  }

  $('exportBtn').addEventListener('click', downloadBackup);

  $('importBtn').addEventListener('click', () => $('importInput').click());

  $('importInput').addEventListener('change', (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const validated = L.validateBackup(reader.result);
        if (!validated.ok) {
          openDialog({ title: 'Import failed', message: validated.error, submit: null });
          return;
        }
        const s = validated.summary;
        openDialog({
          title: 'Restore backup?',
          message: `This will replace the current data with the selected backup.\n\nClasses: ${s.classes}\nPapers: ${s.papers}\nQuestions: ${s.questions}\nUsage records: ${s.usages}\n\nThe current in-memory state will be replaced.`,
          submit: 'Restore backup',
          danger: true,
          onSubmit: () => {
            const res = L.applyImport(validated);
            if (!res.ok) return res.error;
            state = res.state;
            backupBaselineHash = backupDataHash(state);
            $('gridWrap').scrollTop = 0;
            $('gridWrap').scrollLeft = 0;
            render();
            updateBackupUI();
            return null;
          },
        });
      } catch (err) {
        openDialog({ title: 'Import failed', message: String(err.message || err), submit: null });
      } finally {
        ev.target.value = '';
      }
    };
    reader.readAsText(file);
  });

  render();
})();
