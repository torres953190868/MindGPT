"use client";

import { useEffect } from "react";
import { createElementInspector, installElementInspectorGlobal } from "@/lib/element-inspector";

export function ElementInspectorPlugin() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") {
      return;
    }

    installElementInspectorGlobal();

    const inspector = createElementInspector({
      hotkey: "i",
      hotkeyModifier: "alt",
      onSelect: (info) => {
        console.info("[ElementInspector] copied selector:", info.selector);
      },
    });

    return () => {
      inspector.destroy();
    };
  }, []);

  return null;
}
