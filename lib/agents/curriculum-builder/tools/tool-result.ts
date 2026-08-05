// Shared result contract for the CurriculumBuilderAgent's read-only tools
// (spec §3.6/§3.7). Tools never throw for expected failures — provider
// outages, permission denials and invalid inputs come back as
// { ok: false, code, message } so the runner can degrade gracefully and
// record the failure in agent_steps. The ONE exception is budget exhaustion:
// AgentError(AGENT_BUDGET_EXHAUSTED) propagates out of every tool and
// terminates the run (spec §11.4: budgets are hard limits).

export type ToolResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

export function toolOk<T>(data: T): ToolResult<T> {
  return { ok: true, data };
}

export function toolError<T>(code: string, message: string): ToolResult<T> {
  return { ok: false, code, message };
}
