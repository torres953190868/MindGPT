import { createHash } from "node:crypto";
import { recordSecurityEventBestEffort } from "@/lib/observability/security-event-service";

export type PromptInjectionSignal = {
  code: "PROMPT_INJECTION_INSTRUCTION" | "PROMPT_INJECTION_SECRET_REQUEST" | "PROMPT_INJECTION_TOOL_REQUEST";
  matchCount: number;
  textHash: string;
  textLength: number;
  domain: string | null;
};

export type PromptInjectionLogContext = {
  userId?: string | null;
  runId?: string | null;
  requestId?: string | null;
  stepId?: string | null;
};

const SIGNALS: Array<{ code: PromptInjectionSignal["code"]; pattern: RegExp }> = [
  {
    code: "PROMPT_INJECTION_INSTRUCTION",
    pattern: /(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?|忽略(?:之前|以上|先前)的指令/giu,
  },
  {
    code: "PROMPT_INJECTION_SECRET_REQUEST",
    pattern: /(?:reveal|show|print|泄露|输出).{0,40}(?:system prompt|developer message|api key|secret|系统提示|密钥)/giu,
  },
  {
    code: "PROMPT_INJECTION_TOOL_REQUEST",
    pattern: /(?:call|execute|run|调用|执行).{0,40}(?:tool|function|shell|命令|工具)/giu,
  },
];

function domainOf(url: string | undefined) {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function detectPromptInjectionSignals(text: string, url?: string): PromptInjectionSignal[] {
  if (!text.trim()) return [];
  const textHash = createHash("sha256").update(text).digest("hex");
  return SIGNALS.flatMap(({ code, pattern }) => {
    const matches = text.match(pattern);
    return matches?.length
      ? [{ code, matchCount: matches.length, textHash, textLength: text.length, domain: domainOf(url) }]
      : [];
  });
}

/** Logs and persists only hash/length/domain/rule; never the untrusted page text. */
export async function logPromptInjectionSignals(
  text: string,
  url?: string,
  runIdOrContext?: string | PromptInjectionLogContext,
  stepId?: string,
  context: PromptInjectionLogContext = {},
): Promise<void> {
  const logContext: PromptInjectionLogContext =
    typeof runIdOrContext === "string"
      ? { ...context, runId: runIdOrContext, stepId: stepId ?? context.stepId }
      : {
          ...runIdOrContext,
          ...context,
          stepId: stepId ?? context.stepId ?? runIdOrContext?.stepId,
        };
  const signals = detectPromptInjectionSignals(text, url);

  for (const signal of signals) {
    console.warn("BranchMind prompt injection signal", {
      ...signal,
      runId: logContext.runId ?? null,
      stepId: logContext.stepId ?? null,
      requestId: logContext.requestId ?? null,
    });
  }

  await Promise.all(
    signals.map((signal) =>
      recordSecurityEventBestEffort({
        userId: logContext.userId ?? null,
        runId: logContext.runId ?? null,
        rule: signal.code,
        domain: signal.domain,
        contentHash: signal.textHash,
        metadata: {
          match_count: signal.matchCount,
          text_length: signal.textLength,
          step_id: logContext.stepId ?? null,
          request_id: logContext.requestId ?? null,
        },
      }).catch(() => null),
    ),
  );
}
