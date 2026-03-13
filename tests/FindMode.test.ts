// FindMode unit tests — using Node.js built-in test runner + happy-dom
// FindMode is a thin wrapper that dispatches Cmd+F to trigger Safari's
// native find bar. Tests verify command wiring, lifecycle, and cleanup.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createDOM, type DOMEnvironment } from "./helpers/dom";
import { KeyHandler } from "../src/modules/KeyHandler";
import { FindMode } from "../src/modules/FindMode";

let env: DOMEnvironment;
let keyHandler: KeyHandler;
let findMode: FindMode;
let dispatchedEvents: Event[];

describe("FindMode", () => {
    beforeEach(() => {
        env = createDOM();
        dispatchedEvents = [];

        // Listen for the synthetic Cmd+F keydown events dispatched by FindMode
        env.document.addEventListener("keydown", (event: Event) => {
            const ke = event as KeyboardEvent;
            if (ke.metaKey && ke.key === "f") {
                dispatchedEvents.push(ke);
            }
        });

        keyHandler = new KeyHandler();
        findMode = new FindMode(keyHandler);
    });

    afterEach(() => {
        findMode.destroy();
        keyHandler.destroy();
        env.cleanup();
    });

    describe("native find dispatch", () => {
        // Verifies that the "/" binding synthesizes a Cmd+F keydown event
        // so Safari's built-in find bar opens
        it("dispatches Cmd+F KeyboardEvent on enterFindMode", () => {
            keyHandler._dispatch("enterFindMode");
            assert.equal(dispatchedEvents.length, 1);
            const evt = dispatchedEvents[0] as KeyboardEvent;
            assert.equal(evt.type, "keydown");
            assert.equal(evt.key, "f");
            assert.equal(evt.code, "KeyF");
            assert.equal(evt.metaKey, true);
            assert.equal(evt.bubbles, true);
        });

        // Confirms the command can fire multiple times in a session
        it("dispatches on repeated invocations", () => {
            keyHandler._dispatch("enterFindMode");
            keyHandler._dispatch("enterFindMode");
            assert.equal(dispatchedEvents.length, 2);
        });
    });

    describe("isActive", () => {
        // FindMode delegates entirely to Safari's native find —
        // it never reports itself as active
        it("always returns false (native find manages lifecycle)", () => {
            assert.equal(findMode.isActive(), false);
        });
    });

    describe("deactivate", () => {
        // deactivate is a no-op since native find manages its own lifecycle
        it("is a no-op and does not throw", () => {
            assert.doesNotThrow(() => findMode.deactivate(true));
            assert.doesNotThrow(() => findMode.deactivate(false));
        });
    });

    describe("destroy", () => {
        // After destroy, the enterFindMode command should be unwired
        it("unwires enterFindMode command", () => {
            findMode.destroy();
            keyHandler._dispatch("enterFindMode");
            assert.equal(dispatchedEvents.length, 0);
        });

        // Ensures idempotent cleanup
        it("can be called multiple times without error", () => {
            assert.doesNotThrow(() => {
                findMode.destroy();
                findMode.destroy();
            });
        });
    });
});
