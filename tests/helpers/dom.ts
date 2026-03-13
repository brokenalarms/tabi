// Shared happy-dom helper for DOM unit tests.
// Creates a real Window/Document and installs it on globalThis
// so that production code (which references `document`, `window`, etc.)
// works without a manual shim.

import { Window } from "happy-dom";

export interface DOMEnvironment {
  window: Window;
  document: Document;
  cleanup: () => void;
}

/**
 * Spin up a happy-dom Window and install its globals so that code under test
 * can use `document`, `window`, `NodeFilter`, `getComputedStyle`, etc.
 *
 * Call `cleanup()` in afterEach to tear down.
 */
export function createDOM(html?: string): DOMEnvironment {
  const window = new Window({
    innerWidth: 1024,
    innerHeight: 768,
    url: "https://localhost/",
  });
  const document = window.document as unknown as Document;

  if (html) {
    document.body.innerHTML = html;
  }

  // Install globals that production code expects
  (globalThis as any).window = window;
  (globalThis as any).document = document;
  (globalThis as any).NodeFilter = (window as any).NodeFilter;
  (globalThis as any).getComputedStyle = (window as any).getComputedStyle.bind(window);
  (globalThis as any).CSS = (window as any).CSS ?? { escape: (s: string) => s };
  (globalThis as any).DOMRect = (window as any).DOMRect;
  (globalThis as any).HTMLElement = (window as any).HTMLElement;
  (globalThis as any).clearTimeout = globalThis.clearTimeout;

  const cleanup = (): void => {
    window.close();
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).NodeFilter;
    delete (globalThis as any).getComputedStyle;
    delete (globalThis as any).CSS;
    delete (globalThis as any).DOMRect;
    delete (globalThis as any).HTMLElement;
  };

  return { window, document, cleanup };
}
