// ElementGatherer — element discovery, filtering, and deduplication for hint mode.
// Uses a top-down TreeWalker with FILTER_REJECT to prune entire hidden subtrees
// without visiting children, then deduplicates via containment analysis.

export const CLICKABLE_TAGS = ["a", "button", "input", "textarea", "select", "summary", "details"];
export const CLICKABLE_ROLES = ["button", "link", "tab", "menuitem", "option", "checkbox", "radio", "switch"];
const CLICKABLE_ATTRS = ["label[for]", "[tabindex]:not([tabindex='-1'])", "[onclick]", "[onmousedown]"];

export const CLICKABLE_SELECTOR = [
  ...CLICKABLE_TAGS,
  ...CLICKABLE_ROLES.map(r => `[role='${r}']`),
  ...CLICKABLE_ATTRS,
].join(", ");

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
  if (rect.width === 0 && rect.height === 0) {
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
// BFS level-by-level: read children flat, prune hidden subtrees without
// visiting their descendants, then advance to the next level.  O(n+m)
// where n = visited nodes, m = pruned subtree roots.

export function discoverElements(getHintRect: (el: HTMLElement) => DOMRect): HTMLElement[] {
  const seen = new Set<Element>();
  const result: HTMLElement[] = [];

  const collectFromRoot = (root: Document | ShadowRoot): void => {
    const walkRoot = root === document ? document.body || document.documentElement : (root as unknown as HTMLElement);
    if (!walkRoot) return;

    let level: Element[] = Array.from(walkRoot.children);

    while (level.length > 0) {
      const next: Element[] = [];
      for (const node of level) {
        if (!node || seen.has(node)) continue;
        seen.add(node);

        const el = node as HTMLElement;
        if (!el.tagName) continue;

        // Prune: discard entire subtree for hidden/inert elements
        if (el.getAttribute("aria-hidden") === "true") continue;
        if (el.hasAttribute("inert")) continue;
        if (el.hidden) continue;
        if ((el as HTMLButtonElement).disabled) continue;
        const style = getComputedStyle(el);
        if (style.display === "none") continue;
        if (style.visibility === "hidden") continue;

        if (el.matches(CLICKABLE_SELECTOR) || style.cursor === "pointer") {
          if (isVisible(el)) result.push(el);
        }

        if (el.shadowRoot) {
          collectFromRoot(el.shadowRoot);
        }

        // Queue children for the next level
        const children = el.children;
        for (let i = 0; i < children.length; i++) {
          next.push(children[i]);
        }
      }
      level = next;
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
