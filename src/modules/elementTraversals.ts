// Shared DOM traversal helpers — functions that find or navigate to
// a different element. Used by both ElementGatherer and HintMode.

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
