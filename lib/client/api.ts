type ApiErrorObject = {
  code?: unknown;
  message?: unknown;
  requestId?: unknown;
};

const GENERIC_ERROR_MESSAGES = new Set([
  "Request failed.",
  "Upstream request failed.",
]);

export class ApiRequestError extends Error {
  code: string | null;
  requestId: string | null;
  status: number;

  constructor(
    message: string,
    options: {
      code?: string | null;
      requestId?: string | null;
      status: number;
    },
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.code = options.code ?? null;
    this.requestId = options.requestId ?? null;
    this.status = options.status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function getErrorObject(payload: unknown): ApiErrorObject | null {
  if (!isRecord(payload)) return null;

  const error = payload.error;
  if (typeof error === "string") return { message: error };
  if (isRecord(error)) return error;

  return null;
}

export function formatApiErrorMessage(payload: unknown, status: number) {
  const error = getErrorObject(payload);
  const message = typeof error?.message === "string" ? error.message : null;
  const requestId =
    typeof error?.requestId === "string" ? error.requestId : null;

  if (message && !GENERIC_ERROR_MESSAGES.has(message)) {
    return requestId ? `${message} (Reference: ${requestId})` : message;
  }

  const code = typeof error?.code === "string" ? error.code : null;
  const context = [
    `HTTP ${status}`,
    code,
    requestId ? `requestId: ${requestId}` : null,
  ].filter(Boolean);

  return context.length > 0
    ? `Request failed. (${context.join(", ")})`
    : "Request failed.";
}

export function formatRequestReference(requestId: string | null | undefined) {
  return requestId ? `Reference: ${requestId}` : null;
}

export function getApiErrorMeta(payload: unknown) {
  const error = getErrorObject(payload);
  return {
    code: typeof error?.code === "string" ? error.code : null,
    requestId: typeof error?.requestId === "string" ? error.requestId : null,
  };
}

export async function readJsonApi<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
  });
  const data = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new ApiRequestError(formatApiErrorMessage(data, response.status), {
      ...getApiErrorMeta(data),
      status: response.status,
    });
  }

  return data as T;
}
