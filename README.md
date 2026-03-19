# Tabi

Browse the web without a mouse. Press a key, every clickable thing on the page gets a label — type the label, it clicks. That's the core of it.

This is a Safari extension written from scratch, not a port. It takes the ideas behind [Vimium](https://github.com/philc/vimium) and rebuilds them as a native macOS app with a few tricks up its sleeve.

## What it looks like

Press `f` and every link, button, and input on the page lights up with a short label. Type the letters and it clicks. Press `Escape` to cancel. That's hint mode — the thing you'll use most.

The rest is keyboard shortcuts for things you'd normally reach for the mouse: scrolling, switching tabs, going back, finding text. If you've never used Vim, don't worry — you'll pick up `j`/`k` for scrolling and `f` for clicking in about ten seconds, and the rest is gravy.

## What's different

Most Vim-style browser extensions share similar DNA. This one was built from the ground up for Safari on macOS, and the hint system in particular goes further than most:

**Hints that actually work on modern sites.** The web is full of weird DOM tricks — transparent overlays on top of checkboxes, labels that are siblings of hidden inputs, containers that swallow clicks, icons next to text in buttons. The hint engine handles all of this. It walks the DOM looking for genuinely clickable things, deduplicates when a label and its input both appear, detects elements hidden by `overflow: hidden` or covered by overlays, and filters out things you can't actually interact with. The result: you get one hint per clickable thing, in the right place.

**Smooth scrolling from the first frame.** Hold `j` and the page scrolls — not in lurchy OS key-repeat steps, but in a smooth animation loop that starts immediately and decelerates naturally when you let go. It's velocity-based, not repeat-based, so it feels like a trackpad.

**Bar-style hints for containers.** When a clickable area is a wide block (a card, a row, a nav item), you get a subtle horizontal bar along with the pill label. It makes it easy to see what the hint covers without obscuring content.

**Home-row hint labels.** The hint alphabet (`s`, `a`, `d`, `g`, `j`, `k`, `l`, `e`, `w`, `c`, `m`, `p`, `o`, `h`) is weighted toward the home row, so you can type hints without reaching.

**Dark mode, automatically.** The extension reads the page's background luminance and picks a contrasting hint theme, so labels stay readable on any page.

## Keybindings

You don't need to know Vim. Here's what each key does:

| Key | What it does |
|-----|-------------|
| `f` | Show hint labels — type one to click it |
| `F` | Same, but opens in a new tab |
| `j` / `k` | Scroll down / up |
| `d` / `u` | Scroll down / up by half a page |
| `h` / `l` | Scroll left / right |
| `G` / `g g` | Jump to bottom / top of page |
| `H` / `L` | Go back / forward in history |
| `/` | Find text on the page |
| `n` / `N` | Next / previous match |
| `T` | Search your open tabs |
| `t` | New tab |
| `x` | Close this tab |
| `X` | Reopen the last closed tab |
| `J` / `K` | Previous / next tab |
| `g 0` / `g $` | First / last tab |
| `g i` | Focus the first text input on the page |
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
npm run build    # compile TypeScript with esbuild
npm test         # run tests (node --test, happy-dom for DOM)
```

## License

MIT
