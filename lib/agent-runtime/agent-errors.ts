// Agent runtime error type (spec §8.12/§11.4). Mirrors DeepSeekError's
// shape (code/expose/retryable/status) so API routes can translate agent
// failures the same way they translate provider failures: `expose` decides
// whether the message may reach the client, `status` is the HTTP status when
// the error bubbles out of a route, and `retryable` tells runners whether
// re-running the failed unit has any chance of succeeding.

export type AgentErrorCode =
  | "AGENT_BUDGET_EXHAUSTED"
  | "AGENT_RUN_CANCELLED"
  | "AGENT_RUN_NOT_FOUND"
  | "AGENT_RUN_CONFLICT"
  | "AGENT_INVALID_MODEL_OUTPUT"
  | "AGENT_TOOL_ERROR"
  | "AGENT_STAGE_FAILED"
  | "AGENT_RESUME_NOT_ALLOWED"
  | "AGENT_MODEL_CALL_FAILED"
  | "AGENT_MOCK_SCRIPT_EXHAUSTED";

export class AgentError extends Error {
  code: AgentErrorCode | string;
  expose: boolean;
  retryable: boolean;
  status: number;
  details?: unknown;

  constructor(
    message: string,
    options: {
      code?: AgentErrorCode | string;
      expose?: boolean;
      retryable?: boolean;
      status?: number;
      details?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "AgentError";
    this.code = options.code ?? "AGENT_ERROR";
    this.expose = options.expose ?? false;
    this.retryable = options.retryable ?? false;
    this.status = options.status ?? 500;
    this.details = options.details;
  }
}

export function isAgentError(error: unknown): error is AgentError {
  return error instanceof AgentError;
}
