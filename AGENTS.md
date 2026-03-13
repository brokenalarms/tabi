# Vimium Mac

## Build & Test

- `npm run build` — esbuild compile
- `npm test` — node built-in test runner (`node --test tests/*.test.js`)

## Bug Scenario Workflow (DOM PROBLEMS MODE)
The internet is full of quirks. For every new bug, we want to make sure that we implement a fix in a way that slots in generically into our click selector pipeline and doesn't make the code increasingly complicated. We should be searching for a way to make a fix generic and applicable to new use cases rather than accounting specifically for one. 

we also want to fix these in the most streamlined way possible without a lot of feedback. Therefore, with the below prompt, you will enter 'DOM problem mode'.

When the user pastes a **DOM snippet, screenshot and URL** showing a hint mode bug (or similar UI bug):

- **Understand the scenario**: Read the DOM structure and screenshot to identify what's wrong (e.g. duplicate hints, missing hints, hint on wrong element).

- **Simplify the DOM**: Distill the pasted snippet down to the minimal structure that reproduces the issue. Strip out irrelevant attributes, classes, and sibling elements. The test fixture should be the smallest DOM tree that triggers the bug — not a copy-paste of the full site markup.

- **Verify** that your understanding of the issue is correct before proceeding. Echo back to the user
  - ISSUE: Your understanding of what the issue is
  - SITE: URL where seen
  - DOM: The simplified representation
  - FIX: Your proposed fix, using the same language of the issue

If the user agrees, you may proceed:

- **Write a TDD test first that should be broken at first**: Before the fix, add a test in `tests/HintMode.test.js` that:
   - Reconstruct that simplified DOM using `makeElement()` helpers, wiring up `parentElement`/`children` relationships to match.
   - Do NOT  write DOM in the comments. Create a string for this simplified DOM, that you feed to makeElement, and this will be the basis of your test. 
   - Includes a comment at the top of the test in the same format, stating the ISSUE, SITE, and FIX, or **what the test proves** (e.g. "GitHub: nested `<button>` inside `<button>` — only inner buttons get hints, not the wrapper").
   - Asserts the correct behavior: right number of hints, correct elements hinted, correct dedup outcome.

- **Implement the fix** in `src/modules/HintMode.ts`.

-  **Verify**: `npm run build && npm test` — all tests pass.

- **Review** Is there a better way to integrate this edge test in a generic way so that it not specifically fixing the issue at hand, but a class of issues? 

Each pasted scenario = one test. The test is the proof that the bug is fixed and won't regress.
