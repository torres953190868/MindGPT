import net from "node:net";

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithTimeout(url, timeoutMs, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export function withCookie(cookie, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", cookie);
  return { ...init, headers };
}

export function extractCookie(setCookie, cookieName) {
  const cookie = setCookie.split(";")[0];
  return cookie.startsWith(`${cookieName}=`) ? cookie : "";
}

export async function getAvailablePort(listenHost) {
  const server = net.createServer();

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, listenHost, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to allocate a smoke test port.")));
        return;
      }

      server.close(() => resolve(address.port));
    });
  });
}

export function formatError(error) {
  if (!error) return "";
  return error instanceof Error ? error.message : String(error);
}
