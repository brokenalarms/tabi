// Shared test helpers for HintMode tests — DOM shim, element factory, module loader.

import { mock } from "node:test";
import { KeyHandler } from "../src/modules/KeyHandler";
import { HintMode } from "../src/modules/HintMode";
import { Mode } from "../src/commands";
import { CLICKABLE_TAGS, CLICKABLE_ROLES } from "../src/modules/ElementGatherer";

const CLICKABLE_TAGS_UPPER = new Set(CLICKABLE_TAGS.map(t => t.toUpperCase()));

let capturedListeners: Record<string, Function[]>;
let keyHandler: KeyHandler;
let hintMode: HintMode;
let bodyEl: any;
let htmlEl: any;

export function makeElement(tag: string, opts: any = {}) {
    const rect = {
        top: opts.top ?? 0,
        left: opts.left ?? 0,
        bottom: opts.bottom ?? 20,
        right: opts.right ?? 100,
        width: opts.width ?? 100,
        height: opts.height ?? 20,
    };
    const style: any = {
        visibility: opts.visibility || "visible",
        display: opts.display || "block",
        opacity: opts.opacity ?? "1",
        cursor: opts.cursor || "default",
        overflow: opts.overflow || "visible",
        paddingTop: opts.paddingTop || "0px",
    };
    const children = opts.children || [];
    const childNodes = opts.textContent ? [{ nodeType: 3, textContent: opts.textContent }] : [];
    return {
        tagName: tag,
        href: opts.href || "",
        type: opts.type || "",
        hidden: opts.hidden || false,
        disabled: opts.disabled || false,
        isContentEditable: false,
        shadowRoot: opts.shadowRoot || null,
        parentNode: opts.parentNode || null,
        parentElement: opts.parentElement || null,
        firstElementChild: children[0] || null,
        children: children,
        childNodes: childNodes,
        getBoundingClientRect: () => rect,
        getClientRects: () => {
            if (rect.width > 1 && rect.height > 1) return [rect];
            return [];
        },
        _style: style,
        _attrs: opts.attrs || {},
        getAttribute(name: string) { return this._attrs[name] ?? null; },
        hasAttribute(name: string) { return this._attrs[name] != null; },
        matches(sel: string) {
            const tag = this.tagName.toLowerCase();
            // Check tag names
            if (CLICKABLE_TAGS.includes(tag)) {
                // For label, only match label[for]
                if (tag === "label") {
                    if (sel.includes("label[for]") && (this as any).htmlFor) return true;
                    // Fall through to check other selectors
                } else {
                    return true;
                }
            }
            // Check roles
            const role = this._attrs["role"];
            if (role && CLICKABLE_ROLES.includes(role)) return true;
            // Check attrs
            if (this._attrs["onclick"] != null && sel.includes("[onclick]")) return true;
            if (this._attrs["onmousedown"] != null && sel.includes("[onmousedown]")) return true;
            if ((this as any)._tabindex !== undefined && (this as any)._tabindex !== "-1") return true;
            if ((this as any).htmlFor && sel.includes("label[for]")) return true;
            return false;
        },
        contains(other: any) {
            let node = other;
            while (node) {
                if (node === this) return true;
                node = node.parentElement;
            }
            return false;
        },
        closest(sel: string) {
            // Minimal closest shim — matches comma-separated selectors
            const parts = sel.split(",").map((s: string) => s.trim());
            let node: any = this;
            while (node) {
                for (const part of parts) {
                    if (part === "[inert]" && node._attrs && node._attrs["inert"] != null) return node;
                    if (part === '[aria-hidden="true"]' && node._attrs && node._attrs["aria-hidden"] === "true") return node;
                    if (part === "label" && node.tagName === "LABEL") return node;
                }
                node = node.parentElement;
            }
            return null;
        },
        focus: mock.fn(),
        click: mock.fn(),
        addEventListener(type: string, fn: any) {
            if (type === "animationend" || type === "transitionend") fn();
        },
        querySelector(sel: string) {
            const matches = this.querySelectorAll(sel);
            return matches.length > 0 ? matches[0] : null;
        },
        querySelectorAll(sel: string) {
            // Return children that match (simplified: return all children)
            if (sel === "*") return this.children;
            // For CLICKABLE_SELECTOR, return children that are "clickable"
            return this.children.filter((c: any) => CLICKABLE_TAGS_UPPER.has(c.tagName));
        },
    };
}

export function makeKeyEvent(code: string, opts: any = {}) {
    return {
        code,
        key: opts.key || "",
        shiftKey: opts.shift || false,
        ctrlKey: opts.ctrl || false,
        altKey: opts.alt || false,
        metaKey: opts.meta || false,
        preventDefault: mock.fn(),
        stopPropagation: mock.fn(),
    };
}

export function setupDOM(elements: any[] = []) {
    capturedListeners = {};
    bodyEl = makeElement("BODY");
    htmlEl = makeElement("HTML");

    const createdEls: any[] = [];

    // Wire children from parentElement relationships so BFS can
    // traverse from body down through parents to reach all elements.
    bodyEl.children = [];
    const allParents = new Set<any>();
    for (const el of elements) {
        if (el.parentElement && el.parentElement !== bodyEl) {
            allParents.add(el.parentElement);
            if (!el.parentElement.children) el.parentElement.children = [];
            if (!el.parentElement.children.includes(el)) {
                el.parentElement.children.push(el);
            }
        }
    }
    // Add root-level elements and orphan parents to body.children
    for (const el of elements) {
        if (!el.parentElement) {
            bodyEl.children.push(el);
        }
    }
    for (const parent of allParents) {
        if (!parent.parentElement && !bodyEl.children.includes(parent)) {
            bodyEl.children.push(parent);
        }
    }

    (globalThis as any).document = {
        addEventListener(type: string, fn: any, capture?: any) {
            if (!capturedListeners[type]) capturedListeners[type] = [];
            capturedListeners[type].push(fn);
        },
        removeEventListener(type: string, fn: any, capture?: any) {
            if (capturedListeners[type]) {
                capturedListeners[type] = capturedListeners[type].filter((f) => f !== fn);
            }
        },
        activeElement: bodyEl,
        body: bodyEl,
        documentElement: htmlEl,
        head: htmlEl,
        visibilityState: "visible",
        querySelectorAll(sel: string) {
            if (sel === "*") return elements;
            return elements.filter((e: any) => {
                if (CLICKABLE_TAGS_UPPER.has(e.tagName)) return true;
                if (e.tagName === "LABEL" && e.htmlFor) return true;
                const role = e._attrs && e._attrs["role"];
                if (role && CLICKABLE_ROLES.includes(role)) return true;
                if (e._attrs && (e._attrs["onclick"] != null || e._attrs["onmousedown"] != null)) return true;
                if (e._tabindex !== undefined && e._tabindex !== "-1") return true;
                return false;
            });
        },
        getElementById(id: string) {
            return elements.find((e: any) => e.id === id) || null;
        },
        createElement(tag: string) {
            const classes = new Set<string>();
            const el: any = {
                tagName: tag.toUpperCase(),
                className: "",
                textContent: "",
                innerHTML: "",
                style: {},
                children: [],
                parentNode: null,
                classList: {
                    add(c: string) { classes.add(c); },
                    remove(c: string) { classes.delete(c); },
                    contains(c: string) { return classes.has(c); },
                },
                offsetHeight: 0,
                getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
                // Fire animation/transition listeners synchronously (no real animations in tests)
                addEventListener(type: string, fn: any) {
                    if (type === "animationend" || type === "transitionend") fn();
                },
                appendChild(child: any) {
                    this.children.push(child);
                    child.parentNode = this;
                },
                removeChild(child: any) {
                    this.children = this.children.filter((c: any) => c !== child);
                    child.parentNode = null;
                },
            };
            createdEls.push(el);
            return el;
        },
        createTextNode(text: string) {
            return { nodeType: 3, textContent: text };
        },
        elementFromPoint(x: number, y: number) {
            // Return smallest element whose rect contains the point
            let best: any = null;
            let bestArea = Infinity;
            for (const el of elements) {
                const rect = el.getBoundingClientRect();
                if (x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) {
                    const area = rect.width * rect.height;
                    if (area < bestArea) { best = el; bestArea = area; }
                }
            }
            return best;
        },
        createTreeWalker(root: any, whatToShow: number) {
            // Minimal TreeWalker mock for SHOW_ELEMENT (0x1)
            // Walks element children depth-first
            const nodes: any[] = [];
            function collect(node: any) {
                for (const child of (node.children || [])) {
                    nodes.push(child);
                    collect(child);
                }
            }
            collect(root);
            let idx = -1;
            return {
                nextNode() {
                    idx++;
                    return idx < nodes.length ? nodes[idx] : null;
                },
            };
        },
        elementsFromPoint(x: number, y: number) {
            // Return all elements whose rect contains the point, smallest first
            const hits: any[] = [];
            for (const el of elements) {
                const rect = el.getBoundingClientRect();
                if (x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) {
                    hits.push(el);
                }
            }
            hits.sort((a: any, b: any) => {
                const ra = a.getBoundingClientRect();
                const rb = b.getBoundingClientRect();
                return (ra.width * ra.height) - (rb.width * rb.height);
            });
            return hits;
        },
    };

    // Make body appendable
    bodyEl.appendChild = function (child: any) {
        child.parentNode = bodyEl;
    };
    bodyEl.removeChild = function (child: any) {
        child.parentNode = null;
    };
    // Make _viewportToDocument an identity transform
    htmlEl._style.position = "static";
    htmlEl._style.marginTop = "0";
    htmlEl._style.marginLeft = "0";
    htmlEl._appendedChildren = [];
    htmlEl.appendChild = function (child: any) {
        child.parentNode = htmlEl;
        htmlEl._appendedChildren.push(child);
    };
    htmlEl.removeChild = function (child: any) {
        child.parentNode = null;
    };

    (globalThis as any).CSS = { escape: (s: string) => s };
    (globalThis as any).NodeFilter = { SHOW_ELEMENT: 1 };

    (globalThis as any).window = {
        innerWidth: 1024,
        innerHeight: 768,
        focus: mock.fn(),
        addEventListener: mock.fn(),
        removeEventListener: mock.fn(),
    };
    (globalThis as any).getComputedStyle = (el: any) => el._style || { visibility: "visible", display: "block", opacity: "1", cursor: "default" };
    (globalThis as any).clearTimeout = clearTimeout;
    (globalThis as any).browser = {
        runtime: { sendMessage: mock.fn() },
    };
}

export function loadModules(elements: any[] = []) {
    setupDOM(elements);
    keyHandler = new KeyHandler();
    hintMode = new HintMode(keyHandler);
    hintMode.wireCommands();
    keyHandler.on("exitToNormal", () => {
        if (hintMode.isActive()) hintMode.deactivate();
        keyHandler.setMode(Mode.NORMAL);
    });
}

export function fireKeyDown(event: any) {
    const fns = capturedListeners["keydown"] || [];
    for (const fn of [...fns]) fn(event);
}

export function fireMouseDown() {
    const fns = capturedListeners["mousedown"] || [];
    for (const fn of [...fns]) fn({});
}

export function getState() {
    return { keyHandler, hintMode };
}
