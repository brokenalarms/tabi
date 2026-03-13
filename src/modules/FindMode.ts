// FindMode — thin wrapper that triggers the native macOS Cmd+F find bar.
// Vimium "/" binding dispatches a synthetic Cmd+F keydown so Safari's
// built-in find handles everything (highlight, n/N, UI).

interface KeyHandlerLike {
  on(command: string, callback: () => void): void;
  off(command: string): void;
}

export class FindMode {
  private _keyHandler: KeyHandlerLike;

  constructor(keyHandler: KeyHandlerLike) {
    this._keyHandler = keyHandler;
    this._keyHandler.on("enterFindMode", () => this._triggerNativeFind());
  }

  private _triggerNativeFind(): void {
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "f",
      code: "KeyF",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    }));
  }

  isActive(): boolean {
    return false;
  }

  deactivate(_clearHighlight: boolean): void {
    // no-op — native find manages its own lifecycle
  }

  destroy(): void {
    this._keyHandler.off("enterFindMode");
  }
}
