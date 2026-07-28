"use client";

import { useEffect } from "react";
import type { ElementInspector } from "@/lib/element-inspector";

const HELPER_SRC = "/useElementInspector.js";

export function ElementInspectorPlugin() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") {
      return;
    }

    let inspector: ElementInspector | null = null;

    const init = () => {
      if (inspector || typeof window.createElementInspector !== "function") {
        return;
      }

      // NOTE: use Ctrl as the modifier, not Alt/Option. On macOS `Option + <letter>`
      // produces an alternate glyph or dead key, so `event.key` is never the base
      // letter ("i") and the helper's hotkey match would never fire. Ctrl+I keeps
      // `event.key === "i"` on all platforms.
      inspector = window.createElementInspector({
        hotkey: "i",
        hotkeyModifier: "ctrl",
        onSelect: (info) => {
          console.info("[ElementInspector] copied selector:", info.selector);
        },
      });
    };

    let script = document.querySelector<HTMLScriptElement>(
      `script[data-element-inspector="true"]`,
    );

    if (!script) {
      script = document.createElement("script");
      script.src = HELPER_SRC;
      script.async = true;
      script.dataset.elementInspector = "true";
      script.addEventListener("load", init);
      script.addEventListener("error", () => {
        console.warn(`[ElementInspector] failed to load helper from ${HELPER_SRC}`);
      });
      document.body.appendChild(script);
    } else {
      script.addEventListener("load", init);
      init();
    }

    return () => {
      inspector?.destroy();
      inspector = null;
    };
  }, []);

  return null;
}
