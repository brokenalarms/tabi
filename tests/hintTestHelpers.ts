// Shared test helpers for HintMode tests — happy-dom based.
// Creates a real DOM environment so production code works without manual shims.

import { mock } from "node:test";
import { Window } from "happy-dom";
import { KeyHandler } from "../src/modules/KeyHandler";
import { HintMode } from "../src/modules/HintMode";
import { Mode } from "../src/commands";

let win: InstanceType<typeof Window> | null = null;
let capturedListeners: Record<string, Function[]>;
let keyHandler: KeyHandler;
let hintMode: HintMode;

// Saved once at window creation to avoid stacking wrappers across setupDOM calls
let origDocAEL: typeof Document.prototype.addEventListener;
let origDocREL: typeof Document.prototype.removeEventListener;

function ensureWindow(): InstanceType<typeof Window> {
    if (!win) {
        win = new Window({
            innerWidth: 1024,
            innerHeight: 768,
            url: "https://localhost/",
        });
        // Save original document methods before any wrapping
        const doc = win.document as unknown as Document;
        origDocAEL = doc.addEventListener.bind(doc);
        origDocREL = doc.removeEventListener.bind(doc);

        // Fire animation/transition events synchronously (no real animations in tests)
        const proto = (win as any).HTMLElement.prototype;
        const origAEL = proto.addEventListener;
        proto.addEventListener = function (this: any, type: string, fn: any, opts?: any) {
            if (type === "animationend" || type === "transitionend") {
                fn.call(this);
                return;
            }
            return origAEL.call(this, type, fn, opts);
        };
    }
    return win;
}

export function makeElement(tag: string, opts: any = {}) {
    const w = ensureWindow();
    const doc = w.document;
    const el = doc.createElement(tag.toLowerCase()) as unknown as HTMLElement;

    // Bounding rect (happy-dom has no layout engine)
    const rect = {
        top: opts.top ?? 0,
        left: opts.left ?? 0,
        bottom: opts.bottom ?? (opts.top ?? 0) + (opts.height ?? 20),
        right: opts.right ?? (opts.left ?? 0) + (opts.width ?? 100),
        width: opts.width ?? 100,
        height: opts.height ?? 20,
        x: opts.left ?? 0,
        y: opts.top ?? 0,
        toJSON() { return this; },
    };
    el.getBoundingClientRect = () => rect as unknown as DOMRect;
    (el as any).getClientRects = () => {
        if (rect.width > 1 && rect.height > 1) return [rect];
        return [];
    };

    // Inline styles for getComputedStyle visibility checks
    if (opts.display) el.style.display = opts.display;
    if (opts.visibility && opts.visibility !== "visible") el.style.visibility = opts.visibility;
    if (opts.opacity != null && String(opts.opacity) !== "1") el.style.opacity = String(opts.opacity);
    if (opts.cursor && opts.cursor !== "default") el.style.cursor = opts.cursor;
    if (opts.overflow && opts.overflow !== "visible") el.style.overflow = opts.overflow;
    if (opts.paddingTop && opts.paddingTop !== "0px") el.style.paddingTop = opts.paddingTop;

    // HTML attributes
    if (opts.attrs) {
        for (const [k, v] of Object.entries(opts.attrs)) {
            el.setAttribute(k, v as string);
        }
    }
    if (opts.href) el.setAttribute("href", opts.href);
    if (opts.type) (el as HTMLInputElement).type = opts.type;
    if (opts.hidden) el.hidden = true;
    if (opts.disabled) (el as HTMLButtonElement).disabled = true;

    // Text content
    if (opts.textContent) {
        el.appendChild(doc.createTextNode(opts.textContent) as unknown as Node);
    }

    // Children
    if (opts.children) {
        for (const child of opts.children) el.appendChild(child);
    }

    // Mock click and focus for assertion tracking
    el.click = mock.fn() as any;
    el.focus = mock.fn() as any;

    return el;
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
    const w = ensureWindow();
    const doc = w.document as unknown as Document;
    capturedListeners = {};

    // Reset body
    doc.body.innerHTML = "";
    // Remove any leftover overlay on documentElement
    const oldOverlay = doc.documentElement.querySelector(".vimium-hint-overlay");
    if (oldOverlay) oldOverlay.remove();

    // Append elements to body, walking up parent chains for unattached roots
    const roots = new Set<any>();
    for (const el of elements) {
        let root = el;
        while (root.parentElement) root = root.parentElement;
        roots.add(root);
    }
    for (const root of roots) {
        if (root !== doc.body && root !== doc.documentElement) {
            doc.body.appendChild(root);
        }
    }

    // Install globals
    (globalThis as any).window = w;
    (globalThis as any).document = doc;
    (globalThis as any).NodeFilter = (w as any).NodeFilter;
    (globalThis as any).getComputedStyle = (w as any).getComputedStyle.bind(w);
    (globalThis as any).CSS = (w as any).CSS ?? { escape: (s: string) => s };
    (globalThis as any).DOMRect = (w as any).DOMRect;
    (globalThis as any).HTMLElement = (w as any).HTMLElement;
    (globalThis as any).clearTimeout = globalThis.clearTimeout;

    // Mock elementsFromPoint/elementFromPoint (happy-dom has no layout)
    const testElements = elements;
    (doc as any).elementsFromPoint = (x: number, y: number) => {
        const hits: any[] = [];
        for (const el of testElements) {
            const r = el.getBoundingClientRect();
            if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) {
                hits.push(el);
            }
        }
        hits.sort((a: any, b: any) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return (ra.width * ra.height) - (rb.width * rb.height);
        });
        return hits;
    };
    (doc as any).elementFromPoint = (x: number, y: number) => {
        const hits = (doc as any).elementsFromPoint(x, y);
        return hits.length > 0 ? hits[0] : null;
    };

    // Track document event listeners for fireKeyDown/fireMouseDown.
    // Uses origDocAEL/origDocREL saved once at window creation to avoid
    // stacking wrappers when setupDOM is called multiple times.
    doc.addEventListener = ((type: string, fn: any, capture?: any) => {
        if (!capturedListeners[type]) capturedListeners[type] = [];
        capturedListeners[type].push(fn);
        origDocAEL(type, fn, capture);
    }) as any;
    doc.removeEventListener = ((type: string, fn: any, capture?: any) => {
        if (capturedListeners[type]) {
            capturedListeners[type] = capturedListeners[type].filter((f: Function) => f !== fn);
        }
        origDocREL(type, fn, capture);
    }) as any;

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
