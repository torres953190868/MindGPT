// Feature flags for the dual-agent learning system refactor (Phase 0).
// Both agents ship disabled by default and are only active in environments
// that explicitly opt in. Truthy parsing matches the AI_MOCK_MODE convention
// in lib/server/deepseek-core.ts.

function isEnabled(value: string | undefined) {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

// ENABLE_CURRICULUM_AGENT gates the curriculum builder agent. Default: false.
export function isCurriculumAgentEnabled(): boolean {
  return isEnabled(process.env.ENABLE_CURRICULUM_AGENT);
}

// ENABLE_TUTOR_AGENT gates the tutor agent. Default: false.
export function isTutorAgentEnabled(): boolean {
  return isEnabled(process.env.ENABLE_TUTOR_AGENT);
}

export function isAnyAgentEnabled(): boolean {
  return isCurriculumAgentEnabled() || isTutorAgentEnabled();
}
