import { NextResponse } from "next/server";
import type { BranchMindSession } from "@/lib/server/session";
import { commitSessionCookie } from "@/lib/server/session";
import { createRequestId, withRequestIdHeader } from "@/lib/server/request";

type JsonBody = unknown;

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
};

export type JsonResponseOptions = {
  requestId?: string;
};

export type ErrorResponseOptions = JsonResponseOptions & {
  code?: string;
  details?: unknown;
};

export class HttpError extends Error {
  code: string;
  details?: unknown;
  expose: boolean;
  status: number;

  constructor(
    message: string,
    options: {
      code?: string;
      details?: unknown;
      expose?: boolean;
      status?: number;
    } = {},
  ) {
    super(message);
    this.name = "HttpError";
    this.code = options.code ?? getDefaultErrorCode(options.status ?? 500);
    this.details = options.details;
    this.expose = options.expose ?? false;
    this.status = options.status ?? 500;
  }
}

function getDefaultErrorCode(status: number) {
  if (status === 400) return "BAD_REQUEST";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 413) return "BODY_TOO_LARGE";
  if (status === 415) return "UNSUPPORTED_CONTENT_TYPE";
  if (status === 422) return "VALIDATION_FAILED";
  if (status === 429) return "TOO_MANY_REQUESTS";
  if (status === 502) return "UPSTREAM_ERROR";
  if (status === 504) return "UPSTREAM_TIMEOUT";
  return status >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_FAILED";
}

function getObject(error: unknown): Record<string, unknown> | null {
  return error && typeof error === "object"
    ? (error as Record<string, unknown>)
    : null;
}

function getErrorMessageFromBody(body: JsonBody) {
  const payload = getObject(body);
  const error = payload?.error;

  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }

  return null;
}

function getErrorCodeFromBody(body: JsonBody) {
  const error = getObject(getObject(body)?.error);
  const code = error?.code;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}

function getErrorDetailsFromBody(body: JsonBody) {
  const error = getObject(getObject(body)?.error);
  return error?.details;
}

function getErrorCode(error: unknown, status: number) {
  const code = getObject(error)?.code;
  return typeof code === "string" && code.trim()
    ? code.trim()
    : getDefaultErrorCode(status);
}

function getErrorDetails(error: unknown) {
  const object = getObject(error);
  return object?.details ?? object?.issues;
}

function isExposableError(error: unknown, status: number) {
  return status < 500 && getObject(error)?.expose === true;
}

function withResponseHeaders(init: ResponseInit | undefined, requestId: string) {
  return {
    ...init,
    headers: withRequestIdHeader(init?.headers, requestId),
  };
}

export function createApiErrorBody(
  message: string,
  status: number,
  requestId: string,
  options: ErrorResponseOptions = {},
): ApiErrorBody {
  const body: ApiErrorBody = {
    error: {
      code: options.code ?? getDefaultErrorCode(status),
      message,
      requestId,
    },
  };

  if (options.details !== undefined) {
    body.error.details = options.details;
  }

  return body;
}

function normalizeErrorBody(body: JsonBody, status: number, requestId: string) {
  return createApiErrorBody(
    getErrorMessageFromBody(body) ?? getSafeErrorMessage(status),
    status,
    requestId,
    {
      code: getErrorCodeFromBody(body) ?? getDefaultErrorCode(status),
      details: getErrorDetailsFromBody(body),
    },
  );
}

export function jsonWithSession(
  body: JsonBody,
  session: BranchMindSession,
  init?: ResponseInit,
  options: JsonResponseOptions = {},
) {
  const requestId = options.requestId ?? createRequestId();
  const status = init?.status ?? 200;
  const responseBody =
    status >= 400
      ? normalizeErrorBody(body, status, requestId)
      : body;

  return commitSessionCookie(
    NextResponse.json(responseBody, withResponseHeaders(init, requestId)),
    session,
  );
}

export function errorWithSession(
  message: string,
  status: number,
  session: BranchMindSession,
  options: ErrorResponseOptions = {},
) {
  const requestId = options.requestId ?? createRequestId();

  return jsonWithSession(
    createApiErrorBody(message, status, requestId, options),
    session,
    { status },
    { requestId },
  );
}

export function getSafeErrorStatus(error: unknown) {
  const status = Number(getObject(error)?.status ?? 500);

  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    return status;
  }

  return 500;
}

export function getSafeErrorMessage(status: number, error?: unknown) {
  const message = getObject(error)?.message;
  if (typeof message === "string" && isExposableError(error, status)) {
    return message;
  }

  if (status === 429) return "Too many requests.";
  if (status === 413) return "Request body is too large.";
  if (status === 415) return "Unsupported content type.";
  if (status === 504) return "Upstream request timed out.";
  if (status === 502) return "Upstream request failed.";
  if (status >= 500) return "Request failed.";
  return "Request failed.";
}

export function safeErrorWithSession(
  error: unknown,
  session: BranchMindSession,
  options: JsonResponseOptions = {},
) {
  const status = getSafeErrorStatus(error);
  return errorWithSession(getSafeErrorMessage(status, error), status, session, {
    code: getErrorCode(error, status),
    details: isExposableError(error, status) ? getErrorDetails(error) : undefined,
    requestId: options.requestId,
  });
}
