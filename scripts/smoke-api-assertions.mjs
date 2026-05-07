import { fetchWithTimeout, withCookie } from "./smoke-utils.mjs";

export async function assertJsonStatus(
  baseUrl,
  routePath,
  expectedStatus,
  init,
  expectedError,
) {
  const response = await fetchWithTimeout(`${baseUrl}${routePath}`, 10_000, init);
  const body = await response.text();

  if (response.status !== expectedStatus) {
    throw new Error(
      `${routePath} returned ${response.status}, expected ${expectedStatus}: ${body.slice(0, 500)}`,
    );
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`${routePath} did not return JSON: ${body.slice(0, 500)}`);
  }

  const error = data?.error;
  if (!error || typeof error !== "object") {
    throw new Error(`${routePath} did not return the API error object.`);
  }

  if (typeof error.requestId !== "string" || !error.requestId) {
    throw new Error(`${routePath} did not return error.requestId.`);
  }

  const headerRequestId = response.headers.get("x-request-id");
  if (headerRequestId && headerRequestId !== error.requestId) {
    throw new Error(
      `${routePath} returned requestId ${error.requestId}, expected header ${headerRequestId}.`,
    );
  }

  const expectedMessage =
    typeof expectedError === "string" ? expectedError : expectedError?.message;
  const expectedCode =
    expectedError && typeof expectedError === "object" ? expectedError.code : undefined;

  if (expectedMessage && error.message !== expectedMessage) {
    throw new Error(
      `${routePath} returned error message "${error.message}", expected "${expectedMessage}".`,
    );
  }

  if (expectedCode && error.code !== expectedCode) {
    throw new Error(
      `${routePath} returned error code "${error.code}", expected "${expectedCode}".`,
    );
  }

  console.log(`Checked ${routePath}: ${response.status}`);
}

export async function readProjectCount(baseUrl, sessionCookie) {
  const response = await fetchWithTimeout(
    `${baseUrl}/api/projects`,
    10_000,
    withCookie(sessionCookie),
  );
  const data = await response.json();
  return Array.isArray(data.projects) ? data.projects.length : 0;
}
