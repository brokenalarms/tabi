# Vimium Mac

## Build & Test

- `npm run build` — esbuild compile
- `npm test` — node built-in test runner (`node --test tests/*.test.js`)

## Bug Scenario Workflow (DOM PROBLEMS MODE)
The internet is full of quirks. For every new bug, we want to make sure that we implement a fix in a way that slots in generically into our click selector pipeline and doesn't make the code increasingly complicated. We should be searching for a way to make a fix generic and applicable to new use cases rather than accounting specifically for one. 

- Bad: testing based on visual widths (brittle, subject to change), specific DOM nesting (x levels deep) consideration of non-interactive elements as relevant (p, div, span - these are not useful in determining whether something is interactive). Any element can be interacted with `role="button"` on it, even if it doesn't adhere to web standards)
- Good: consideration of generic attributes (does this element have display: none, visibility: hidden, or some other occlusion applied to it?), and generic framing of the issue in a way that is generalizable to other sites and structures. For example, a label with a sibling input means that the label should be clickable, but the input shouldn't in order to avoid duplication. 

We also want to fix these in the most streamlined way possible without a lot of feedback. Therefore, with the below prompt, you will enter 'DOM problem mode'. This will be done once per session due to the large context window required for DOM parsing, so avoiding wasted tokens is important.

When the user pastes a **DOM snippet, screenshot and URL** showing a hint mode bug (or similar UI bug):

- echo "DOM PROBLEM MODE" to convey you're entering this flow

- **Understand the scenario**: Read the DOM structure and screenshot to identify what's wrong (e.g. duplicate hints, missing hints, hint on wrong element). There may be multiple issues.

- **Simplify the DOM**: Distill the pasted snippet down to the minimal structure that reproduces the issue. Strip out irrelevant attributes, classes, and sibling elements. The test fixture should be the smallest DOM tree that triggers the bug — not a copy-paste of the full site markup.

- **Verify** that your understanding of the issue is correct before proceeding. Do NOT start fixing the problem without verifying, your guess is often wrong!
  Echo back to the user in the following format:
  - ISSUE: Your understanding of what the issue is, in a generalizable way
  - SITE: URL where seen
  - DOM: The simplified representation
  - FIX: Your proposed fix, using the same language of the issue

If the user agrees, you may proceed:

- **Write a TDD test first that must be broken at first**: BEFORE you write the the fix, add a test  that:
   - Reconstructs that simplified DOM using `happy-dom`.
   - Do NOT  write DOM in the comments. Create a string for this simplified DOM, that you feed to `happy-dom`, and this will be the basis of your test.
   - **Use `createDOM()` with a multi-line template literal** so the DOM structure is readable at a glance:
     ```ts
     const env = createDOM(`
         <li>
             <span>
                 <a id="t" href="#">link</a>
             </span>
         </li>
     `);
     ```
     Only fall back to `makeElement()` when the test needs mock bounding rects (happy-dom has no layout engine), specific `getBoundingClientRect` values for positioning assertions, or other attributes that can't be expressed in HTML. Never use `makeElement` + `appendChild` chains when a readable HTML string would work.
   - The test title summarizes the assertion, eg 'it selects only top level xyz'. Don't write "DOM Problems" in it ya clown :)
   - Includes a comment at the top of the test in the same format, stating the ISSUE, SITE, and FIX, or **what the test proves** (e.g. "GitHub: nested `<button>` inside `<button>` — only inner buttons get hints, not the wrapper").
   - **Prove causality by isolating the variable.** When a test claims that a specific attribute or property causes a behavior change, it MUST assert the behavior is absent WITHOUT that variable, then assert it is present WITH it. The delta between the two assertions is what proves the variable is the cause. This applies to ALL tests — including predicate unit tests. For example, a test proving `hasBox` returns false for `display:contents` must first show it returns true for a box-generating value (e.g. `display:block`), then show the change to `display:contents` flips the result. Without the base case, there's no proof the variable under test is what caused the change. Comment each phase:
     ```ts
     // Base: block div has a box
     assert.equal(hasBox(el), true);

     // Delta: display:contents removes the box
     el.style.display = "contents";
     assert.equal(hasBox(el), false);
     ```
   - Asserts the correct behavior: right number of hints, correct elements hinted, correct dedup outcome.
   - For unit tests, you don't need a new test for every pair if it just returns one of a set of values. You can assert each value within the same test.
   - Run the test and assert that it fails.

- Only then **Implement the fix**.

-  **Verify**: `npm run build && npm test` — all tests pass, without you needing to modify the test to fit after the fact unless a new edge case is somehow uncovered.
 
- **Review** Is there a better way to integrate this edge test in a generic way so that it not specifically fixing the issue at hand, but a class of issues? It should integrate seamlessly into the existing pipeline, not be a random 'if this unique situation then do something completely different' function call. If it doesn't fit, should we think about refactoring to better generically handle it for future flexibility, so the change is not brittle and liable to break again if the website changes?

- **Pull in the latest from origin main, commit and create PR** then we have a history of each fix in Github as well. This is part of completing the fix after I agree, you don't need to ask to create a PR. If there are errors we can update it (updating the description to account for all commits each time).
- CHECK before updating a PR that it's not already merged. If you're just pushing to a branch post-PR merge, you'll need to create a new PR.

Each pasted scenario = one test. The test is the proof that the bug is fixed and won't regress.

## Architecture

### Composable stateless predicates

`ElementGatherer.ts` and `HintMode.ts` are orchestrators — they compose small, stateless, exported predicate functions that each identify a single characteristic of an element (`isBlockLevel`, `isInRepeatingContainer`, `hasHeadingContent`, `isContentlessOverlay`, `isOccluded`, etc.). Each predicate answers one question about the element: "is it visible?", "is it in a repeating container?", "does it contain a heading?". The orchestrator then composes these to make decisions.

This makes the pipeline easy to understand at a glance and easy to unit-test — each predicate can be tested in isolation with a minimal DOM fixture. When adding new logic, extract the element characteristic as a named predicate in `ElementGatherer.ts` rather than adding inline checks inside `walkerFilter`, `discoverElements`, or `getHintTargetElement`. Predicates should identify **what** an element is, not decide **what to do** with it — that's the orchestrator's job.

Shared constants (`NATIVE_INTERACTIVE_ELEMENTS`, `CLICKABLE_SELECTOR`, `HEADING_SELECTOR`, etc.) live in `constants.ts` and are re-exported by `ElementGatherer.ts` for backward compatibility.

### No `cursor:pointer` discovery (removed March 2026)

The element discovery pipeline only uses semantic signals (`CLICKABLE_SELECTOR`: native interactive elements, ARIA roles, `tabindex`, `onclick`, `label[for]`). We intentionally do **not** use `cursor:pointer` as a fallback discovery signal.

**Why:** `cursor:pointer` was originally added to catch SPA elements that use JS click handlers without ARIA markup. In practice, it produced far more false positives than true positives — non-interactive images, decorative wrappers, and overlay containers all receive `cursor:pointer` from CSS inheritance or card styling. Each false positive required a new dedup rule (wrapper dedup, sibling dedup, cover occlusion exemptions), compounding complexity without improving reliability. The worst case: on card-based layouts (e.g. The Guardian), `cursor:pointer` caused hints to land on images instead of the actual overlay `<a>` link, making cards unclickable.

**Trade-off:** Some JS-only click handlers on unstyled `<div>` elements won't be discovered. This is acceptable because well-built SPAs use ARIA roles, `tabindex`, or semantic HTML, and those signals are already covered. Sites that rely solely on `cursor:pointer` without any accessibility attributes are not accessible to keyboard users either — our coverage aligns with theirs.
