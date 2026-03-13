# Vimium Mac

## Build & Test

- `npm run build` — esbuild compile
- `npm test` — node built-in test runner (`node --test tests/*.test.js`)

## Bug Scenario Workflow

When the user pastes a **DOM snippet and/or screenshot** showing a hint mode bug (or similar UI bug):

1. **Understand the scenario**: Read the DOM structure and screenshot to identify what's wrong (e.g. duplicate hints, missing hints, hint on wrong element).

2. **Write a regression test first**: Before or alongside the fix, add a test in `tests/HintMode.test.js` that:
   - **Simplify the DOM**: Distill the pasted snippet down to the minimal structure that reproduces the issue. Strip out irrelevant attributes, classes, and sibling elements. The test fixture should be the smallest DOM tree that triggers the bug — not a copy-paste of the full site markup.
   - Reconstruct that simplified DOM using `makeElement()` helpers, wiring up `parentElement`/`children` relationships to match.
   - Includes a descriptive comment at the top of the test stating the **site**, **DOM pattern**, and **what the test proves** (e.g. "GitHub: nested `<button>` inside `<button>` — only inner buttons get hints, not the wrapper").
   - Asserts the correct behavior: right number of hints, correct elements hinted, correct dedup outcome.

3. **Implement the fix** in `src/modules/HintMode.ts`.

4. **Verify**: `npm run build && npm test` — all tests pass.

Each pasted scenario = one test. The test is the proof that the bug is fixed and won't regress.
