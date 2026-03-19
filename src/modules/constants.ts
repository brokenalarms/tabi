// Shared element classification constants for the hint pipeline.

// Native interactive HTML elements — discovered by the walker.
export const NATIVE_INTERACTIVE_ELEMENTS = ["a", "button", "input", "textarea", "select", "summary"];

// Embedded content elements — render external resources, never empty.
export const EMBEDDED_CONTENT_ELEMENTS = new Set(["iframe", "object", "embed"]);

const CLICKABLE_ROLES = ["button", "link", "tab", "menuitem", "option", "checkbox", "radio", "switch", "treeitem"];
const CLICKABLE_ATTRS = ["label[for]", "[onclick]", "[onmousedown]"];

/** Tags that act as list boundaries — items on different sides are
 *  at different tree levels for dedup and glow purposes. */
export const LIST_BOUNDARY_TAGS = new Set(["UL", "OL", "TABLE"]);
export const LIST_BOUNDARY_SELECTOR = Array.from(LIST_BOUNDARY_TAGS).join(", ").toLowerCase();

export const CLICKABLE_SELECTOR = [
  ...NATIVE_INTERACTIVE_ELEMENTS,
  ...CLICKABLE_ROLES.map(r => `[role='${r}']`),
  ...CLICKABLE_ATTRS,
].join(", ");

/** Site-specific custom elements that act as repeating containers.
 *  Each entry maps a CSS selector to the site where it was observed. */
const SITE_SPECIFIC_CONTAINERS: { selector: string; site: string }[] = [
  { selector: "ytd-grid-video-renderer", site: "youtube.com" },
];

export const REPEATING_CONTAINER_SELECTOR = [
  "li", "tr",
  ...SITE_SPECIFIC_CONTAINERS.map(c => c.selector),
].join(", ");

export const HEADING_ELEMENTS = ["h1", "h2", "h3", "h4", "h5", "h6"];
export const HEADING_SELECTOR = HEADING_ELEMENTS.join(", ");

export const MINIMUM_CONTAINER_WIDTH = 100;
export const MINIMUM_CONTAINER_HEIGHT = 32;

// Hint label outer height, matching hints.css:
// 12px font × 1.2 line-height + 2 × 1px padding + 2 × 1px border
const HINT_FONT_SIZE = 12;
const HINT_LINE_HEIGHT = 1.2;
const HINT_PADDING_Y = 1;
const HINT_BORDER_WIDTH = 1;
export const HINT_HEIGHT =
  HINT_FONT_SIZE * HINT_LINE_HEIGHT + 2 * HINT_PADDING_Y + 2 * HINT_BORDER_WIDTH;

