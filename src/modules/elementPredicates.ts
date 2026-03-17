// Stateless element predicates — each answers one question about an element.
// Used by walkerFilter (ElementGatherer) and hint positioning (HintMode).

import { HEADING_SELECTOR, REPEATING_CONTAINER_SELECTOR, MINIMUM_CONTAINER_HEIGHT, MINIMUM_CONTAINER_WIDTH } from "./constants";

// --- Visibility & geometry ---

/** Is this rect non-zero and within the viewport? */
export function isOnScreen(rect: DOMRect): boolean {
  if (rect.width === 0 || rect.height === 0) return false;
  if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
  if (rect.right < 0 || rect.left > window.innerWidth) return false;
  return true;
}

/** Can children of this element still be visible?
 *  display:none is the only CSS property that irrecoverably hides all descendants.
 *  visibility:hidden and opacity:0 can be overridden by children. */
export function childrenCannotBeVisible(el: HTMLElement): boolean {
  return getComputedStyle(el).display === "none";
}

/** Stateless visibility check — does this element have a non-zero, on-screen,
 *  non-hidden rect? No clickability or occlusion logic — just geometry + CSS.
 *  Accepts an optional pre-computed rect (e.g. fallback rect for zero-size anchors). */
export function isVisible(el: HTMLElement, rect?: DOMRect): boolean {
  const r = rect ?? el.getBoundingClientRect();
  if (!isOnScreen(r)) return false;
  const style = getComputedStyle(el);
  if (style.display === "none") return false;
  if (style.visibility === "hidden") return false;
  if (parseFloat(style.opacity) === 0) return false;
  return true;
}

/** Does this element generate a CSS box?
 *  display:none and display:contents don't — overflow, sizing, and clipping
 *  properties have no effect on boxless elements. */
export function hasBox(el: HTMLElement): boolean {
  const display = getComputedStyle(el).display;
  return display !== "none" && display !== "contents";
}

// --- Intent & removal ---

/** Is this element in a subtree removed from the interaction tree?
 *  aria-hidden and inert cascade — any ancestor declaring these removes the
 *  entire subtree. The walker already REJECTs at the ancestor, so descendants
 *  are never visited. This predicate exists for elements found via
 *  elementsFromPoint (hit-testing bypasses the walker). */
export function isSubtreeRemoved(el: HTMLElement): boolean {
  if (el.closest("[aria-hidden='true']")) return true;
  if (el.closest("[inert]")) return true;
  return false;
}

/** Excluded by developer intent: subtree removal (aria-hidden, inert),
 *  element-level hidden attribute, or disabled state. */
export function isExcludedByIntent(el: HTMLElement): boolean {
  if (isSubtreeRemoved(el)) return true;
  if (el.hidden) return true;
  if ((el as HTMLButtonElement).disabled) return true;
  return false;
}

// --- Overflow & occlusion ---

/** Is this element clipped to an unusable size by an overflow ancestor?
 *  Checks overflowX/overflowY per axis — any value that isn't "visible" clips.
 *  Skips ancestors that have no box (display:contents/none) — overflow only
 *  applies to elements that generate a box. Rejects elements whose visible area
 *  within the clipping ancestor is too small to be a useful click target (< 4px). */
export function isClippedByOverflow(el: HTMLElement, rect: DOMRect): boolean {
  let ancestor = el.parentElement;
  while (ancestor && ancestor !== document.body) {
    if (hasBox(ancestor)) {
      const ancestorStyle = getComputedStyle(ancestor);
      const overflow = ancestorStyle.overflow;
      const ox = ancestorStyle.overflowX || overflow;
      const oy = ancestorStyle.overflowY || overflow;
      const clipsX = ox !== "" && ox !== "visible";
      const clipsY = oy !== "" && oy !== "visible";
      if (clipsX || clipsY) {
        const ar = ancestor.getBoundingClientRect();
        const visibleW = clipsX ? Math.max(0, Math.min(rect.right, ar.right) - Math.max(rect.left, ar.left)) : rect.width;
        const visibleH = clipsY ? Math.max(0, Math.min(rect.bottom, ar.bottom) - Math.max(rect.top, ar.top)) : rect.height;
        if (visibleW < 4 || visibleH < 4) return true;
      }
    }
    ancestor = ancestor.parentElement;
  }
  return false;
}

/** Does the ancestor contain the descendant in the composed tree?
 *  Like Node.contains(), but walks up through shadow root boundaries
 *  so shadow hosts are recognized as ancestors of their shadow DOM content. */
export function composedContains(ancestor: Node, descendant: Node): boolean {
  let node: Node | null = descendant;
  while (node) {
    if (node === ancestor) return true;
    const root = node.getRootNode();
    if (root !== node && root !== document && (root as any).host) {
      node = (root as any).host;
    } else {
      node = node.parentNode;
    }
  }
  return false;
}

/** Is this element occluded at any corner by an unrelated element?
 *  Tests all 4 corners (+2px inset) via elementsFromPoint. If ANY corner's
 *  topmost element is an unrelated, non-exempt cover, the element is occluded.
 *  Covers that are ancestors/descendants, in removed subtrees, or contentless
 *  overlays are exempt — they won't steal clicks or get their own hints. */
export function isOccluded(el: HTMLElement, rect: DOMRect): boolean {
  const clampX = (x: number) => Math.min(Math.max(x, 0), window.innerWidth - 1);
  const clampY = (y: number) => Math.min(Math.max(y, 0), window.innerHeight - 1);

  const isCover = (cover: HTMLElement): boolean => {
    if (composedContains(el, cover) || composedContains(cover, el)) return false;
    if (isSubtreeRemoved(cover)) return false;
    if (isContentlessOverlay(cover)) return false;
    if (isSiblingInRepeatingContainer(el, cover)) return false;
    if (isInSameLabel(el, cover)) return false;
    return true;
  };

  // Check all 4 corners but require at least one BOTTOM corner to be covered.
  // Top-only coverage (e.g. a thin loading bar or header border overlapping the
  // top edge) doesn't block interaction — the element is still clickable below.
  const corners: [number, number, boolean][] = [
    [rect.left + 2, rect.top + 2, false],
    [rect.right - 2, rect.top + 2, false],
    [rect.left + 2, rect.bottom - 2, true],
    [rect.right - 2, rect.bottom - 2, true],
  ];

  for (const [x, y, isBottom] of corners) {
    const hits = document.elementsFromPoint(clampX(x), clampY(y));
    if (hits.length > 0 && isCover(hits[0] as HTMLElement)) {
      if (isBottom) return true;
    }
  }
  return false;
}

/** Are both elements inside the same <label>?
 *  Elements under the same label are part of the same form control —
 *  decorative siblings (SVG checkbox icons, custom radio visuals) are not
 *  real occluders of the underlying input. */
export function isInSameLabel(a: HTMLElement, b: HTMLElement): boolean {
  const label = a.closest("label");
  return label !== null && label.contains(b);
}

/** Are these two elements in sibling repeating containers (different <li>/<tr>
 *  sharing the same parent, or sibling <a> links)? Adjacent items' overflowing
 *  content is not a real occluder — it's just sibling bleed from the same list. */
export function isSiblingInRepeatingContainer(a: HTMLElement, b: HTMLElement): boolean {
  const aItem = getRepeatingContainer(a);
  const bItem = getRepeatingContainer(b);
  return aItem !== null && bItem !== null &&
         aItem !== bItem &&
         aItem.parentElement === bItem.parentElement;
}

/** Is this element a contentless overlay that can't visually block anything?
 *  True for elements with no text and no visual children (img, svg, etc.).
 *  Covers stretched-link card overlays, custom scrollbar tracks, and hover
 *  effect layers — anything with no visible DOM content is transparent to
 *  the user regardless of tag or role. */
export function isContentlessOverlay(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "iframe" || tag === "object" || tag === "embed") return false;
  if ((el.textContent || "").trim()) return false;
  if (el.querySelector("img, svg, picture, video, canvas")) return false;
  return true;
}

// --- Element characteristics ---

/** Does this element generate a block-level box?
 *  Unknown display values default to true — a block box can contain visible
 *  children even if the element itself has zero dimensions, so it's safer to
 *  over-count than to miss one.  Only inline and boxless values return false. */
export function isBlockLevel(el: HTMLElement): boolean {
  if (!hasBox(el)) return false;
  const display = getComputedStyle(el).display;
  return display !== "" && !display.startsWith("inline");
}

/** Minimum number of same-tag sibling <a> elements to count as a repeating
 *  pattern (e.g. Twitter/X nav uses flat sibling links instead of <li>). */
const MINIMUM_SIBLING_LINKS = 3;

/** Return the nearest repeating container (li, tr, or sibling <a>) that
 *  generates a box, or null if the element is not in one.
 *  For sibling <a> links (3+ under the same parent), the <a> itself is
 *  the repeating container — there's no wrapping <li>. */
export function getRepeatingContainer(el: HTMLElement): HTMLElement | null {
  const container = el.closest(REPEATING_CONTAINER_SELECTOR) as HTMLElement | null;
  if (container !== null && hasBox(container)) return container;
  if (el.tagName === "A" && el.parentElement !== null) {
    const siblings = el.parentElement.children;
    let count = 0;
    for (let i = 0; i < siblings.length; i++) {
      if (siblings[i].tagName === "A") count++;
      if (count >= MINIMUM_SIBLING_LINKS) return el;
    }
  }
  return null;
}

/** Is this element inside a repeating container (list item, table row, or
 *  sibling link group)? Elements in repeating containers are part of a flowing
 *  layout where hints should stay aligned.
 *  Only counts ancestors that have a box — a display:contents <li> isn't a
 *  real container and shouldn't affect hint positioning. */
export function isInRepeatingContainer(el: HTMLElement): boolean {
  return getRepeatingContainer(el) !== null;
}

/** Is this element large and rectangular enough for container-style hint placement?
 *  Checks minimum width, aspect ratio or viewport fraction, and box generation. */
export function isContainerSized(el: HTMLElement, rect: DOMRect): boolean {
  if (!hasBox(el)) return false;
  if (rect.width <= MINIMUM_CONTAINER_WIDTH) return false;
  if (rect.height < MINIMUM_CONTAINER_HEIGHT) return false;
  const isRectangular = rect.width / (rect.height || 1) >= 1.5;
  const isLarge = rect.width > window.innerWidth * 0.25;
  return isRectangular || isLarge;
}

/** Does this element contain a heading (h1–h6) as a descendant? */
export function hasHeadingContent(el: HTMLElement): boolean {
  return el.querySelector(HEADING_SELECTOR) !== null;
}

// --- SPA framework event delegation ---

/** Does this element have a jsaction attribute declaring a click handler?
 *  Google's Closure Library uses jsaction="click:handlerName" for event delegation.
 *  This is the SPA equivalent of onclick — an explicit click handler in the DOM. */
export function hasJsactionClick(el: HTMLElement): boolean {
  const jsaction = el.getAttribute("jsaction");
  if (jsaction === null) return false;
  return /(^|;\s*)click:/.test(jsaction);
}

// --- Hint target redirect predicates ---

/** Is this a radio or checkbox input whose hint should redirect to its label? */
export function isRedirectableControl(el: HTMLElement): boolean {
  if (el.tagName.toLowerCase() !== "input") return false;
  const type = ((el as HTMLInputElement).type || "").toLowerCase();
  return type === "radio" || type === "checkbox";
}

/** Is this an anchor with zero dimensions whose hint should redirect to a visible child? */
export function isZeroSizeAnchor(el: HTMLElement, rect: DOMRect): boolean {
  return el.tagName.toLowerCase() === "a" && rect.width === 0 && rect.height === 0;
}

/** Is this an <a href="#id"> that points to a label's associated input?
 *  These anchors duplicate the label's click target and should be deduped. */
export function isAnchorToLabelTarget(el: HTMLElement, labelForIds: Set<string>): boolean {
  if (el.tagName.toLowerCase() !== "a") return false;
  const href = el.getAttribute("href");
  return href !== null && href.charAt(0) === "#" && labelForIds.has(href.slice(1));
}

/** Should this element's hint redirect to its heading descendant?
 *  True for any <a> with a heading inside it, unless it has a repeating
 *  container ancestor, which uses container glow instead.
 *  Positions the hint on the heading text rather than the link's full extent. */
export function shouldRedirectToHeading(el: HTMLElement): boolean {
  return el.tagName.toLowerCase() === "a" &&
    hasHeadingContent(el) && !isInRepeatingContainer(el);
}