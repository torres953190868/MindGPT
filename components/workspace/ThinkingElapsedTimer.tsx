"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/components/language/LanguageProvider";

/**
 * Counts elapsed seconds while mounted. Mount it alongside a streaming/thinking
 * indicator and unmount it when the wait ends.
 */
export function ThinkingElapsedTimer() {
  const { copy } = useLanguage();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <span aria-hidden="true" data-testid="thinking-elapsed-timer">
      {copy.workspace.thinkingElapsed(elapsedSeconds)}
    </span>
  );
}
