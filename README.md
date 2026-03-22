# Tabi

Browse the web without a mouse. Press a key, every clickable thing on the page gets a label — type the label, it clicks. That's the core of it.

This is a Safari extension written from scratch, not a port. It takes the ideas behind [Vimium](https://github.com/philc/vimium) and rebuilds them as a native macOS app with a few tricks up its sleeve.

## What it looks like

Press `f` and every link, button, and input on the page lights up with a short label. Type the letters and it clicks. Hold `Shift` while typing a hint to open the link in a new tab. Press `Escape` to cancel. That's hint mode — the thing you'll use most.

The rest is keyboard shortcuts for things you'd normally reach for the mouse: scrolling, switching tabs, going back, finding text. If you've never used Vim, don't worry — you'll pick up `j`/`k` for scrolling and `f` for clicking in about ten seconds, and the rest is gravy.

## Features

### Hint mode

**Hints that actually work on modern sites.** The web is full of weird DOM tricks — transparent overlays on top of checkboxes, labels that are siblings of hidden inputs, containers that swallow clicks, icons next to text in buttons. The hint engine handles all of this. It walks the DOM looking for genuinely clickable things, deduplicates when a label and its input both appear, detects elements hidden by `overflow: hidden` or covered by overlays, and filters out things you can't actually interact with. The result: you get one hint per clickable thing, in the right place.

**Bar-style hints for containers.** When a clickable area is a wide block (a card, a row, a nav item), you get a subtle horizontal bar along with the pill label. It makes it easy to see what the hint covers without obscuring content.

**Home-row hint labels.** The hint alphabet is weighted toward the home row, so you can type hints without reaching.

**Dark mode, automatically.** The extension reads the page's background luminance and picks a contrasting hint theme, so labels stay readable on any page.

### Scrolling

**Smooth scrolling from the first frame.** Hold `j` and the page scrolls — not in lurchy OS key-repeat steps, but in a smooth animation loop that starts immediately and decelerates naturally when you let go. It's velocity-based, not repeat-based, so it feels like a trackpad.

### Multi-hint and yank

**Batch-open links.** Press `b` to enter multi-hint mode — select several links, then open them all in new tabs at once.

**Copy any link URL.** Press `y` to enter yank mode — type a hint label and the link URL is copied to your clipboard without navigating to it.

### Quick marks

**Vim-style bookmarks.** Press `m` then a letter (`a`–`z`) to save your current position. Press `'` then that letter to jump back — if the page is already open, it switches to that tab and restores scroll position; otherwise it opens a new tab.

### Tab search

**Fuzzy tab search.** Press `T` to open an overlay that searches across all your open tabs. Type to filter, arrow keys to navigate, Enter to switch. Premium unlocks fzf-style fuzzy matching with contiguous bonuses; free mode uses prefix/substring matching.

### Keyboard layouts

Four layout presets to match how you work:

- **Home Row** — the default, designed around the home row with no Vim knowledge needed.
- **Vim** — classic Vim-style keybindings for users who already know the motions.
- **Left Hand** — all shortcuts on the left side of the keyboard. Browse one-handed. *(Premium)*
- **Right Hand** — all shortcuts on the right side of the keyboard. *(Premium)*

Layouts are switchable in Settings. You can also choose between location-based (layout-independent, like Vim) and character-based key mapping for international keyboards.

### Statistics

Track your hint usage with fun milestones — how many hints you've typed, estimated time saved, estimated mouse distance avoided. *(Premium)*

## Keybindings

Default layout (Home Row). Press `?` in any tab to see the full list.

| Key | What it does |
|-----|-------------|
| `f` | Show hint labels — type one to click it (hold Shift to open in new tab) |
| `b` | Batch-open links in new tabs (multi-hint mode) |
| `y` | Copy link URL to clipboard (yank mode) |
| `j` / `k` | Scroll down / up |
| `d` / `u` | Scroll down / up by half a page |
| `h` / `l` | Scroll left / right |
| `G` / `g g` | Jump to bottom / top of page |
| `H` / `L` | Go back / forward in history |
| `T` | Search your open tabs |
| `t` | New tab |
| `x` | Close this tab |
| `X` | Reopen the last closed tab |
| `J` / `K` | Previous / next tab |
| `g t` / `g T` | Next / previous tab |
| `g i` | Focus the first text input on the page |
| `g u` | Go up one URL level |
| `m` + `a`–`z` | Set a quick mark |
| `'` + `a`–`z` | Jump to a quick mark |
| `r` | Reload |
| `?` | Show all keybindings |
| `Escape` | Back to normal |

## Install

### From source

Requires macOS 13+ and Xcode 16.3+.

```bash
git clone https://github.com/anthropics/tabi.git
cd tabi

brew install xcodegen   # if needed
xcodegen generate
```

Open `Tabi.xcodeproj` in Xcode, hit Run (Cmd+R), then enable the extension in Safari → Settings → Extensions.

## Development

```
Tabi/
├── Host App/              # macOS app shell (SwiftUI)
└── Safari Extension/
    └── Resources/
        ├── modules/       # TypeScript — KeyHandler, HintMode, ScrollController, etc.
        ├── styles/        # Hint, theme, tab search, and help CSS
        ├── background.js  # Service worker for tab management
        ├── content.js     # Content script entry point
        └── manifest.json  # Web Extension manifest v3
```

```bash
npm run build              # compile TypeScript with esbuild
npm test                   # unit tests (node --test, happy-dom for DOM)
npm run test:integration   # Playwright WebKit layout tests
npm run safari             # full pipeline: build → xcodegen → xcodebuild → restart Safari
```

### Testing

Three tiers, cheapest first:

1. **Unit tests** (`npm test`) — predicates, element selection, dedup logic. Uses happy-dom. ~1 second.
2. **Integration tests** (`npm run test:integration`) — viewport clipping, overflow, hint positioning. Uses Playwright with real WebKit. ~5 seconds.
3. **Safari** (`npm run safari`) — extension messaging, Safari-specific quirks, final manual verification.

### Issue tracking

Issues are tracked with [Beads](https://github.com/steveyegge/beads), a Dolt-powered graph issue tracker designed for AI agent workflows. Run `bd prime` for workflow context, `bd ready` to see what's next, and `bd create` to file new issues. See the Beads docs for setup.

### Architecture

The hint pipeline is built on **composable stateless predicates** — small exported functions in `elementPredicates.ts` that each answer one question about a DOM element ("is it visible?", "is it in a repeating container?", "does it contain a heading?"). Orchestrators like `ElementGatherer` and `HintMode` compose these predicates to decide what gets a hint. This keeps the pipeline readable and each predicate independently testable.

Element discovery uses only **semantic signals**: native interactive elements (`<a>`, `<button>`, `<input>`, etc.), ARIA roles (`role="button"`, `role="link"`, etc.), and event handlers (`onclick`). We intentionally skip `cursor:pointer` and `tabindex` — both produce more false positives than true positives on modern sites.

## License

MIT
