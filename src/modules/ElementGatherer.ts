// ElementGatherer — element discovery, filtering, and deduplication for hint mode.
// Uses TreeWalker with a 3-step walkerFilter to prune hidden subtrees, skip
// non-clickable nodes, and yield visible clickable elements, then deduplicates
// via containment analysis.

export const CLICKABLE_TAGS = ["a", "button", "input", "textarea", "select", "summary", "details"];
export const CLICKABLE_ROLES = ["button", "link", "tab", "menuitem", "option", "checkbox", "radio", "switch"];
const CLICKABLE_ATTRS = ["label[for]", "[tabindex]:not([tabindex='-1'])", "[onclick]", "[onmousedown]"];

export const CLICKABLE_SELECTOR = [
  ...CLICKABLE_TAGS,
  ...CLICKABLE_ROLES.map(r => `[role='${r}']`),
  ...CLICKABLE_ATTRS,
].join(", ");

// --- Walker filter (3-step pipeline) ---
// Used with document.createTreeWalker to discover clickable, visible elements.
// FILTER_REJECT prunes entire subtrees (step 1: display:none, visibility:hidden,
// aria-hidden, inert, hidden, disabled, and off-viewport elements).
// FILTER_SKIP skips the node but continues into children (step 2 for non-clickable
// nodes, and step 3 for zero-size, opacity:0, and overflow clipping — these must
// not prune subtrees because children can be visible independently).
// FILTER_ACCEPT yields the element.

export function walkerFilter(node: Node): number {
  const el = node as HTMLElement;

  // Step 1 — cheap exclusion (prune invisible subtrees)
  if (el.getAttribute("aria-hidden") === "true") return NodeFilter.FILTER_REJECT;
  if (el.hasAttribute("inert")) return NodeFilter.FILTER_REJECT;
  if (el.hidden) return NodeFilter.FILTER_REJECT;
  if ((el as HTMLButtonElement).disabled) return NodeFilter.FILTER_REJECT;

  const style = getComputedStyle(el);
  if (style.display === "none") return NodeFilter.FILTER_REJECT;
  if (style.visibility === "hidden") return NodeFilter.FILTER_REJECT;

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

  // Outside viewport — use SKIP (not REJECT) so fixed/sticky children are still visited
  if (rect.bottom < 0 || rect.top > window.innerHeight) return NodeFilter.FILTER_SKIP;
  if (rect.right < 0 || rect.left > window.innerWidth) return NodeFilter.FILTER_SKIP;

  // Step 2 — clickability
  if (!el.matches(CLICKABLE_SELECTOR) && style.cursor !== "pointer") return NodeFilter.FILTER_SKIP;

  // Step 3 — expensive exclusion
  // Opacity:0 with radio/checkbox label redirect
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

  // Clipped by overflow:hidden ancestor
  let ancestor = el.parentElement;
  while (ancestor && ancestor !== document.body) {
    const overflow = getComputedStyle(ancestor).overflow;
    if (overflow === "hidden" || overflow === "clip") {
      const ar = ancestor.getBoundingClientRect();
      if (rect.bottom <= ar.top || rect.top >= ar.bottom ||
          rect.right <= ar.left || rect.left >= ar.right) {
        return NodeFilter.FILTER_SKIP;
      }
    }
    ancestor = ancestor.parentElement;
  }

  // Covered by another element (elementsFromPoint)
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const px = Math.min(Math.max(centerX, 0), window.innerWidth - 1);
  const py = Math.min(Math.max(centerY, 0), window.innerHeight - 1);

  const elMatchesPoint = (point: Element[]): boolean => {
    for (const hit of point) {
      if (el.contains(hit) || hit.contains(el)) return true;
    }
    return false;
  };

  const centerHits = document.elementsFromPoint(px, py);
  if (centerHits.length > 0 && !elMatchesPoint(centerHits)) {
    const tlHits = document.elementsFromPoint(
      Math.min(Math.max(rect.left + 2, 0), window.innerWidth - 1),
      Math.min(Math.max(rect.top + 2, 0), window.innerHeight - 1)
    );
    if (tlHits.length === 0 || !elMatchesPoint(tlHits)) {
      return NodeFilter.FILTER_SKIP;
    }
  }

  return NodeFilter.FILTER_ACCEPT;
}

// --- Visibility ---

export function findAssociatedLabel(el: HTMLElement): HTMLElement | null {
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return label as HTMLElement;
  }
  const parent = el.closest("label");
  if (parent) return parent as HTMLElement;
  return null;
}

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    if (el.tagName.toLowerCase() === "a") {
      for (const child of el.children) {
        const cr = (child as HTMLElement).getBoundingClientRect();
        if (cr.width > 0 && cr.height > 0) {
          return isVisible(child as HTMLElement);
        }
      }
    }
    if (el.tagName.toLowerCase() === "input") {
      const type = ((el as HTMLInputElement).type || "").toLowerCase();
      if (type === "radio" || type === "checkbox") {
        const label = findAssociatedLabel(el);
        if (label) return isVisible(label);
      }
    }
    return false;
  }
  if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
  if (rect.right < 0 || rect.left > window.innerWidth) return false;

  const style = getComputedStyle(el);
  if (style.display === "none") return false;
  if (style.visibility === "hidden") return false;
  // Opacity:0 — excluded, with radio/checkbox → label redirect
  if (parseFloat(style.opacity) === 0) {
    if (el.tagName.toLowerCase() === "input") {
      const type = ((el as HTMLInputElement).type || "").toLowerCase();
      if (type === "radio" || type === "checkbox") {
        const label = findAssociatedLabel(el);
        if (label) return isVisible(label);
      }
    }
    return false;
  }

  // Check if element is clipped by an ancestor with overflow:hidden/clip
  let ancestor = el.parentElement;
  while (ancestor && ancestor !== document.body) {
    const overflow = getComputedStyle(ancestor).overflow;
    if (overflow === "hidden" || overflow === "clip") {
      const ar = ancestor.getBoundingClientRect();
      if (rect.bottom <= ar.top || rect.top >= ar.bottom ||
          rect.right <= ar.left || rect.left >= ar.right) {
        return false;
      }
    }
    ancestor = ancestor.parentElement;
  }

  // Check if element is actually reachable (not fully covered by another element).
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const px = Math.min(Math.max(centerX, 0), window.innerWidth - 1);
  const py = Math.min(Math.max(centerY, 0), window.innerHeight - 1);

  const elMatchesPoint = (point: Element[]): boolean => {
    for (const hit of point) {
      if (el.contains(hit) || hit.contains(el)) return true;
    }
    return false;
  };

  const centerHits = document.elementsFromPoint(px, py);
  if (centerHits.length > 0 && !elMatchesPoint(centerHits)) {
    const tlHits = document.elementsFromPoint(
      Math.min(Math.max(rect.left + 2, 0), window.innerWidth - 1),
      Math.min(Math.max(rect.top + 2, 0), window.innerHeight - 1)
    );
    if (tlHits.length === 0 || !elMatchesPoint(tlHits)) {
      return false;
    }
  }

  return true;
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
    const shadowRoots: ShadowRoot[] = [];
    const filter = (node: Node): number => {
      const verdict = walkerFilter(node);
      if (verdict !== NodeFilter.FILTER_REJECT) {
        const sr = (node as HTMLElement).shadowRoot;
        if (sr) shadowRoots.push(sr);
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
