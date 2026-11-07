// Browser Sentry setup, loaded by Next.js before the app becomes interactive.
// Inert unless NEXT_PUBLIC_SENTRY_DSN is set at build time.
import * as Sentry from "@sentry/nextjs";
import { getSentryInitOptions } from "@/lib/observability/sentry";

// `process.env.NEXT_PUBLIC_*` must be referenced literally so Next.js inlines it.
const sentryOptions = getSentryInitOptions("client", {
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
  NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
  NODE_ENV: process.env.NODE_ENV,
});

if (sentryOptions) {
  Sentry.init({
    ...sentryOptions,
    // Session Replay stays off: it would record conversation and PDF content.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
