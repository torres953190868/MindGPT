import {
  getSecurityEventRepository,
  type CreateSecurityEventInput,
  type SecurityEvent,
  type SecurityEventRepository,
} from "@/lib/observability/security-event-repository";

export type RecordSecurityEventInput = CreateSecurityEventInput;

export async function recordSecurityEvent(
  input: RecordSecurityEventInput,
  repository?: SecurityEventRepository,
): Promise<SecurityEvent> {
  return (repository ?? getSecurityEventRepository()).createSecurityEvent({
    ...input,
    metadata: input.metadata ?? {},
  });
}

/** Audit logging must never block research or agent execution. */
export async function recordSecurityEventBestEffort(
  input: RecordSecurityEventInput,
  repository?: SecurityEventRepository,
): Promise<SecurityEvent | null> {
  try {
    return await recordSecurityEvent(input, repository);
  } catch {
    return null;
  }
}
