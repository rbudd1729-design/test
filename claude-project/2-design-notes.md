# Retrieval Tracker: design notes (upload to the Project as knowledge)

## Data model

Saved under localStorage key `learning-engine-state-v1`. Shape: `{ classes: [...], active_class_id }`.

A class record has `id`, `name`, `type` (absent for a school class, `"tutee"` for a tutee), `atoms`, `lesson_dates` (ISO strings), `retrievals`, `settings`, `notes`, `details`, holidays and `planned_atom_ids`. Tutees hold dated `sessions` instead of atoms and retrievals.

An atom has `id`, `name`, `retrieve` ("Y" or "N"), `initial_instruction_date`, `status` (`scheduled`, `historic` or `archived`), `notes`, and optionally `deferUntil`. Historic atoms are recorded as already taught, with no teaching date used. Archived atoms are not scheduled.

A retrieval is `{ atom_id, lesson_date, outcome }`. Outcomes: `pass` (green), `struggle` (amber), `reteach` (red), `ad_hoc` (grey, unscheduled). Old data may contain `miss` and `skip`; they are ignored.

Backups are `{ backup_format: 2, exported_at, ...state }`. Snapshots (last 20) are kept automatically in a separate localStorage key and can be restored from Settings.

## Scheduler (`getAtomSchedulingState`, `plannedGap`, `nextSuggestedDate`)

Per-class settings: seed interval (my value 1 day), multiplier (my value 2), cap (my value 42 days; the code default is 60).

1. **Anchor.** The anchor is the teaching date, or the date of the most recent Re-teach. Only retrievals after the anchor count.
2. **Ignored events.** Unscheduled (grey) retrievals and legacy miss/skip records do not affect scheduling.
3. **Planned gap.** The first planned gap is `min(seed, cap)`.
4. **Pass credit.** Let `planned` be the gap the scheduler intended and `gap` the actual days since the last event.
   - If `gap >= ceil(planned x 0.75)`, credit the full `planned`.
   - Otherwise credit `gap`, but never less than `ceil(planned / multiplier)`.
   - Never credit more than `planned`, so a late retrieval cannot inflate spacing.
5. **Growth.** The next planned gap is `min(max(credited + 1, round(credited x multiplier)), cap)`. The "+1" stops spacing freezing at low multipliers.
6. **Struggle.** The next gap holds at the last successful credited gap, or the seed if there has not been a Pass. No growth.
7. **Re-teach.** Resets the anchor to that date and discards earlier history for scheduling. The earlier events stay visible in history.
8. **Next date.** Target = last event date + planned gap. Choose the latest lesson on or before the target that is at least 75% of the planned gap after the last event. If none qualifies, roll forward to the first lesson after the target. If the calendar has no such lesson, there is no date and the app says there is no lesson in the calendar after the target.
9. **retrieve = "N".** Once a Pass is recorded since the anchor, no further retrievals are scheduled.
10. **Deferral.** `deferUntil` only hides the atom from the due list until that lesson. It is cleared when a scheduled retrieval is recorded. An unscheduled retrieval does not clear it.

## Rules enforced when recording

- A retrieval date must be after the teaching day and not in the future (historic atoms exempt).
- One record per atom per date. Recording over an existing one asks for confirmation.

## Screens

Atoms (Coverage table, the home screen), Classes (class list, details, lesson dates, holidays), Notes, Settings (spacing settings, backup and restore, snapshots, Backfill, Clear everything). For a tutee, the home screen shows sessions with a paid/unpaid toggle and a .txt export.

## Testing approach used so far

A Playwright harness loads the HTML with a real backup in localStorage and the clock fixed at several dates, then records per-atom scheduler output, every screen's text, atom history views and .txt exports. Old and new versions are compared for exact equality. A second script clicks through about 24 realistic actions and compares saved data and screens after each step. Synthetic stress data (re-teach, retrieve=N, deferral, legacy miss/skip, thin calendars, other settings) covers paths my real data does not. These scripts were not saved permanently; ask me to rebuild them.
