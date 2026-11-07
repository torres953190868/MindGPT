// Node.js Sentry setup, imported from `instrumentation.ts`.
// Inert unless SENTRY_DSN or NEXT_PUBLIC_SENTRY_DSN is set.
import * as Sentry from "@sentry/nextjs";
import { getSentryInitOptions } from "@/lib/observability/sentry";

const sentryOptions = getSentryInitOptions("server", process.env);

if (sentryOptions) {
  Sentry.init(sentryOptions);
}
