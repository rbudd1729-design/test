# Past-Paper Tracker

Stage 1: pure data logic (`src/logic.js`) and automated tests. No UI yet.

Run tests (Node 18+, no dependencies):

    cd past-paper-tracker && npm test

`src/logic.js` loads as a CommonJS module for the tests and as the global `PPT`
when inlined into the single-file app (Stage 2).
