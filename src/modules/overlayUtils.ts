// Shared helpers for modal overlays (TabSearch, HelpOverlay).

/**
 * Remove a modal overlay from the DOM without triggering a scroll jump.
 *
 * When a focused element inside the overlay is removed, the browser
 * implicitly moves focus to <body> and may scroll to the top. Moving
 * focus explicitly with `preventScroll` before removal avoids this.
 */
export function removeOverlay(overlay: HTMLElement): void {
  document.body.focus({ preventScroll: true });
  if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
}
