// ElementGatherer — element discovery, filtering, and deduplication for hint mode.
// Uses TreeWalker with walkerFilter to prune hidden subtrees, skip
// non-clickable nodes, and yield visible clickable elements, then deduplicates
// via containment analysis.

// Native interactive elements — atomic controls at the lowest level of the DOM.
// The walker accepts these and prunes their subtrees: children are content/labels,
// not separate click targets. This prevents duplicate hints inside buttons, links, etc.
export const NATIVE_INTERACTIVE_ELEMENTS = ["a", "button", "input", "textarea", "select", "summary"];
const CLICKABLE_ROLES = ["button", "link", "tab", "menuitem", "option", "checkbox", "radio", "switch", "treeitem"];
const CLICKABLE_ATTRS = ["label[for]", "[tabindex]:not([tabindex='-1'])", "[onclick]", "[onmousedown]"];

export const CLICKABLE_SELECTOR = [
  ...NATIVE_INTERACTIVE_ELEMENTS,
  ...CLICKABLE_ROLES.map(r => `[role='${r}']`),
  ...CLICKABLE_ATTRS,
].join(", ");

// --- Declarative predicates (stateless) ---

/** Is this element in a subtree removed from the interaction tree?
 *  aria-hidden and inert cascade — any ancestor declaring these removes the
 *  entire subtree. The walker already REJECTs at the ancestor, so descendants
 *  are never visited. This predicate exists for elements found via
 *  elementsFromPoint (hit-testing bypasses the walker). */
function isSubtreeRemoved(el: HTMLElement): boolean {
  if (el.closest("[aria-hidden='true']")) return true;
  if (el.closest("[inert]")) return true;
  return false;
}

/** Excluded by developer intent: subtree removal (aria-hidden, inert),
 *  element-level hidden attribute, or disabled state. */
function isExcludedByIntent(el: HTMLElement): boolean {
  if (isSubtreeRemoved(el)) return true;
  if (el.hidden) return true;
  if ((el as HTMLButtonElement).disabled) return true;
  return false;
}

/** Is this rect non-zero and within the viewport? */
function isOnScreen(rect: DOMRect): boolean {
  if (rect.width === 0 || rect.height === 0) return false;
  if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
  if (rect.right < 0 || rect.left > window.innerWidth) return false;
  return true;
}

/** Can children of this element still be visible?
 *  display:none is the only CSS property that irrecoverably hides all descendants.
 *  visibility:hidden and opacity:0 can be overridden by children. */
function childrenMightBeVisible(el: HTMLElement): boolean {
  return getComputedStyle(el).display !== "none";
}

/** Stateless visibility check — does this element have a non-zero, on-screen,
 *  non-hidden rect? No clickability or occlusion logic — just geometry + CSS.
 *  Accepts an optional pre-computed rect (e.g. fallback rect for zero-size anchors). */
function isVisible(el: HTMLElement, rect?: DOMRect): boolean {
  const r = rect ?? el.getBoundingClientRect();
  if (!isOnScreen(r)) return false;
  const style = getComputedStyle(el);
  if (style.display === "none") return false;
  if (style.visibility === "hidden") return false;
  if (parseFloat(style.opacity) === 0) return false;
  return true;
}

/** Is this element fully outside a clipping overflow ancestor?
 *  Checks overflowX/overflowY per axis — any value that isn't "visible" clips. */
function isClippedByOverflow(el: HTMLElement, rect: DOMRect): boolean {
  let ancestor = el.parentElement;
  while (ancestor && ancestor !== document.body) {
    const ancestorStyle = getComputedStyle(ancestor);
    const overflow = ancestorStyle.overflow;
    const ox = ancestorStyle.overflowX || overflow;
    const oy = ancestorStyle.overflowY || overflow;
    const clipsX = ox !== "" && ox !== "visible";
    const clipsY = oy !== "" && oy !== "visible";
    if (clipsX || clipsY) {
      const ar = ancestor.getBoundingClientRect();
      if ((clipsX && (rect.right <= ar.left || rect.left >= ar.right)) ||
          (clipsY && (rect.bottom <= ar.top || rect.top >= ar.bottom))) {
        return true;
      }
    }
    ancestor = ancestor.parentElement;
  }
  return false;
}

/** Is this element visible and semantically interactive?
 *  Used by coveredByOverlay to decide if a cover is a real interactive element
 *  (which shouldn't block hints behind it) vs a non-interactive overlay (which should).
 *  Does NOT check cursor:pointer — visual style, not semantic interactivity. */
function isInteractive(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled) return false;
  if (!isVisible(el)) return false;
  return el.matches(CLICKABLE_SELECTOR);
}

// Roles that are always atomic — children are rendering details, never containers.
// "link" is excluded: div[role="link"] can be a card-style container (X.com trends).
const ATOMIC_ROLES = ["button", "tab", "menuitem", "option", "checkbox", "radio", "switch", "treeitem"];

/** Did this element declare a widget type that is always atomic?
 *  Used to gate container/bar hint style: atomic controls get pill hints,
 *  only generic clickable elements can be containers. */
export function isAtomicControl(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag !== "a" && NATIVE_INTERACTIVE_ELEMENTS.includes(tag)) return true;
  const role = el.getAttribute("role")?.toLowerCase() ?? "";
  return ATOMIC_ROLES.includes(role);
}

// --- Walker filter ---
// Routes to REJECT/SKIP/ACCEPT by calling predicates.
// FILTER_REJECT prunes entire subtrees (developer intent, display:none).
// FILTER_SKIP skips the node but walks children (invisible but children may differ).
// FILTER_ACCEPT yields the element.

export function walkerFilter(node: Node): number {
  const el = node as HTMLElement;

  // Developer intent or display:none — prune entire subtree
  if (isExcludedByIntent(el)) return NodeFilter.FILTER_REJECT;
  if (!childrenMightBeVisible(el)) return NodeFilter.FILTER_REJECT;

  // Visually-hidden pattern: clip/clip-path reducing visible area to zero
  // (e.g. "skip to content" links, sr-only elements)
  const style = getComputedStyle(el);
  const clipPath = style.clipPath || el.style.clipPath;
  if (clipPath && clipPath !== "none") {
    const m = clipPath.match(/inset\((\d+)%/);
    if (m && parseInt(m[1]) >= 50) return NodeFilter.FILTER_REJECT;
  }
  const clip = style.getPropertyValue("clip") || el.style.getPropertyValue("clip");
  if (clip && clip !== "auto") {
    const m = clip.match(/rect\(([^)]+)\)/);
    if (m) {
      const vals = m[1].split(/[,\s]+/).map(parseFloat).filter(v => !isNaN(v));
      if (vals.length >= 4 && (vals[2] - vals[0]) <= 1 && (vals[1] - vals[3]) <= 1) {
        return NodeFilter.FILTER_REJECT;
      }
    }
  }

  // Effective rect: anchor-child fallback for zero-size <a>,
  // label redirect for zero-size radio/checkbox
  let rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    let fallbackRect: DOMRect | null = null;
    if (el.tagName.toLowerCase() === "a") {
      for (const child of el.children) {
        const cr = (child as HTMLElement).getBoundingClientRect();
        if (cr.width > 0 && cr.height > 0) { fallbackRect = cr; break; }
      }
    } else if (el.tagName.toLowerCase() === "input") {
      const type = ((el as HTMLInputElement).type || "").toLowerCase();
      if (type === "radio" || type === "checkbox") {
        const label = findAssociatedLabel(el);
        if (label) {
          const lr = label.getBoundingClientRect();
          if (lr.width > 0 && lr.height > 0) fallbackRect = lr;
        }
      }
    }
    if (!fallbackRect) return NodeFilter.FILTER_SKIP;
    rect = fallbackRect;
  }

  // Outside viewport — SKIP so fixed/sticky children are still visited
  if (!isOnScreen(rect)) return NodeFilter.FILTER_SKIP;

  // Clickability check
  // cursor:pointer is checked here (not just CLICKABLE_SELECTOR) because many modern
  // SPAs make elements clickable via JS listeners (React onClick, Vue @click) without
  // adding ARIA roles or HTML attributes. cursor:pointer is their only discoverable signal.
  // It is NOT in isInteractive because that would let styled wrappers pass as interactive
  // covers in occlusion checks.
  if (!el.matches(CLICKABLE_SELECTOR) && style.cursor !== "pointer") return NodeFilter.FILTER_SKIP;

  // Opacity:0 radio/checkbox with visible label — redirect to label
  if (parseFloat(style.opacity) === 0) {
    if (el.tagName.toLowerCase() === "input") {
      const type = ((el as HTMLInputElement).type || "").toLowerCase();
      if (type === "radio" || type === "checkbox") {
        const label = findAssociatedLabel(el);
        if (label && isVisible(label)) return NodeFilter.FILTER_ACCEPT;
      }
    }
    return NodeFilter.FILTER_SKIP;
  }

  // visibility:hidden, remaining invisibility — children may override
  if (!isVisible(el, rect)) return NodeFilter.FILTER_SKIP;

  // Overflow clipping
  if (isClippedByOverflow(el, rect)) return NodeFilter.FILTER_SKIP;

  // Covered by another element (elementsFromPoint)
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const px = Math.min(Math.max(centerX, 0), window.innerWidth - 1);
  const py = Math.min(Math.max(centerY, 0), window.innerHeight - 1);

  /** Is the topmost element at a point a non-interactive overlay blocking this element?
   *  Containment (parent/child) and interactive covers (links, buttons) are fine.
   *  Covers in removed subtrees (aria-hidden, inert) are ignored — they won't get
   *  their own hint, so they shouldn't block hints on elements behind them. */
  const coveredByOverlay = (cover: HTMLElement): boolean => {
    if (el.contains(cover) || cover.contains(el)) return false;
    if (isSubtreeRemoved(cover)) return false;
    return !isInteractive(cover);
  };

  const centerHits = document.elementsFromPoint(px, py);
  if (centerHits.length > 0 && coveredByOverlay(centerHits[0] as HTMLElement)) {
    const tlHits = document.elementsFromPoint(
      Math.min(Math.max(rect.left + 2, 0), window.innerWidth - 1),
      Math.min(Math.max(rect.top + 2, 0), window.innerHeight - 1)
    );
    if (tlHits.length === 0 || coveredByOverlay(tlHits[0] as HTMLElement)) {
      return NodeFilter.FILTER_SKIP;
    }
  }

  return NodeFilter.FILTER_ACCEPT;
}

// --- Helpers ---

export function findAssociatedLabel(el: HTMLElement): HTMLElement | null {
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return label as HTMLElement;
  }
  const parent = el.closest("label");
  if (parent) return parent as HTMLElement;
  return null;
}

/** Walk up through inline single-child ancestors to the nearest block-level container.
 *  Returns null if element is already block, has no parent, or a parent has multiple children.
 *  Stops at body/documentElement — never returns those. */
export function findBlockAncestor(el: HTMLElement): HTMLElement | null {
  if (isBlockLevel(el)) return null;
  let node = el;
  while (node.parentElement) {
    const parent = node.parentElement;
    if (parent === document.body || parent === document.documentElement) return null;
    if (parent.children.length !== 1) return null;
    if (isBlockLevel(parent)) return parent;
    node = parent;
  }
  return null;
}

/** Block-level display check — treats missing/empty display as inline (browser default). */
function isBlockLevel(el: HTMLElement): boolean {
  const display = getComputedStyle(el).display;
  return display !== "" && !display.startsWith("inline");
}

// --- Interactive type ---

function interactiveType(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute("role")?.toLowerCase();
  if (tag === "a" || role === "link") return "link";
  if (tag === "button" || role === "button" || role === "menuitem") return "action";
  if (tag === "input" || tag === "textarea" || tag === "select" ||
      role === "checkbox" || role === "radio" || role === "switch" || role === "option") return "form";
  if (tag === "summary" || tag === "details" || role === "tab") return "disclosure";
  if (tag === "label") return "label";
  return "generic";
}

// --- Element discovery ---
// Uses TreeWalker with walkerFilter to discover clickable, visible elements.
// The walker prunes invisible subtrees (REJECT), skips non-clickable nodes
// (SKIP, still walking children), and yields clickable visible nodes (ACCEPT).
// Shadow roots are collected from any non-rejected node and recursed into.

export function discoverElements(getHintRect: (el: HTMLElement) => DOMRect): HTMLElement[] {
  const result: HTMLElement[] = [];

  const collectFromRoot = (root: Document | ShadowRoot): void => {
    const walkRoot = root === document ? document.body || document.documentElement : root;
    if (!walkRoot) return;

    // Wrap walkerFilter to also collect shadow roots from non-rejected nodes
    // and prune subtrees of native interactive elements (they're atomic controls).
    const shadowRoots: ShadowRoot[] = [];
    const nativeInteractiveSet = new Set(NATIVE_INTERACTIVE_ELEMENTS);
    const filter = (node: Node): number => {
      const verdict = walkerFilter(node);
      if (verdict !== NodeFilter.FILTER_REJECT) {
        const sr = (node as HTMLElement).shadowRoot;
        if (sr) shadowRoots.push(sr);
      }
      // Native interactive elements are atomic: accept them but prune their
      // subtrees so children (labels, icons, spans) don't get separate hints.
      if (verdict === NodeFilter.FILTER_ACCEPT && nativeInteractiveSet.has((node as HTMLElement).tagName.toLowerCase())) {
        result.push(node as HTMLElement);
        return NodeFilter.FILTER_REJECT;
      }
      return verdict;
    };

    const walker = document.createTreeWalker(walkRoot, NodeFilter.SHOW_ELEMENT, { acceptNode: filter });

    let node: Node | null;
    while ((node = walker.nextNode()) !== null) {
      result.push(node as HTMLElement);
    }

    for (const sr of shadowRoots) {
      collectFromRoot(sr);
    }
  };

  collectFromRoot(document);

  // Sort by viewport position: top-left elements get shortest labels
  result.sort((a, b) => {
    const ra = getHintRect(a);
    const rb = getHintRect(b);
    return (ra.top - rb.top) || (ra.left - rb.left);
  });

  // --- Containment-based dedup ---
  const resultSet = new Set(result);
  const toRemove = new Set<HTMLElement>();

  // Build parentMap: each candidate → its nearest candidate ancestor
  const parentMap = new Map<HTMLElement, HTMLElement>();
  for (const el of result) {
    let anc = el.parentElement;
    while (anc) {
      if (anc !== el && resultSet.has(anc as HTMLElement)) {
        parentMap.set(el, anc as HTMLElement);
        break;
      }
      anc = anc.parentElement;
    }
  }

  // Group children by their parent candidate
  const childrenOf = new Map<HTMLElement, HTMLElement[]>();
  for (const [child, parent] of parentMap) {
    let list = childrenOf.get(parent);
    if (!list) {
      list = [];
      childrenOf.set(parent, list);
    }
    list.push(child);
  }

  // Resolve each group
  for (const [root, descendants] of childrenOf) {
    const rootType = interactiveType(root);
    const allSameType = descendants.every(d => interactiveType(d) === rootType);
    const allGeneric = descendants.every(d => interactiveType(d) === "generic");

    if (allGeneric) {
      for (const d of descendants) toRemove.add(d);
    } else if (rootType === "generic") {
      toRemove.add(root);
    } else if (allSameType) {
      toRemove.add(root);
    }
    // Mixed specific types — keep both
  }

  // Label-for dedup
  const labelForIds = new Set<string>();
  for (const el of result) {
    if (el.tagName.toLowerCase() === "label" && (el as HTMLLabelElement).htmlFor) {
      const forId = (el as HTMLLabelElement).htmlFor;
      const input = document.getElementById(forId);
      if (input && resultSet.has(input as HTMLElement)) {
        toRemove.add(el);
      } else {
        labelForIds.add(forId);
      }
    }
  }
  if (labelForIds.size > 0) {
    for (const el of result) {
      if (el.tagName.toLowerCase() === "a") {
        const href = el.getAttribute("href");
        if (href && href.charAt(0) === "#" && labelForIds.has(href.slice(1))) {
          toRemove.add(el);
        }
      }
    }
  }

  // Sibling dedup: remove generic candidates when a non-generic sibling exists.
  // Decorative divs (cursor:pointer, tabindex) alongside real interactive elements
  // (input, button, link) shouldn't get their own hints.
  for (const el of result) {
    if (toRemove.has(el)) continue;
    if (interactiveType(el) !== "generic") continue;
    const parent = el.parentElement;
    if (!parent) continue;
    for (const other of result) {
      if (other === el || toRemove.has(other)) continue;
      if (other.parentElement === parent && interactiveType(other) !== "generic") {
        toRemove.add(el);
        break;
      }
    }
  }

  // Disclosure trigger dedup
  for (const el of result) {
    if (toRemove.has(el)) continue;
    if (el.getAttribute("aria-expanded") == null) continue;
    if (!el.getAttribute("aria-controls")) continue;

    const parent = el.parentElement;
    if (!parent) continue;

    for (const sibling of result) {
      if (sibling !== el && !toRemove.has(sibling) && sibling.parentElement === parent) {
        toRemove.add(el);
        break;
      }
    }
  }

  return result.filter(el => !toRemove.has(el));
}
