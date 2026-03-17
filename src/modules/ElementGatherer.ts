// ElementGatherer — element discovery, filtering, and deduplication for hint mode.
// Uses TreeWalker with walkerFilter to prune hidden subtrees, skip
// non-clickable nodes, and yield visible clickable elements, then deduplicates
// via containment analysis.

import { NATIVE_INTERACTIVE_ELEMENTS, CLICKABLE_SELECTOR } from "./constants";
import {
  isExcludedByIntent, childrenCannotBeVisible, isOnScreen, isVisible,
  isClippedByOverflow, isOccluded, isZeroSizeAnchor, isRedirectableControl,
  isAnchorToLabelTarget,
} from "./elementPredicates";
import { findAssociatedLabel } from "./elementTraversals";
import { DEFAULTS } from "../types";

// --- Debug overlay ---
// When DEFAULTS.debug is true, draws colored dots on all <a> elements:
//   green  = discovered (in final result after dedup)
//   orange = passed walker but removed by dedup
//   red    = filtered out by walker (SKIP or REJECT)
// Dots auto-remove after 10 seconds.

function showDebugOverlay(result: HTMLElement[]): void {
  if (!DEFAULTS.debug) return;
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:999999;";
  document.documentElement.appendChild(overlay);
  const resultSet = new Set(result);
  for (const a of document.querySelectorAll("a[href]")) {
    const r = (a as HTMLElement).getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const found = resultSet.has(a as HTMLElement);
    const verdict = walkerFilter(a as Node);
    const passed = verdict === NodeFilter.FILTER_ACCEPT;
    // green = in final result, orange = passed walker but deduped, red = walker filtered
    const color = found ? "lime" : passed ? "orange" : "red";
    const dot = document.createElement("div");
    dot.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:8px;height:8px;border-radius:50%;background:${color};opacity:0.9;`;
    dot.title = `${color === "lime" ? "DISCOVERED" : color === "orange" ? "DEDUPED" : "FILTERED"}: ${(a as HTMLElement).getAttribute("href")?.slice(0, 50)}`;
    overlay.appendChild(dot);
  }
  setTimeout(() => overlay.remove(), 10000);
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
  if (childrenCannotBeVisible(el)) return NodeFilter.FILTER_REJECT;

  // Visually-hidden pattern: clip/clip-path reducing visible area to zero
  // (e.g. "skip to content" links, sr-only elements)
  const style = getComputedStyle(el);
  const clipPath = style.clipPath || el.style.clipPath;
  if (clipPath && clipPath !== "none") {
    const m = clipPath.match(/inset\((\d+)%/);
    if (m && parseInt(m[1]) >= 50) return NodeFilter.FILTER_REJECT;
  }
  // clip only applies to position:absolute/fixed elements (CSS spec).
  // Computed styles still report the value on static elements, but it has
  // no visual effect — don't prune visible subtrees based on an inert clip.
  const pos = style.position;
  if (pos === "absolute" || pos === "fixed") {
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
  }

  // Effective rect: fallback for zero-size elements.
  // Zero-size anchors use their first visible child's rect.
  // Zero-size radio/checkbox inputs use their associated label's rect.
  let rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    let fallbackRect: DOMRect | null = null;
    if (isZeroSizeAnchor(el, rect)) {
      for (const child of el.children) {
        const cr = (child as HTMLElement).getBoundingClientRect();
        if (cr.width > 0 && cr.height > 0) { fallbackRect = cr; break; }
      }
    } else if (isRedirectableControl(el)) {
      const label = findAssociatedLabel(el);
      if (label) {
        const lr = label.getBoundingClientRect();
        if (lr.width > 0 && lr.height > 0) fallbackRect = lr;
      }
    }
    if (!fallbackRect) return NodeFilter.FILTER_SKIP;
    rect = fallbackRect;
  }

  // Outside viewport — SKIP so fixed/sticky children are still visited
  if (!isOnScreen(rect)) return NodeFilter.FILTER_SKIP;

  // Clickability check — only semantic signals (CLICKABLE_SELECTOR), not visual ones.
  // We intentionally do NOT use cursor:pointer as a discovery signal. While cursor:pointer
  // catches some JS-only click handlers (React onClick, Vue @click), it produces far more
  // false positives: non-interactive images, decorative wrappers, and overlay containers
  // all inherit or receive cursor:pointer from CSS without being meaningful click targets.
  // Each false positive required a new dedup rule (wrapper dedup, sibling dedup, cover
  // occlusion), adding complexity without reliability. SPAs that care about accessibility
  // should use ARIA roles or semantic HTML — those are the signals we trust.
  if (!el.matches(CLICKABLE_SELECTOR)) return NodeFilter.FILTER_SKIP;

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

  // Covered by another element at any corner
  if (isOccluded(el, rect)) return NodeFilter.FILTER_SKIP;

  return NodeFilter.FILTER_ACCEPT;
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
      if (isAnchorToLabelTarget(el, labelForIds)) {
        toRemove.add(el);
      }
    }
  }

  // Sibling dedup: remove generic candidates when a non-generic sibling exists.
  // Decorative divs (e.g. onclick) alongside real interactive elements
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

  const finalResult = result.filter(el => !toRemove.has(el));
  showDebugOverlay(finalResult);
  return finalResult;
}
