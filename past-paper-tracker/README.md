# Past-Paper Tracker

The app is the single file `past-paper-tracker.html` (inline CSS and JS, no network).
Open it directly in Chrome or Edge.

Stage 2 (current): full UI on in-memory data. Nothing is saved yet; reloading the
page starts empty. Use "Load sample data" / "Load stress data" to try it.

## Source layout

- `src/logic.js` – pure data logic (Stage 1), unit-tested
- `src/sample.js` – sample and stress data, built through the logic functions
- `src/app.js` – UI
- `src/app.html` – page shell and styles
- `build.js` – inlines the three scripts into `past-paper-tracker.html`

Edit files in `src/`, then:

    npm run build   # regenerate past-paper-tracker.html
    npm test        # checks the built file is up to date, then runs all tests

Node 18+, no dependencies.
