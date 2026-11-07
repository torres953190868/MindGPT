import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Reports errors that escape route handlers, server components, and server
// actions. Routes that catch errors themselves report 5xx via `logApiError`
// in `lib/server/http.ts`, so nothing is reported twice. No-op without a DSN.
export const onRequestError = Sentry.captureRequestError;
