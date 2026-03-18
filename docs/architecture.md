# HintMode: Element Detection & Positioning

The hint system discovers clickable elements, computes their visual position, and renders labeled tags. Each step has edge cases learned from real-world sites:

## Element discovery (`CLICKABLE_SELECTOR` + `_isInteractive`)

- **`label[for]`** — Labels with `for` attributes are interactive (trigger their associated input). Required for CSS checkbox hack menus where the visible "button" is actually a `<label>`, not an `<a>` or `<button>`.
- **`inert` subtrees** — Elements inside an `[inert]` ancestor are non-interactive. Common in hidden flyout trays (e.g. Apple's nav uses `<div inert="true">` on collapsed menu content).
- **`aria-hidden` checked on element only** — Not on ancestors, because `aria-hidden` hides from the accessibility tree but doesn't prevent visual interaction. A label inside an `aria-hidden` div is still clickable.

## Visibility (`_isVisible`)

- **`elementsFromPoint()` (plural, not singular)** — Sites often layer transparent anchor overlays on top of visible labels/buttons (CSS checkbox hack pattern). `elementFromPoint()` only returns the topmost element, incorrectly filtering out the visible control underneath. `elementsFromPoint()` returns the full stack, detecting elements behind overlays.
- **Overflow clipping** — Walk ancestor chain checking `overflow: hidden/clip` to filter elements clipped by their container.
- **Zero-size anchors** — Anchors with `display: contents` have zero-size bounding rects. Fall back to first visible child's rect.
- **Hidden radio/checkbox inputs** — Custom-styled inputs (opacity: 0 or size: 0) redirect to their associated `<label>` for both visibility and positioning.

## Hint positioning (`_getHintRect`)

- **`getClientRects()` for inline anchors** — `getBoundingClientRect()` on inline `<a>` elements spanning multiple lines returns an inflated rect covering all lines. `getClientRects()` returns per-line-box rects — use the first visible one.
- **Wide element heuristic (>25% viewport)** — Large clickable containers (cards, hero banners) get their hint anchored on a child landmark (heading, button, icon, chevron) rather than the top-left corner.

## Deduplication (`_discoverElements`)

- **Ancestor removal** — When both a container and its descendant are candidates, remove the container (the descendant is the real target).
- **Label/input dedup** — When both a `<label for="X">` and `<input id="X">` are candidates, keep only the input (its hint already uses the label's position via `_findAssociatedLabel`).
- **Hash-link/label dedup** — CSS checkbox hacks use both `<a href="#X">` and `<label for="X">` to control the same toggle. When the label is a candidate, remove the hash-link anchor. The anchor is typically a wide overlay with screen-reader-only text, producing a mispositioned hint; the label has the correct visual position.
- **Disclosure trigger dedup** — WAI-ARIA disclosure buttons (`[aria-expanded][aria-controls]`) are hover-activated submenu triggers that are visually hidden but have DOM dimensions. When a sibling candidate exists in the same parent, remove the disclosure button (the sibling link is the real target). Preserves lone disclosure buttons (accordion headers) where the toggle IS the primary interaction.

## Overlay & positioning strategy

- **`position: absolute` on `document.documentElement`** — Hints use absolute positioning with document-relative coordinates (viewport rect + scroll offset), matching Tabi's approach. Avoids breakage when ancestors of `<body>` have `transform`, `will-change`, `filter`, or `contain` properties, which create new containing blocks that shift `position: fixed` elements.
