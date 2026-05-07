import { z } from "zod";

export const DEFAULT_MAX_JSON_BODY_BYTES = 64 * 1024;

export type ParseJsonBodyOptions = {
  maxBytes?: number;
  requireJsonContentType?: boolean;
};

export class RequestValidationError extends Error {
  code: string;
  expose = true;
  issues?: Array<{ path: string; message: string }>;
  status: number;

  constructor(
    message: string,
    options: {
      code?: string;
      issues?: Array<{ path: string; message: string }>;
      status?: number;
    } = {},
  ) {
    super(message);
    this.name = "RequestValidationError";
    this.code = options.code ?? "INVALID_REQUEST";
    this.issues = options.issues;
    this.status = options.status ?? 400;
  }
}

function getBodySize(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) return null;

  const bytes = Number(contentLength);
  return Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
}

function getTextByteLength(text: string) {
  return new TextEncoder().encode(text).byteLength;
}

function formatZodIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.length ? issue.path.join(".") : "body",
    message: issue.message,
  }));
}

export function assertRequestBodySize(
  request: Request,
  maxBytes = DEFAULT_MAX_JSON_BODY_BYTES,
) {
  const contentLength = getBodySize(request);

  if (contentLength !== null && contentLength > maxBytes) {
    throw new RequestValidationError("Request body is too large.", {
      code: "BODY_TOO_LARGE",
      status: 413,
    });
  }
}

export async function readSizedTextBody(
  request: Request,
  maxBytes = DEFAULT_MAX_JSON_BODY_BYTES,
) {
  assertRequestBodySize(request, maxBytes);

  const text = await request.text();
  if (getTextByteLength(text) > maxBytes) {
    throw new RequestValidationError("Request body is too large.", {
      code: "BODY_TOO_LARGE",
      status: 413,
    });
  }

  return text;
}

export async function parseJsonBody<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
  options: ParseJsonBodyOptions = {},
): Promise<z.infer<TSchema>> {
  const requireJsonContentType = options.requireJsonContentType ?? true;
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (requireJsonContentType && !contentType.includes("application/json")) {
    throw new RequestValidationError("Content-Type must be application/json.", {
      code: "UNSUPPORTED_CONTENT_TYPE",
      status: 415,
    });
  }

  const text = await readSizedTextBody(
    request,
    options.maxBytes ?? DEFAULT_MAX_JSON_BODY_BYTES,
  );

  if (!text.trim()) {
    throw new RequestValidationError("Request body is required.", {
      code: "BODY_REQUIRED",
    });
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new RequestValidationError("Request body must be valid JSON.", {
      code: "INVALID_JSON",
    });
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new RequestValidationError("Request body failed validation.", {
      code: "VALIDATION_FAILED",
      issues: formatZodIssues(parsed.error),
    });
  }

  return parsed.data;
}
