// Shared test helpers for HintMode tests — DOM shim, element factory, module loader.

const { mock } = require("node:test");

let capturedListeners, keyHandler, hintMode;
let bodyEl, htmlEl;

function makeElement(tag, opts = {}) {
    const rect = {
        top: opts.top ?? 0,
        left: opts.left ?? 0,
        bottom: opts.bottom ?? 20,
        right: opts.right ?? 100,
        width: opts.width ?? 100,
        height: opts.height ?? 20,
    };
    const style = {
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
        _children: children,
        _attrs: opts.attrs || {},
        getAttribute(name) { return this._attrs[name] ?? null; },
        contains(other) {
            let node = other;
            while (node) {
                if (node === this) return true;
                node = node.parentElement;
            }
            return false;
        },
        closest(sel) {
            // Minimal closest shim — supports "[inert]" and "label"
            let node = this;
            while (node) {
                if (sel === "[inert]" && node._attrs && node._attrs["inert"] != null) return node;
                if (sel === "label" && node.tagName === "LABEL") return node;
                node = node.parentElement;
            }
            return null;
        },
        focus: mock.fn(),
        click: mock.fn(),
        addEventListener(type, fn) {
            if (type === "animationend" || type === "transitionend") fn();
        },
        querySelector(sel) {
            const matches = this.querySelectorAll(sel);
            return matches.length > 0 ? matches[0] : null;
        },
        querySelectorAll(sel) {
            // Return children that match (simplified: return all children)
            if (sel === "*") return this._children;
            // For CLICKABLE_SELECTOR, return children that are "clickable"
            return this._children.filter((c) => {
                const clickableTags = ["A", "BUTTON", "INPUT", "TEXTAREA", "SELECT", "SUMMARY", "DETAILS"];
                return clickableTags.includes(c.tagName);
            });
        },
    };
}

function makeKeyEvent(code, opts = {}) {
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

function setupDOM(elements = []) {
    capturedListeners = {};
    bodyEl = makeElement("BODY");
    htmlEl = makeElement("HTML");

    const createdEls = [];

    global.document = {
        addEventListener(type, fn, capture) {
            if (!capturedListeners[type]) capturedListeners[type] = [];
            capturedListeners[type].push(fn);
        },
        removeEventListener(type, fn, capture) {
            if (capturedListeners[type]) {
                capturedListeners[type] = capturedListeners[type].filter((f) => f !== fn);
            }
        },
        activeElement: bodyEl,
        body: bodyEl,
        documentElement: htmlEl,
        head: htmlEl,
        visibilityState: "visible",
        querySelectorAll(sel) {
            if (sel === "*") return elements;
            return elements.filter((e) => {
                const clickableTags = ["A", "BUTTON", "INPUT", "TEXTAREA", "SELECT", "SUMMARY", "DETAILS"];
                if (clickableTags.includes(e.tagName)) return true;
                // Match label[for]
                if (e.tagName === "LABEL" && e.htmlFor) return true;
                // Match ARIA roles from CLICKABLE_SELECTOR
                const role = e._attrs && e._attrs["role"];
                const clickableRoles = ["button", "link", "tab", "menuitem", "option", "checkbox", "radio", "switch"];
                if (role && clickableRoles.includes(role)) return true;
                // Match [onclick] / [onmousedown]
                if (e._attrs && (e._attrs["onclick"] != null || e._attrs["onmousedown"] != null)) return true;
                // Match elements with tabindex (mimics [tabindex]:not([tabindex='-1']))
                if (e._tabindex !== undefined && e._tabindex !== "-1") return true;
                return false;
            });
        },
        getElementById(id) {
            return elements.find((e) => e.id === id) || null;
        },
        createElement(tag) {
            const classes = new Set();
            const el = {
                tagName: tag.toUpperCase(),
                className: "",
                textContent: "",
                innerHTML: "",
                style: {},
                children: [],
                parentNode: null,
                classList: {
                    add(c) { classes.add(c); },
                    remove(c) { classes.delete(c); },
                    contains(c) { return classes.has(c); },
                },
                offsetHeight: 0,
                // Fire animation/transition listeners synchronously (no real animations in tests)
                addEventListener(type, fn) {
                    if (type === "animationend" || type === "transitionend") fn();
                },
                appendChild(child) {
                    this.children.push(child);
                    child.parentNode = this;
                },
                removeChild(child) {
                    this.children = this.children.filter((c) => c !== child);
                    child.parentNode = null;
                },
            };
            createdEls.push(el);
            return el;
        },
        createTextNode(text) {
            return { nodeType: 3, textContent: text };
        },
        createTreeWalker(root, whatToShow) {
            const nodes = [];
            const walk = (el) => {
                const ch = el._children || el.children || [];
                for (const child of ch) {
                    if (child && child.tagName) {
                        nodes.push(child);
                        walk(child);
                    }
                }
            };
            walk(root);
            let idx = -1;
            return {
                nextNode() {
                    idx++;
                    return idx < nodes.length ? nodes[idx] : null;
                },
            };
        },
        elementFromPoint(x, y) {
            // Return smallest element whose rect contains the point
            let best = null;
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
        elementsFromPoint(x, y) {
            // Return all elements whose rect contains the point, smallest first
            const hits = [];
            for (const el of elements) {
                const rect = el.getBoundingClientRect();
                if (x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) {
                    hits.push(el);
                }
            }
            hits.sort((a, b) => {
                const ra = a.getBoundingClientRect();
                const rb = b.getBoundingClientRect();
                return (ra.width * ra.height) - (rb.width * rb.height);
            });
            return hits;
        },
    };

    // Make body appendable
    bodyEl.appendChild = function (child) {
        child.parentNode = bodyEl;
    };
    bodyEl.removeChild = function (child) {
        child.parentNode = null;
    };
    // Make _viewportToDocument an identity transform
    htmlEl._style.position = "static";
    htmlEl._style.marginTop = "0";
    htmlEl._style.marginLeft = "0";
    htmlEl._appendedChildren = [];
    htmlEl.appendChild = function (child) {
        child.parentNode = htmlEl;
        htmlEl._appendedChildren.push(child);
    };
    htmlEl.removeChild = function (child) {
        child.parentNode = null;
    };

    global.CSS = { escape: (s) => s };

    global.window = {
        innerWidth: 1024,
        innerHeight: 768,
        focus: mock.fn(),
        addEventListener: mock.fn(),
        removeEventListener: mock.fn(),
    };
    global.getComputedStyle = (el) => el._style || { visibility: "visible", display: "block", opacity: "1", cursor: "default" };
    global.clearTimeout = clearTimeout;
    global.browser = {
        runtime: { sendMessage: mock.fn() },
    };
}

function loadModules(elements = []) {
    setupDOM(elements);
    const path = require("node:path");
    const cmdPath = path.resolve(__dirname, "../Vimium/Safari Extension/Resources/commands.js");
    const khPath = path.resolve(__dirname, "../Vimium/Safari Extension/Resources/modules/KeyHandler.js");
    const hmPath = path.resolve(__dirname, "../Vimium/Safari Extension/Resources/modules/HintMode.js");
    delete require.cache[cmdPath];
    delete require.cache[khPath];
    delete require.cache[hmPath];
    require(cmdPath);
    require(khPath);
    require(hmPath);
    keyHandler = new global.KeyHandler();
    hintMode = new global.HintMode(keyHandler);
    hintMode.wireCommands();
    keyHandler.on("exitToNormal", () => {
        if (hintMode.isActive()) hintMode.deactivate();
        keyHandler.setMode(global.Mode.NORMAL);
    });
}

function fireKeyDown(event) {
    const fns = capturedListeners["keydown"] || [];
    for (const fn of [...fns]) fn(event);
}

function fireMouseDown() {
    const fns = capturedListeners["mousedown"] || [];
    for (const fn of [...fns]) fn({});
}

function getState() {
    return { keyHandler, hintMode };
}

module.exports = { makeElement, makeKeyEvent, loadModules, fireKeyDown, fireMouseDown, getState };
