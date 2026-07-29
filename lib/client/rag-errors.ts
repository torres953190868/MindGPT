import { ApiRequestError } from "@/lib/client/api";

export type RagServiceErrorCopy = {
  serviceNotReady: string;
  serviceUnavailable: string;
};

export function getRagServiceErrorMessage(
  code: string | null | undefined,
  copy: RagServiceErrorCopy,
): string | null {
  if (code === "RAG_SUPABASE_SCHEMA_ERROR") return copy.serviceNotReady;
  if (code === "RAG_SUPABASE_ERROR") return copy.serviceUnavailable;
  return null;
}

export function getRagRequestErrorMessage(
  error: unknown,
  fallback: string,
  copy: RagServiceErrorCopy,
): string {
  if (error instanceof ApiRequestError) {
    const mapped = getRagServiceErrorMessage(error.code, copy);
    if (mapped) return mapped;
  }

  return error instanceof Error ? error.message : fallback;
}
