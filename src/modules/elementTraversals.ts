// Shared DOM traversal helpers — functions that find or navigate to
// a different element. Used by both ElementGatherer and HintMode.

import { HEADING_SELECTOR } from "./constants";

/** Find the label associated with a form control (via for= or ancestor <label>). */
export function findAssociatedLabel(el: HTMLElement): HTMLElement | null {
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return label as HTMLElement;
  }
  const parent = el.closest("label");
  if (parent) return parent as HTMLElement;
  return null;
}

/** Return the first child with non-zero dimensions, or null. */
export function findVisibleChild(el: HTMLElement): HTMLElement | null {
  for (const child of el.children) {
    const cr = (child as HTMLElement).getBoundingClientRect();
    if (cr.width > 0 && cr.height > 0) return child as HTMLElement;
  }
  return null;
}

/** Return the first heading descendant (h1–h6), or null. */
export function getHeading(el: HTMLElement): HTMLElement | null {
  return el.querySelector(HEADING_SELECTOR) as HTMLElement | null;
}
