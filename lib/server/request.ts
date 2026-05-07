export const REQUEST_ID_HEADER = "x-request-id";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const REQUEST_ID_PREFIX = "req_";

function normalizeRequestId(value: string | null | undefined) {
  const requestId = value?.trim();
  return requestId && REQUEST_ID_PATTERN.test(requestId) ? requestId : null;
}

function createCompactRandomId() {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = new Uint8Array(24);

  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function createRequestId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `${REQUEST_ID_PREFIX}${createCompactRandomId()}`;
}

export function getRequestId(request: Request | { headers: Headers }) {
  return normalizeRequestId(request.headers.get(REQUEST_ID_HEADER));
}

export function getOrCreateRequestId(request?: Request | { headers: Headers }) {
  return request ? getRequestId(request) ?? createRequestId() : createRequestId();
}

export function withRequestIdHeader(
  headers: HeadersInit | undefined,
  requestId: string,
) {
  const nextHeaders = new Headers(headers);
  nextHeaders.set(REQUEST_ID_HEADER, requestId);
  return nextHeaders;
}
