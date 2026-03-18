"use strict";
(() => {
  // src/commands.ts
  var Mode = {
    NORMAL: "NORMAL",
    INSERT: "INSERT",
    HINTS: "HINTS",
    TAB_SEARCH: "TAB_SEARCH"
  };
  var COMMANDS = {
    scrollDown: "Scroll down",
    scrollUp: "Scroll up",
    scrollLeft: "Scroll left",
    scrollRight: "Scroll right",
    scrollHalfPageDown: "Half page down",
    scrollHalfPageUp: "Half page up",
    scrollToBottom: "Scroll to bottom",
    scrollToTop: "Scroll to top",
    goBack: "Go back",
    goForward: "Go forward",
    pageRefresh: "Refresh page",
    activateHints: "Open link (current tab)",
    activateHintsNewTab: "Open link (new tab)",
    createTab: "New tab",
    closeTab: "Close tab",
    restoreTab: "Restore tab",
    tabLeft: "Move tab left",
    tabRight: "Move tab right",
    tabNext: "Next tab",
    tabPrev: "Previous tab",
    goToTab: "Go to tab by number",
    openTabSearch: "Search tabs",
    focusInput: "Focus first text input",
    goUpUrl: "Go up one URL level",
    showHelp: "Show this help",
    exitToNormal: "Exit to normal mode"
  };

  // src/modules/KeyHandler.ts
  var INPUT_TAGS = /* @__PURE__ */ new Set(["INPUT", "TEXTAREA", "SELECT"]);
  var NON_TEXT_INPUT_TYPES = /* @__PURE__ */ new Set([
    "checkbox",
    "radio",
    "submit",
    "button",
    "reset",
    "file",
    "image",
    "color",
    "range"
  ]);
  var TEXT_INPUT_ROLES = /* @__PURE__ */ new Set([
    "textbox",
    "searchbox",
    "combobox"
  ]);
  var KEY_TIMEOUT_MS = 500;
  var KEY_CHAR_TO_CODE = {
    "/": "Slash",
    "?": "Slash",
    "\\": "Backslash",
    "|": "Backslash",
    ".": "Period",
    ">": "Period",
    ",": "Comma",
    "<": "Comma",
    ";": "Semicolon",
    ":": "Semicolon",
    "'": "Quote",
    '"': "Quote",
    "[": "BracketLeft",
    "{": "BracketLeft",
    "]": "BracketRight",
    "}": "BracketRight",
    "`": "Backquote",
    "~": "Backquote",
    "-": "Minus",
    "_": "Minus",
    "=": "Equal",
    "+": "Equal",
    "!": "Digit1",
    "@": "Digit2",
    "#": "Digit3",
    "$": "Digit4",
    "%": "Digit5",
    "^": "Digit6",
    "&": "Digit7",
    "*": "Digit8",
    "(": "Digit9",
    ")": "Digit0"
  };
  var KeyHandler = class _KeyHandler {
    constructor() {
      this.mode = Mode.NORMAL;
      this.keyBindingMode = "location";
      this.keyBuffer = "";
      this.keyTimer = null;
      this.bindings = /* @__PURE__ */ new Map();
      this.commands = /* @__PURE__ */ new Map();
      this.keyUpCommands = /* @__PURE__ */ new Map();
      this.prefixes = /* @__PURE__ */ new Map();
      this.modeListeners = [];
      this.modeKeyDelegate = null;
      this.heldCommand = null;
      this.heldCode = null;
      this.onKeyDownHandler = this.handleKeyDown.bind(this);
      this.onKeyUpHandler = this.handleKeyUp.bind(this);
      this.onFocusInHandler = this.handleFocusIn.bind(this);
      this.onFocusOutHandler = this.handleFocusOut.bind(this);
      this.initDefaultBindings();
      this.attach();
    }
    // --- Public API ---
    getMode() {
      return this.mode;
    }
    setMode(newMode) {
      if (newMode === this.mode) return;
      const prev = this.mode;
      this.mode = newMode;
      this.resetKeyBuffer();
      for (const fn of this.modeListeners) fn(newMode, prev);
    }
    onModeChange(fn) {
      this.modeListeners.push(fn);
    }
    setKeyBindingMode(mode) {
      this.keyBindingMode = mode;
      this.resetKeyBuffer();
    }
    setModeKeyDelegate(handler) {
      this.modeKeyDelegate = handler;
    }
    clearModeKeyDelegate() {
      this.modeKeyDelegate = null;
    }
    on(commandName, callback) {
      this.commands.set(commandName, callback);
    }
    off(commandName) {
      this.commands.delete(commandName);
      this.keyUpCommands.delete(commandName);
    }
    onKeyUp(commandName, callback) {
      this.keyUpCommands.set(commandName, callback);
    }
    resetBuffer() {
      this.resetKeyBuffer();
    }
    getBindings() {
      return this.bindings;
    }
    destroy() {
      this.detach();
      this.resetKeyBuffer();
      this.commands.clear();
      this.bindings.clear();
      this.prefixes.clear();
      this.modeListeners.length = 0;
    }
    // --- Binding registration ---
    bind(mode, sequence, commandName) {
      if (!this.bindings.has(mode)) {
        this.bindings.set(mode, /* @__PURE__ */ new Map());
        this.prefixes.set(mode, /* @__PURE__ */ new Set());
      }
      const modeMap = this.bindings.get(mode);
      if (modeMap) modeMap.set(sequence, commandName);
      this.rebuildPrefixes(mode);
    }
    // --- Key normalization ---
    static normalizeKey(event, keyBindingMode = "location") {
      const parts = [];
      if (event.ctrlKey) parts.push("Ctrl");
      if (event.altKey) parts.push("Alt");
      if (event.metaKey) parts.push("Meta");
      let code;
      if (keyBindingMode === "character") {
        const key = event.key;
        if (key.length === 1 && key >= "a" && key <= "z") {
          if (event.shiftKey) parts.push("Shift");
          code = "Key" + key.toUpperCase();
        } else if (key.length === 1 && key >= "A" && key <= "Z") {
          if (event.shiftKey) parts.push("Shift");
          code = "Key" + key;
        } else if (key.length === 1 && key >= "0" && key <= "9") {
          if (event.shiftKey) parts.push("Shift");
          code = "Digit" + key;
        } else {
          if (event.shiftKey) parts.push("Shift");
          code = key.length === 1 && KEY_CHAR_TO_CODE[key] || event.code;
        }
      } else {
        if (event.shiftKey) parts.push("Shift");
        code = event.code;
      }
      parts.push(code);
      return parts.join("-");
    }
    // --- Internals ---
    initDefaultBindings() {
      const n = Mode.NORMAL;
      const addBinding = (mode, seq, cmd) => {
        if (!(cmd in COMMANDS)) {
          console.warn(`[Vimium] Unknown command "${cmd}" \u2014 not in COMMANDS`);
        }
        this.bind(mode, seq, cmd);
      };
      addBinding(n, "KeyJ", "scrollDown");
      addBinding(n, "KeyK", "scrollUp");
      addBinding(n, "KeyH", "scrollLeft");
      addBinding(n, "KeyL", "scrollRight");
      addBinding(n, "KeyD", "scrollHalfPageDown");
      addBinding(n, "KeyU", "scrollHalfPageUp");
      addBinding(n, "Shift-KeyG", "scrollToBottom");
      addBinding(n, "KeyG KeyG", "scrollToTop");
      addBinding(n, "Shift-KeyH", "goBack");
      addBinding(n, "Shift-KeyL", "goForward");
      addBinding(n, "KeyR", "pageRefresh");
      addBinding(n, "KeyF", "activateHints");
      addBinding(n, "Shift-KeyF", "activateHintsNewTab");
      addBinding(n, "KeyT", "createTab");
      addBinding(n, "KeyX", "closeTab");
      addBinding(n, "Shift-KeyX", "restoreTab");
      addBinding(n, "Shift-KeyJ", "tabLeft");
      addBinding(n, "Shift-KeyK", "tabRight");
      addBinding(n, "KeyG KeyT", "tabNext");
      addBinding(n, "KeyG Shift-KeyT", "tabPrev");
      for (let i = 1; i <= 9; i++) {
        this.bind(n, "KeyG Digit" + i, "goToTab" + i);
      }
      this.bind(n, "KeyG Shift-Digit6", "goToTabFirst");
      this.bind(n, "KeyG Digit0", "goToTabFirst");
      this.bind(n, "KeyG Shift-Digit4", "goToTabLast");
      addBinding(n, "Shift-KeyT", "openTabSearch");
      addBinding(n, "KeyG KeyI", "focusInput");
      addBinding(n, "KeyG KeyU", "goUpUrl");
      addBinding(n, "Shift-Slash", "showHelp");
      for (const mode of [Mode.INSERT, Mode.HINTS, Mode.TAB_SEARCH]) {
        addBinding(mode, "Escape", "exitToNormal");
      }
    }
    rebuildPrefixes(mode) {
      const prefixSet = /* @__PURE__ */ new Set();
      const modeBindings = this.bindings.get(mode);
      if (!modeBindings) return;
      for (const seq of modeBindings.keys()) {
        const parts = seq.split(" ");
        for (let i = 1; i < parts.length; i++) {
          prefixSet.add(parts.slice(0, i).join(" "));
        }
      }
      this.prefixes.set(mode, prefixSet);
    }
    attach() {
      document.addEventListener("keydown", this.onKeyDownHandler, true);
      document.addEventListener("keyup", this.onKeyUpHandler, true);
      document.addEventListener("focusin", this.onFocusInHandler, true);
      document.addEventListener("focusout", this.onFocusOutHandler, true);
    }
    detach() {
      document.removeEventListener("keydown", this.onKeyDownHandler, true);
      document.removeEventListener("keyup", this.onKeyUpHandler, true);
      document.removeEventListener("focusin", this.onFocusInHandler, true);
      document.removeEventListener("focusout", this.onFocusOutHandler, true);
    }
    handleFocusIn(event) {
      const target = event.composedPath()[0];
      if (this.isInputField(target) && this.mode === Mode.NORMAL) {
        this.setMode(Mode.INSERT);
      }
    }
    handleFocusOut(event) {
      const target = event.composedPath()[0];
      if (this.isInputField(target) && this.mode === Mode.INSERT) {
        this.setMode(Mode.NORMAL);
      }
    }
    isInputField(el) {
      if (!el || !el.tagName) return false;
      if (INPUT_TAGS.has(el.tagName)) {
        if (el.tagName === "INPUT") {
          const type = (el.type || "text").toLowerCase();
          return !NON_TEXT_INPUT_TYPES.has(type);
        }
        return true;
      }
      if (el.isContentEditable) return true;
      const role = el.getAttribute?.("role");
      if (role && TEXT_INPUT_ROLES.has(role)) return true;
      if (el.shadowRoot && el.shadowRoot.activeElement) {
        return this.isInputField(el.shadowRoot.activeElement);
      }
      return false;
    }
    handleKeyDown(event) {
      if ([
        "ShiftLeft",
        "ShiftRight",
        "ControlLeft",
        "ControlRight",
        "AltLeft",
        "AltRight",
        "MetaLeft",
        "MetaRight"
      ].includes(event.code)) {
        return;
      }
      if (this.mode === Mode.NORMAL && this.isInputField(document.activeElement)) {
        this.setMode(Mode.INSERT);
      }
      if (this.mode !== Mode.NORMAL) {
        if (this.modeKeyDelegate) {
          const handled = this.modeKeyDelegate(event);
          if (handled) return;
        }
        if (event.code === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          this.dispatch("exitToNormal");
        }
        return;
      }
      const key = _KeyHandler.normalizeKey(event, this.keyBindingMode);
      const candidate = this.keyBuffer ? this.keyBuffer + " " + key : key;
      const modeBindings = this.bindings.get(this.mode);
      const modePrefixes = this.prefixes.get(this.mode);
      if (modeBindings && modeBindings.has(candidate)) {
        event.preventDefault();
        event.stopPropagation();
        this.resetKeyBuffer();
        const cmd = modeBindings.get(candidate);
        if (!candidate.includes(" ") && this.keyUpCommands.has(cmd)) {
          this.heldCommand = cmd;
          this.heldCode = event.code;
        }
        this.dispatch(cmd);
        return;
      }
      if (modePrefixes && modePrefixes.has(candidate)) {
        event.preventDefault();
        event.stopPropagation();
        this.keyBuffer = candidate;
        this.startTimeout();
        return;
      }
      if (this.keyBuffer) {
        this.resetKeyBuffer();
        return;
      }
    }
    handleKeyUp(event) {
      if (this.heldCommand && event.code === this.heldCode) {
        const handler = this.keyUpCommands.get(this.heldCommand);
        if (handler) handler();
        this.heldCommand = null;
        this.heldCode = null;
      }
    }
    startTimeout() {
      clearTimeout(this.keyTimer);
      this.keyTimer = setTimeout(() => {
        this.keyBuffer = "";
        this.keyTimer = null;
      }, KEY_TIMEOUT_MS);
    }
    resetKeyBuffer() {
      this.keyBuffer = "";
      if (this.keyTimer) {
        clearTimeout(this.keyTimer);
        this.keyTimer = null;
      }
    }
    dispatch(commandName) {
      const handler = this.commands.get(commandName);
      if (handler) {
        handler();
      }
    }
  };

  // src/types.ts
  var DEFAULTS = {
    theme: "auto",
    keyBindingMode: "location",
    animate: true
  };
  var DEBUG = true ? false : false;

  // src/modules/constants.ts
  var NATIVE_INTERACTIVE_ELEMENTS = ["a", "button", "input", "textarea", "select"];
  var CLICKABLE_ROLES = ["button", "link", "tab", "menuitem", "option", "checkbox", "radio", "switch", "treeitem"];
  var CLICKABLE_ATTRS = ["label[for]", "[onclick]", "[onmousedown]"];
  var CLICKABLE_SELECTOR = [
    ...NATIVE_INTERACTIVE_ELEMENTS,
    ...CLICKABLE_ROLES.map((r) => `[role='${r}']`),
    ...CLICKABLE_ATTRS
  ].join(", ");
  var REPEATING_CONTAINER_SELECTOR = "li, tr";
  var LIST_CONTAINER_TAGS = new Set(["UL", "OL", "TABLE", "TBODY", "THEAD", "TFOOT"]);
  var HEADING_ELEMENTS = ["h1", "h2", "h3", "h4", "h5", "h6"];
  var HEADING_SELECTOR = HEADING_ELEMENTS.join(", ");
  var MINIMUM_CONTAINER_WIDTH = 100;
  var MINIMUM_CONTAINER_HEIGHT = 32;
  var HINT_FONT_SIZE = 12;
  var HINT_LINE_HEIGHT = 1.2;
  var HINT_PADDING_Y = 1;
  var HINT_BORDER_WIDTH = 1;
  var HINT_HEIGHT = HINT_FONT_SIZE * HINT_LINE_HEIGHT + 2 * HINT_PADDING_Y + 2 * HINT_BORDER_WIDTH;

  // src/modules/elementPredicates.ts
  function isOnScreen(rect) {
    if (rect.width === 0 || rect.height === 0) return false;
    if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
    if (rect.right < 0 || rect.left > window.innerWidth) return false;
    return true;
  }
  function childrenCannotBeVisible(el) {
    return getComputedStyle(el).display === "none";
  }
  function isVisible(el, rect) {
    const r = rect ?? el.getBoundingClientRect();
    if (!isOnScreen(r)) return false;
    const style = getComputedStyle(el);
    if (style.display === "none") return false;
    if (style.visibility === "hidden") return false;
    if (parseFloat(style.opacity) === 0) return false;
    return true;
  }
  function hasBox(el) {
    const display = getComputedStyle(el).display;
    return display !== "none" && display !== "contents";
  }
  function isSubtreeRemoved(el) {
    if (el.closest("[aria-hidden='true']")) return true;
    if (el.closest("[inert]")) return true;
    return false;
  }
  function isExcludedByIntent(el) {
    if (isSubtreeRemoved(el)) return true;
    if (el.hidden) return true;
    if (el.disabled) return true;
    return false;
  }
  function isClippedByOverflow(el, rect) {
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
  function composedContains(ancestor, descendant) {
    let node = descendant;
    while (node) {
      if (node === ancestor) return true;
      const root = node.getRootNode();
      if (root !== node && root !== document && root.host) {
        node = root.host;
      } else {
        node = node.parentNode;
      }
    }
    return false;
  }
  function isOccluded(el, rect) {
    const clampX = (x) => Math.min(Math.max(x, 0), window.innerWidth - 1);
    const clampY = (y) => Math.min(Math.max(y, 0), window.innerHeight - 1);
    const isCover = (cover) => {
      if (composedContains(el, cover) || composedContains(cover, el)) return false;
      if (isSubtreeRemoved(cover)) return false;
      if (isContentlessOverlay(cover)) return false;
      if (isSiblingInRepeatingContainer(el, cover)) return false;
      if (isInSameLabel(el, cover)) return false;
      if (isInNearbySiblingSubtree(el, cover)) return false;
      return true;
    };
    const corners = [
      [rect.left + 2, rect.top + 2, false],
      [rect.right - 2, rect.top + 2, false],
      [rect.left + 2, rect.bottom - 2, true],
      [rect.right - 2, rect.bottom - 2, true]
    ];
    for (const [x, y, isBottom] of corners) {
      const hits = document.elementsFromPoint(clampX(x), clampY(y));
      if (hits.length > 0 && isCover(hits[0])) {
        if (isBottom) return true;
      }
    }
    return false;
  }
  function isInSameLabel(a, b) {
    const label = a.closest("label");
    return label !== null && label.contains(b);
  }
  function isSiblingInRepeatingContainer(a, b) {
    const aItem = getRepeatingContainer(a);
    const bItem = getRepeatingContainer(b);
    return aItem !== null && bItem !== null && aItem !== bItem && aItem.parentElement === bItem.parentElement;
  }
  var SIBLING_DEPTH_LIMIT = 4;
  function isInNearbySiblingSubtree(el, cover) {
    let anc = el;
    let depth = 0;
    while (anc && depth < SIBLING_DEPTH_LIMIT) {
      if (anc.matches(REPEATING_CONTAINER_SELECTOR)) break;
      const parent = anc.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) break;
      if (parent.contains(cover) && !anc.contains(cover)) return true;
      anc = parent;
      depth++;
    }
    return false;
  }
  function isContentlessOverlay(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "iframe" || tag === "object" || tag === "embed") return false;
    if ((el.textContent || "").trim()) return false;
    if (el.querySelector("img, svg, picture, video, canvas")) return false;
    return true;
  }
  var MINIMUM_REPEATING_SIBLINGS = 3;
  function isInListContainer(el) {
    const container = el.closest(REPEATING_CONTAINER_SELECTOR);
    return container !== null && hasBox(container) ? container : null;
  }
  function isInSiblingLinkGroup(el) {
    if (el.tagName !== "A" || el.parentElement === null) return false;
    const siblings = el.parentElement.children;
    let count = 0;
    for (let i = 0; i < siblings.length; i++) {
      if (siblings[i].tagName === "A") count++;
      if (count >= MINIMUM_REPEATING_SIBLINGS) return true;
    }
    return false;
  }
  function isInNavWithSingleInteractiveChildren(el) {
    if (el.parentElement === null || el.parentElement.tagName !== "NAV") return false;
    const children = el.parentElement.children;
    if (children.length < MINIMUM_REPEATING_SIBLINGS) return false;
    for (let i = 0; i < children.length; i++) {
      if (children[i].querySelectorAll(CLICKABLE_SELECTOR).length > 1) return false;
    }
    return true;
  }
  function getRepeatingContainer(el) {
    const listContainer = isInListContainer(el);
    if (listContainer !== null) return listContainer;
    if (isInSiblingLinkGroup(el)) return el;
    if (isInNavWithSingleInteractiveChildren(el)) return el;
    return null;
  }
  function isInRepeatingContainer(el) {
    return getRepeatingContainer(el) !== null;
  }
  function hasListBoundaryBetween(ancestor, descendant) {
    let node = descendant.parentElement;
    while (node && node !== ancestor) {
      if (LIST_CONTAINER_TAGS.has(node.tagName)) return true;
      node = node.parentElement;
    }
    return false;
  }
  function hasTagOrRole(el) {
    return NATIVE_INTERACTIVE_ELEMENTS.includes(el.tagName.toLowerCase()) || el.getAttribute("role") !== null;
  }
  function isLargeEnoughForGlow(el, rect) {
    if (!hasBox(el)) return false;
    if (rect.width <= MINIMUM_CONTAINER_WIDTH) return false;
    if (rect.height < MINIMUM_CONTAINER_HEIGHT) return false;
    const isRectangular = rect.width / (rect.height || 1) >= 1.5;
    const isLarge = rect.width > window.innerWidth * 0.25;
    return isRectangular || isLarge;
  }
  function hasHeadingContent(el) {
    return el.querySelector(HEADING_SELECTOR) !== null;
  }
  function hasJsactionClick(el) {
    const jsaction = el.getAttribute("jsaction");
    if (jsaction === null) return false;
    return /(^|;\s*)click:/.test(jsaction);
  }
  function isFormControl(el) {
    const tag = el.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select";
  }
  function isRedirectableControl(el) {
    if (el.tagName.toLowerCase() !== "input") return false;
    const type = (el.type || "").toLowerCase();
    return type === "radio" || type === "checkbox";
  }
  function isZeroSizeAnchor(el, rect) {
    return el.tagName.toLowerCase() === "a" && rect.width === 0 && rect.height === 0;
  }
  function isAnchorToLabelTarget(el, labelForIds) {
    if (el.tagName.toLowerCase() !== "a") return false;
    const href = el.getAttribute("href");
    return href !== null && href.charAt(0) === "#" && labelForIds.has(href.slice(1));
  }
  function shouldRedirectToHeading(el) {
    return el.tagName.toLowerCase() === "a" && hasHeadingContent(el) && !isInRepeatingContainer(el);
  }

  // src/modules/elementTraversals.ts
  function findAssociatedLabel(el) {
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label;
    }
    const parent = el.closest("label");
    if (parent) return parent;
    return null;
  }
  function findVisibleChild(el) {
    for (const child of el.children) {
      const cr = child.getBoundingClientRect();
      if (cr.width > 0 && cr.height > 0) return child;
    }
    return null;
  }
  function getHeading(el) {
    return el.querySelector(HEADING_SELECTOR);
  }
  function getChildrenContentRect(el) {
    let left = Infinity, right = -Infinity;
    let top = Infinity, bottom = -Infinity;
    for (const child of el.children) {
      const cr = child.getBoundingClientRect();
      if (cr.width > 0 && cr.height > 0) {
        left = Math.min(left, cr.left);
        right = Math.max(right, cr.right);
        top = Math.min(top, cr.top);
        bottom = Math.max(bottom, cr.bottom);
      }
    }
    if (left >= right || top >= bottom) return null;
    return new DOMRect(left, top, right - left, bottom - top);
  }
  function getLinkContentRect(el, rect) {
    if (el.children.length > 0) {
      return getChildrenContentRect(el) ?? rect;
    }
    const paddingBottom = parseFloat(getComputedStyle(el).paddingBottom) || 0;
    if (paddingBottom > 0) {
      return new DOMRect(rect.left, rect.top, rect.width, rect.height - paddingBottom);
    }
    return rect;
  }
  function findBlockAncestor(el) {
    let node = el;
    while (node.parentElement) {
      const parent = node.parentElement;
      if (parent === document.body || parent === document.documentElement) return null;
      if (parent.children.length !== 1) return null;
      if (parent.matches(REPEATING_CONTAINER_SELECTOR) && hasBox(parent)) return parent;
      node = parent;
    }
    return null;
  }
  function getBlockAncestorRect(el, rect) {
    const ancestor = findBlockAncestor(el);
    if (!ancestor) return null;
    const hasMixedContent = Array.from(ancestor.childNodes).some(
      (n) => n.nodeType === 3 && (n.textContent || "").trim().length > 0
    );
    if (hasMixedContent) return null;
    const ancestorRect = ancestor.getBoundingClientRect();
    return new DOMRect(ancestorRect.left, rect.top, ancestorRect.width, rect.height);
  }

  // src/modules/ElementGatherer.ts
  function renderDebugDots(overlay, result) {
    if (!DEBUG) return;
    const resultSet = new Set(result);
    for (const a of document.querySelectorAll("a[href]")) {
      const r = a.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const found = resultSet.has(a);
      const verdict = walkerFilter(a);
      const passed = verdict === NodeFilter.FILTER_ACCEPT;
      const color = found ? "lime" : passed ? "orange" : "red";
      const dot = document.createElement("div");
      dot.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:8px;height:8px;border-radius:50%;background:${color};opacity:0.9;`;
      dot.title = `${color === "lime" ? "DISCOVERED" : color === "orange" ? "DEDUPED" : "FILTERED"}: ${a.getAttribute("href")?.slice(0, 50)}`;
      overlay.appendChild(dot);
    }
  }
  function elId(el) {
    const href = (el.getAttribute("href") || "").slice(0, 40);
    const text = (el.textContent || "").trim().slice(0, 20);
    return el.tagName + (href ? " " + href : "") + (text ? " " + text : "");
  }
  function logSkip(el, reason) {
    console.log("SKIP", reason, elId(el));
  }
  function logOccluded(el, rect) {
    const corners = [[rect.left + 2, rect.bottom - 2], [rect.right - 2, rect.bottom - 2]];
    const covers = corners.map(([x, y]) => {
      const hit = document.elementsFromPoint(x, y)[0];
      if (!hit || el.contains(hit) || hit.contains(el)) return null;
      const cn = typeof hit.className === "string" ? hit.className.slice(0, 30) : "";
      return hit.tagName + (cn ? "." + cn : "");
    }).filter(Boolean);
    console.log("SKIP occluded", elId(el), "by:", covers.join(" | "));
  }
  function walkerFilter(node) {
    const el = node;
    if (isExcludedByIntent(el)) return NodeFilter.FILTER_REJECT;
    if (childrenCannotBeVisible(el)) return NodeFilter.FILTER_REJECT;
    const style = getComputedStyle(el);
    const clipPath = style.clipPath || el.style.clipPath;
    if (clipPath && clipPath !== "none") {
      const m = clipPath.match(/inset\((\d+)%/);
      if (m && parseInt(m[1]) >= 50) return NodeFilter.FILTER_REJECT;
    }
    const pos = style.position;
    if (pos === "absolute" || pos === "fixed") {
      const clip = style.getPropertyValue("clip") || el.style.getPropertyValue("clip");
      if (clip && clip !== "auto") {
        const m = clip.match(/rect\(([^)]+)\)/);
        if (m) {
          const vals = m[1].split(/[,\s]+/).map(parseFloat).filter((v) => !isNaN(v));
          if (vals.length >= 4 && vals[2] - vals[0] <= 1 && vals[1] - vals[3] <= 1) {
            return NodeFilter.FILTER_REJECT;
          }
        }
      }
    }
    let rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      let fallbackRect = null;
      if (isZeroSizeAnchor(el, rect)) {
        for (const child of el.children) {
          const cr = child.getBoundingClientRect();
          if (cr.width > 0 && cr.height > 0) {
            fallbackRect = cr;
            break;
          }
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
    if (!isOnScreen(rect)) return NodeFilter.FILTER_SKIP;
    if (!el.matches(CLICKABLE_SELECTOR) && !hasJsactionClick(el)) return NodeFilter.FILTER_SKIP;
    if (parseFloat(style.opacity) === 0) {
      if (el.tagName.toLowerCase() === "input") {
        const type = (el.type || "").toLowerCase();
        if (type === "radio" || type === "checkbox") {
          const label = findAssociatedLabel(el);
          if (label && isVisible(label)) return NodeFilter.FILTER_ACCEPT;
        }
      }
      if (DEBUG) logSkip(el, "opacity:0");
      return NodeFilter.FILTER_SKIP;
    }
    if (!isVisible(el, rect)) {
      if (DEBUG) logSkip(el, "invisible");
      return NodeFilter.FILTER_SKIP;
    }
    if (isClippedByOverflow(el, rect)) {
      if (DEBUG) logSkip(el, "clipped " + Math.round(rect.width) + "x" + Math.round(rect.height));
      return NodeFilter.FILTER_SKIP;
    }
    if (isOccluded(el, rect)) {
      if (DEBUG) logOccluded(el, rect);
      return NodeFilter.FILTER_SKIP;
    }
    return NodeFilter.FILTER_ACCEPT;
  }
  function discoverElements(getHintRect) {
    const result = [];
    const collectFromRoot = (root) => {
      const walkRoot = root === document ? document.body || document.documentElement : root;
      if (!walkRoot) return;
      const shadowRoots = [];
      const nativeInteractiveSet = new Set(NATIVE_INTERACTIVE_ELEMENTS);
      const filter = (node2) => {
        const verdict = walkerFilter(node2);
        if (verdict !== NodeFilter.FILTER_REJECT) {
          const sr = node2.shadowRoot;
          if (sr) shadowRoots.push(sr);
        }
        if (verdict === NodeFilter.FILTER_ACCEPT && nativeInteractiveSet.has(node2.tagName.toLowerCase())) {
          result.push(node2);
          return NodeFilter.FILTER_REJECT;
        }
        return verdict;
      };
      const walker = document.createTreeWalker(walkRoot, NodeFilter.SHOW_ELEMENT, { acceptNode: filter });
      let node;
      while ((node = walker.nextNode()) !== null) {
        result.push(node);
      }
      for (const sr of shadowRoots) {
        collectFromRoot(sr);
      }
    };
    collectFromRoot(document);
    result.sort((a, b) => {
      const ra = getHintRect(a);
      const rb = getHintRect(b);
      return ra.top - rb.top || ra.left - rb.left;
    });
    const resultSet = new Set(result);
    const toRemove = /* @__PURE__ */ new Set();
    const parentMap = /* @__PURE__ */ new Map();
    for (const el of result) {
      let anc = el.parentElement;
      while (anc) {
        if (LIST_CONTAINER_TAGS.has(anc.tagName)) break;
        if (anc !== el && resultSet.has(anc)) {
          parentMap.set(el, anc);
          break;
        }
        anc = anc.parentElement;
      }
    }
    const childrenOf = /* @__PURE__ */ new Map();
    for (const [child, parent] of parentMap) {
      let list = childrenOf.get(parent);
      if (!list) {
        list = [];
        childrenOf.set(parent, list);
      }
      list.push(child);
    }
    for (const [root] of childrenOf) {
      toRemove.add(root);
    }
    const labelForIds = /* @__PURE__ */ new Set();
    for (const el of result) {
      if (el.tagName.toLowerCase() === "label" && el.htmlFor) {
        const forId = el.htmlFor;
        const input = document.getElementById(forId);
        if (input && resultSet.has(input)) {
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
    for (const el of result) {
      if (toRemove.has(el)) continue;
      if (hasTagOrRole(el)) continue;
      const parent = el.parentElement;
      if (!parent) continue;
      for (const other of result) {
        if (other === el || toRemove.has(other)) continue;
        if (other.parentElement === parent && hasTagOrRole(other)) {
          toRemove.add(el);
          break;
        }
      }
    }
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
    return result.filter((el) => !toRemove.has(el));
  }

  // src/modules/HintMode.ts
  var CONTAINER_GLOW_STRATEGY = "all";
  var HINT_CHARS = "sadgjklewcmpoh";
  var DRIFT_THRESHOLD = 5;
  var DRIFT_CHECK_INTERVAL = 200;
  var HintMode = class _HintMode {
    constructor(keyHandler) {
      this.keyHandler = keyHandler;
      this.active = false;
      this.willOpenNewTab = false;
      this.hints = [];
      this.typed = "";
      this.overlay = null;
      this.activating = false;
      this.onMouseDown = this.deactivate.bind(this);
      this.onScroll = this.deactivate.bind(this);
      this.onResize = this.deactivate.bind(this);
      this.driftTimer = null;
      this.hintPlacementMap = /* @__PURE__ */ new Map();
    }
    // --- Public API ---
    activate(shiftHeld) {
      if (this.active) {
        this.deactivate();
        return;
      }
      this.willOpenNewTab = shiftHeld;
      this.active = true;
      this.typed = "";
      this.keyHandler.setMode(Mode.HINTS);
      const elements = discoverElements((el) => this.getHintRect(el));
      if (elements.length === 0) {
        this.deactivate();
        return;
      }
      const containerGroups = /* @__PURE__ */ new Map();
      for (const el of elements) {
        const rect = this.getHintRect(el);
        const target = this.getHintTargetElement(el);
        const container = target === el ? getRepeatingContainer(el) : null;
        if (container && CONTAINER_GLOW_STRATEGY !== "none") {
          const noNestedLinks = !elements.some((other) => other !== el && container.contains(other) && !hasListBoundaryBetween(container, other));
          const containerRect = container.getBoundingClientRect();
          const sized = isLargeEnoughForGlow(container, containerRect);
          const parent = container.parentElement || container;
          let group = containerGroups.get(parent);
          if (!group) {
            group = [];
            containerGroups.set(parent, group);
          }
          group.push({ el, rect, container, noNestedLinks, sized });
        } else {
          this.hintPlacementMap.set(el, { style: "pill", rect });
        }
      }
      for (const [, group] of containerGroups) {
        const allFreeOfNestedHints = group.every((g) => g.noNestedLinks);
        const groupSized = CONTAINER_GLOW_STRATEGY === "any" ? group.some((g) => g.sized) : group.every((g) => g.sized);
        const useGlow = allFreeOfNestedHints && groupSized;
        for (const { el, rect, container } of group) {
          if (useGlow) {
            this.hintPlacementMap.set(el, { style: "containerGlow", rect, container });
          } else {
            this.hintPlacementMap.set(el, { style: "pill", rect });
          }
        }
      }
      const labels = _HintMode.generateLabels(elements.length);
      this.createOverlay();
      if (this.overlay) renderDebugDots(this.overlay, elements);
      this.hints = elements.map((el, i) => {
        const label = labels[i];
        const div = this.createHintDiv(el, label);
        return { element: el, label, div };
      });
      this.keyHandler.setModeKeyDelegate(this.handleKey.bind(this));
      document.addEventListener("mousedown", this.onMouseDown, true);
      window.addEventListener("scroll", this.onScroll, true);
      window.addEventListener("resize", this.onResize);
      this.startDriftCheck();
    }
    deactivate() {
      if (!this.active) return;
      this.active = false;
      this.typed = "";
      this.willOpenNewTab = false;
      this.activating = false;
      this.keyHandler.clearModeKeyDelegate();
      document.removeEventListener("mousedown", this.onMouseDown, true);
      window.removeEventListener("scroll", this.onScroll, true);
      window.removeEventListener("resize", this.onResize);
      if (this.driftTimer !== null) {
        clearInterval(this.driftTimer);
        this.driftTimer = null;
      }
      for (const ring of document.documentElement.querySelectorAll(".vimium-hint-ring:not(.vimium-hint-ring-out)")) {
        ring.remove();
      }
      if (this.overlay) {
        this.overlay.classList.remove("visible");
        const overlay = this.overlay;
        overlay.addEventListener("transitionend", () => {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, { once: true });
        this.overlay = null;
      }
      this.hints = [];
      this.hintPlacementMap.clear();
      this.keyHandler.setMode(Mode.NORMAL);
    }
    isActive() {
      return this.active;
    }
    wireCommands() {
      this.keyHandler.on("activateHints", () => this.activate(false));
      this.keyHandler.on("activateHintsNewTab", () => this.activate(true));
    }
    unwireCommands() {
      this.keyHandler.off("activateHints");
      this.keyHandler.off("activateHintsNewTab");
    }
    destroy() {
      this.deactivate();
      this.unwireCommands();
    }
    // --- Layout drift detection ---
    /** Periodically check whether hinted elements have shifted from their
     *  original positions. Dismisses hints when a majority of sampled
     *  elements have drifted, indicating a real layout shift rather than
     *  a single animated element (e.g. Amazon carousel). */
    startDriftCheck() {
      const MAX_SAMPLE = 5;
      const entries = [...this.hintPlacementMap.keys()];
      const step = Math.max(1, Math.floor(entries.length / MAX_SAMPLE));
      const sample = [];
      for (let i = 0; i < entries.length && sample.length < MAX_SAMPLE; i += step) {
        sample.push([entries[i], entries[i].getBoundingClientRect()]);
      }
      this.driftTimer = setInterval(() => {
        let drifted = 0;
        for (const [el, original] of sample) {
          const current = el.getBoundingClientRect();
          if (Math.abs(current.top - original.top) > DRIFT_THRESHOLD || Math.abs(current.left - original.left) > DRIFT_THRESHOLD) {
            drifted++;
          }
        }
        if (drifted > sample.length / 2) {
          this.deactivate();
        }
      }, DRIFT_CHECK_INTERVAL);
    }
    // --- Hint target element ---
    getHintTargetElement(el) {
      const rect = el.getBoundingClientRect();
      if (isRedirectableControl(el) && !isVisible(el, rect)) {
        const label = findAssociatedLabel(el);
        if (label) return label;
      }
      if (isZeroSizeAnchor(el, rect)) {
        const child = findVisibleChild(el);
        if (child) return child;
      }
      if (shouldRedirectToHeading(el)) {
        return getHeading(el);
      }
      return el;
    }
    getHintRect(el) {
      const target = this.getHintTargetElement(el);
      let rect = target.getBoundingClientRect();
      if (el === target && el.tagName.toLowerCase() === "a") {
        rect = getLinkContentRect(target, rect);
      }
      if (!isFormControl(target)) {
        rect = getBlockAncestorRect(target, rect) ?? rect;
      }
      return rect;
    }
    // --- Label generation ---
    static generateLabels(count) {
      if (count <= 0) return [];
      const chars = HINT_CHARS.split("");
      const base = chars.length;
      let len = 1;
      let capacity = base;
      while (capacity < count) {
        len++;
        capacity = Math.pow(base, len);
      }
      const labels = [];
      for (let i = 0; i < count; i++) {
        let label = "";
        let n = i;
        for (let d = len - 1; d >= 0; d--) {
          const divisor = Math.pow(base, d);
          const idx = Math.floor(n / divisor);
          label += chars[idx];
          n %= divisor;
        }
        labels.push(label);
      }
      return labels;
    }
    // --- Overlay rendering ---
    viewportToDocument(x, y) {
      const docEl = document.documentElement;
      const rect = docEl.getBoundingClientRect();
      const style = getComputedStyle(docEl);
      if (style.position === "static" && !/content|paint|strict/.test(style.contain || "")) {
        const marginTop = parseFloat(style.marginTop) || 0;
        const marginLeft = parseFloat(style.marginLeft) || 0;
        return { x: x - rect.left + marginLeft, y: y - rect.top + marginTop };
      } else {
        const clientTop = docEl.clientTop;
        const clientLeft = docEl.clientLeft;
        return { x: x - rect.left - clientLeft, y: y - rect.top - clientTop };
      }
    }
    createOverlay() {
      const stale = document.documentElement.querySelector(".vimium-hint-overlay");
      if (stale) stale.remove();
      this.overlay = document.createElement("div");
      this.overlay.className = `vimium-hint-overlay${DEFAULTS.animate ? " vimium-hint-animate" : ""}`;
      document.documentElement.appendChild(this.overlay);
      void this.overlay.offsetHeight;
      this.overlay.classList.add("visible");
    }
    createHintDiv(element, label) {
      const placement = this.hintPlacementMap.get(element);
      const div = document.createElement("div");
      div.className = "vimium-hint";
      div.textContent = label;
      if (placement) {
        switch (placement.style) {
          case "containerGlow":
            this.positionContainerGlow(div, placement.container);
            break;
          case "pill":
            this.positionPill(div, placement.rect);
            break;
        }
      }
      if (this.overlay) this.overlay.appendChild(div);
      return div;
    }
    /** Glow border on repeating container + inside-end pill label. */
    positionContainerGlow(div, container) {
      const glowRect = container.getBoundingClientRect();
      const glow = document.createElement("div");
      glow.className = "vimium-hint-container-glow";
      const glowPos = this.viewportToDocument(glowRect.left, glowRect.top);
      glow.style.left = glowPos.x + "px";
      glow.style.top = glowPos.y + "px";
      glow.style.width = glowRect.width + "px";
      glow.style.height = glowRect.height + "px";
      if (this.overlay) this.overlay.appendChild(glow);
      const verticalInset = (glowRect.height - HINT_HEIGHT) / 2;
      const insetRight = Math.min(verticalInset, 24);
      const pos = this.viewportToDocument(
        glowRect.right - insetRight,
        glowRect.top + glowRect.height / 2
      );
      div.style.left = pos.x + "px";
      div.style.top = pos.y + "px";
      div.style.transform = "translate(-100%, -50%)";
    }
    /** Pill below element with pointer tail. */
    positionPill(div, rect) {
      const pos = this.viewportToDocument(rect.left + rect.width / 2, rect.bottom + 2);
      div.style.left = Math.max(0, pos.x) + "px";
      div.style.top = Math.max(0, pos.y) + "px";
      div.style.transform = "translateX(-50%)";
      const tail = document.createElement("div");
      tail.className = "vimium-hint-tail";
      div.appendChild(tail);
    }
    // --- Key handling ---
    handleKey(event) {
      if (!this.active) return false;
      if (this.activating) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
      if (event.code === "KeyF" && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        this.deactivate();
        return true;
      }
      if (event.code === "Escape") return false;
      event.preventDefault();
      event.stopPropagation();
      if (event.code === "Backspace") {
        if (this.typed.length > 0) {
          this.typed = this.typed.slice(0, -1);
          this.updateHintVisibility();
        }
        return true;
      }
      const char = event.key ? event.key.toLowerCase() : "";
      if (!HINT_CHARS.includes(char) || char.length !== 1) {
        this.deactivate();
        return true;
      }
      this.typed += char;
      this.updateHintVisibility();
      if (!this.hints.some((h) => h.label.startsWith(this.typed))) {
        this.deactivate();
        return true;
      }
      const match = this.hints.find((h) => h.label === this.typed);
      if (match) {
        if (event.shiftKey) {
          this.willOpenNewTab = true;
        }
        this.activateHint(match);
      }
      return true;
    }
    updateHintVisibility() {
      for (const hint of this.hints) {
        const matches = hint.label.startsWith(this.typed);
        hint.div.style.display = matches ? "" : "none";
        if (matches) {
          const matched = hint.label.slice(0, this.typed.length);
          const remaining = hint.label.slice(this.typed.length);
          hint.div.innerHTML = "";
          if (matched) {
            const span = document.createElement("span");
            span.className = "vimium-hint-matched";
            span.textContent = matched;
            hint.div.appendChild(span);
          }
          hint.div.appendChild(document.createTextNode(remaining));
        }
      }
    }
    activateHint(hint) {
      const element = hint.element;
      const newTab = this.willOpenNewTab;
      this.activating = true;
      for (const h of this.hints) {
        if (h !== hint) h.div.style.display = "none";
      }
      const placement = this.hintPlacementMap.get(element);
      if (!placement) return;
      const targetRect = placement.rect;
      const tagRect = hint.div.getBoundingClientRect();
      if (tagRect.width > 0) {
        const dx = targetRect.left + targetRect.width / 2 - (tagRect.left + tagRect.width / 2);
        const dy = targetRect.top + targetRect.height / 2 - (tagRect.top + tagRect.height / 2);
        hint.div.style.setProperty("--poof-x", dx + "px");
        hint.div.style.setProperty("--poof-y", dy + "px");
      }
      hint.div.classList.add("vimium-hint-active");
      const ring = document.createElement("div");
      ring.className = "vimium-hint-ring";
      const ringRect = element.getBoundingClientRect();
      const pos = this.viewportToDocument(ringRect.left, ringRect.top);
      ring.style.left = pos.x - 2 + "px";
      ring.style.top = pos.y - 2 + "px";
      ring.style.width = ringRect.width + 4 + "px";
      ring.style.height = ringRect.height + 4 + "px";
      document.documentElement.appendChild(ring);
      const afterCollapse = () => {
        const wasActive = this.active;
        this.deactivate();
        if (!wasActive) {
          ring.remove();
          return;
        }
        const isLink = element.tagName.toLowerCase() === "a" && element.href;
        const opensNewWindow = isLink && (newTab || element.target === "_blank");
        if (opensNewWindow) {
          browser.runtime.sendMessage({
            command: "createTab",
            url: element.href
          });
        } else {
          element.focus();
          element.style.outline = "none";
          element.addEventListener("blur", () => {
            element.style.outline = "";
          }, { once: true });
          const opts = { bubbles: true, cancelable: true, view: window };
          element.dispatchEvent(new MouseEvent("mousedown", opts));
          element.dispatchEvent(new MouseEvent("mouseup", opts));
          element.click();
        }
        ring.classList.add("vimium-hint-ring-out");
        ring.addEventListener("animationend", () => ring.remove(), { once: true });
      };
      hint.div.addEventListener("animationend", afterCollapse, { once: true });
    }
  };

  // tests/integration/harness.ts
  window.TestHarness = {
    KeyHandler,
    HintMode,
    Mode,
    walkerFilter,
    predicates: {
      isExcludedByIntent,
      childrenCannotBeVisible,
      isOnScreen,
      isVisible,
      isClippedByOverflow,
      isOccluded,
      hasBox
    }
  };
})();
