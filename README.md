# Vimium for Safari

A Safari Web Extension that brings Vim-style keyboard navigation to macOS. Navigate the web without touching your mouse.

## Why

A modern reimplementation of [Vimium](https://github.com/philc/vimium) built from scratch as a native macOS app with an embedded Safari Web Extension.

## Features

- **Keyboard navigation** — scroll, follow links, go back/forward, all from the keyboard
- **Link hints** — press `f` to label every link on the page, then type the hint to click it
- **Find mode** — in-page search with `/`
- **Tab search** — fuzzy-find open tabs with `T`
- **Tab management** — open, close, restore, and switch tabs with keybindings
- **Vim-style modes** — Normal, Insert, Hints, Find, and Tab Search modes with `Escape` to return to Normal

### Default Keybindings

| Key | Action |
|-----|--------|
| `j` / `k` | Scroll down / up |
| `d` / `u` | Half-page down / up |
| `G` / `g g` | Scroll to bottom / top |
| `h` / `l` | Scroll left / right |
| `H` / `L` | Go back / forward in history |
| `f` | Activate link hints |
| `/` | Find on page |
| `n` / `N` | Next / previous find match |
| `T` | Search open tabs |
| `t` | New tab |
| `x` | Close tab |
| `X` | Restore closed tab |
| `J` / `K` | Previous / next tab |
| `g 0` / `g $` | First / last tab |
| `Escape` | Return to Normal mode |

## Requirements

- macOS 13.0+
- Xcode 16.3+
- [XcodeGen](https://github.com/yonaskolb/XcodeGen)

## Setup

1. **Clone the repo**

   ```bash
   git clone https://github.com/anthropics/vimium-mac.git
   cd vimium-mac
   ```

2. **Generate the Xcode project**

   ```bash
   brew install xcodegen   # if you don't have it
   xcodegen generate
   ```

   This reads `project.yml` and produces `Vimium.xcodeproj`.

3. **Build and run**

   Open `Vimium.xcodeproj` in Xcode, select the **Vimium** target, and hit Run (Cmd+R).

4. **Enable the extension in Safari**

   - Open Safari → Settings → Extensions
   - Check the box next to **Vimium**
   - Grant permissions when prompted

## Project Structure

```
Vimium/
├── Host App/              # macOS host application (SwiftUI)
└── Safari Extension/
    ├── Resources/
    │   ├── modules/       # Feature modules (KeyHandler, HintMode, FindMode, etc.)
    │   ├── styles/        # CSS for hints, find bar, tab search
    │   ├── images/        # Extension icons
    │   ├── background.js  # Service worker for tab management
    │   ├── content.js     # Main content script, wires up all modules
    │   └── manifest.json  # Web Extension manifest (v3)
    └── SafariWebExtensionHandler.swift
```

## Running Tests

```bash
npm test
```
