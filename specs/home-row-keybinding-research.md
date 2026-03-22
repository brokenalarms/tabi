# Home Row Keybinding Research

Research findings for the optimized (Home Row) preset layout. The goal: replace Vim-inherited
conventions with ergonomically optimal keybindings based on command frequency, finger reach,
and spatial logic.

## Problem

The "optimized" preset was a near-clone of the Vim preset — HJKL scrolling, `gg`/`G` for
page extremes, `gt`/`gT` for tab switching, `'` (quote) for jump-to-mark. For users who
chose "Home Row" specifically to avoid Vim conventions, this wasn't optimized at all.

## Key Position Ergonomics

Comfort ranking by effort (QWERTY, standard touch typing):

1. **Home row, strong fingers** — J (right index), K (right middle), D (left middle), F (left index): zero movement, strong muscles
2. **Home row, weaker fingers** — S (left ring), L (right ring), A (left pinky), ; (right pinky): zero movement, weaker
3. **Index reach keys** — G, H: short lateral reach from home position
4. **Top row, strong fingers** — E, R, U, I: short upward reach
5. **Bottom row** — Z, X, N, M, etc.: downward reach, less comfortable
6. **Far top row** — Q, W, O, P: longer reach, weakest positions

## Command Frequency Analysis

Based on typical browsing sessions:

| Frequency | Commands |
|-----------|----------|
| Very high | activateHints, scrollDown, scrollUp |
| High | scrollHalfPageDown, scrollHalfPageUp, closeTab, goBack |
| Medium | createTab, goForward, multiOpen, yankLink, tabNext, tabPrev |
| Low | scrollToTop, scrollToBottom, tabLeft, tabRight, pageRefresh, openTabSearch |
| Rare | scrollLeft, scrollRight, focusInput, goUpUrl, showHelp, marks |

## Design Decisions

### Scroll: J/K kept (lines 1-2 of the comfort list)
J=down, K=up — these were already optimal. Right hand home row, strongest fingers.
H=left, L=right — kept for spatial consistency, even though horizontal scroll is rare.

### Half-page scroll: D/E replaces D/U
- **D** = scrollHalfPageDown: home row left middle, D-for-Down mnemonic. Unchanged.
- **E** = scrollHalfPageUp: **directly above D on the keyboard**. The spatial metaphor
  (E is physically above D → "up") makes this immediately learnable. Previously `U`, which
  is on the right hand, far from D — no spatial relationship.
- Rejected alternative: **S** for half-page-up. Home row (great ergonomics) but S means
  "down" in WASD gaming convention — potentially confusing in a "no Vim knowledge needed" preset.

### Page extremes: Shift+J / Shift+K replaces gg / Shift+G
- **Shift+J** = scrollToBottom: J is already "down", Shift intensifies to "all the way down".
- **Shift+K** = scrollToTop: K is already "up", Shift intensifies to "all the way up".
- This eliminates the two-key `gg` sequence (a pure Vim-ism) and the arbitrary `G` key.
  The Shift modifier creates a consistent system: base key = incremental, Shift = extreme.

### Tab switching: N/P replaces gt/gT
- **N** = tabNext: N-for-Next. Single keypress replaces a two-key sequence.
- **P** = tabPrev: P-for-Previous. Same improvement.
- `gt`/`gT` required knowing that `g` is a prefix key — a Vim concept with no intrinsic logic.
  N/P are self-documenting.

### Tab reorder: < / > replaces Shift+J / Shift+K
- **<** (Shift+Comma) = tabLeft: universal "left arrow" symbol.
- **>** (Shift+Period) = tabRight: universal "right arrow" symbol.
- Previously Shift+J/K, which conflicted with the new page-extreme bindings and had no
  mnemonic value for "move tab".

### Jump-to-mark: ; replaces '
- **;** (Semicolon) = jumpMark: right pinky, **on the home row**. Zero finger movement.
- Previously `'` (Quote): right pinky reaching to the right of semicolon — further from
  home position. On non-US keyboard layouts, quote is often in an even more awkward position.
- M (setMark) stays unchanged — it was already reasonable.

### Marks moved out of SHARED bindings
Mark bindings (setMark and jumpMark) were previously in the SHARED array used by both
optimized and vim presets. Since the optimized preset now uses `;` instead of `'` for
jumpMark, marks are defined per-preset. Vim retains `M` / `'` (conventional).

## Complete Optimized Layout

| Key | Command | Category | Reasoning |
|-----|---------|----------|-----------|
| F | activateHints | hints | Left index, home row — best key for most-used command |
| B | multiOpen | hints | Left index, bottom row — medium frequency |
| Y | yankLink | hints | Right index, top row — medium frequency |
| J | scrollDown | scroll | Right index, home row — very high frequency |
| K | scrollUp | scroll | Right middle, home row — very high frequency |
| H | scrollLeft | scroll | Right index reach — spatial "left" |
| L | scrollRight | scroll | Right ring, home row — spatial "right" |
| D | scrollHalfPageDown | page | Left middle, home row — D for Down |
| E | scrollHalfPageUp | page | Left middle, top row — above D = spatial "up" |
| Shift+J | scrollToBottom | page | J=down, Shift=extreme |
| Shift+K | scrollToTop | page | K=up, Shift=extreme |
| Shift+H | goBack | actions | H=left → navigate "back" |
| Shift+L | goForward | actions | L=right → navigate "forward" |
| R | pageRefresh | actions | R for Refresh |
| T | createTab | tabs | T for Tab |
| Shift+T | openTabSearch | tabs | Shift+T extends Tab |
| X | closeTab | tabs | X for close (cross) |
| Shift+X | restoreTab | tabs | Shift reverses X |
| N | tabNext | tabs | N for Next |
| P | tabPrev | tabs | P for Previous |
| < | tabLeft | tabs | < for move left |
| > | tabRight | tabs | > for move right |
| [ | tabHistoryBack | tabs | [ for back |
| ] | tabHistoryForward | tabs | ] for forward |
| M | setMark | marks | M for Mark |
| ; | jumpMark | marks | Home row right pinky — easy reach |
| gi | focusInput | actions | g-prefix for "go to input" |
| gu | goUpUrl | actions | g-prefix for "go up" |
| ? | showHelp | actions | Universal help convention |

## What Changed from the Old Layout

| Binding | Old | New | Why |
|---------|-----|-----|-----|
| scrollHalfPageUp | U | E | Spatial: E is above D on keyboard |
| scrollToTop | gg | Shift+K | Single key; K=up, Shift=extreme |
| scrollToBottom | Shift+G | Shift+J | Consistent; J=down, Shift=extreme |
| tabNext | gt | N | Single key; N=Next mnemonic |
| tabPrev | gT | P | Single key; P=Previous mnemonic |
| tabLeft | Shift+J | < | Freed Shift+J for scrollToBottom |
| tabRight | Shift+K | > | Freed Shift+K for scrollToTop |
| jumpMark | ' | ; | Home row vs. off-home-row reach |
