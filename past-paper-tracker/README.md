# Past-Paper Tracker

The app is the single file `past-paper-tracker.html` (inline CSS and JS, no network).
Open it directly in Chrome or Edge.

Current build: full UI on in-memory data, with JSON backup and restore. Data is not
yet kept in browser storage, so reloading starts empty: use Import to load a backup.

## Source layout

- `src/logic.js` – pure data logic (Stage 1), unit-tested
- `src/app.js` – UI
- `src/app.html` – page shell and styles
- `build.js` – inlines the two scripts into `past-paper-tracker.html`

Edit files in `src/`, then:

    npm run build   # regenerate past-paper-tracker.html
    npm test        # checks the built file is up to date, then runs all tests

Node 18+, no dependencies.
