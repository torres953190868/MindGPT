// Build-time stand-in for `@sentry/nextjs`, aliased in `next.config.ts` only
// when no Sentry DSN is configured. It keeps the SDK (~90 kB of browser JS and
// its OpenTelemetry server instrumentation) out of builds where Sentry is off.
// Export only what BranchMind imports from `@sentry/nextjs`; webpack fails the
// build on a missing export, so new imports must be added here too.

export function init(): undefined {
  return undefined;
}

export function captureException(): string {
  return "";
}

export function captureRequestError(): void {}

export function captureRouterTransitionStart(): void {}
