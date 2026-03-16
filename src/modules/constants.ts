// Shared element classification constants for the hint pipeline.

// Native interactive elements — atomic controls at the lowest level of the DOM.
// The walker accepts these and prunes their subtrees: children are content/labels,
// not separate click targets. This prevents duplicate hints inside buttons, links, etc.
export const NATIVE_INTERACTIVE_ELEMENTS = ["a", "button", "input", "textarea", "select"];

const CLICKABLE_ROLES = ["button", "link", "tab", "menuitem", "option", "checkbox", "radio", "switch", "treeitem"];
const CLICKABLE_ATTRS = ["label[for]", "[onclick]", "[onmousedown]"];

export const CLICKABLE_SELECTOR = [
  ...NATIVE_INTERACTIVE_ELEMENTS,
  ...CLICKABLE_ROLES.map(r => `[role='${r}']`),
  ...CLICKABLE_ATTRS,
].join(", ");

export const REPEATING_CONTAINER_SELECTOR = "li, tr";

export const HEADING_ELEMENTS = ["h1", "h2", "h3", "h4", "h5", "h6"];
export const HEADING_SELECTOR = HEADING_ELEMENTS.join(", ");

export const MINIMUM_CONTAINER_WIDTH = 200;
export const MINIMUM_CONTAINER_HEIGHT= 64;

