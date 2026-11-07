// Edge runtime Sentry setup (e.g. `app/opengraph-image.tsx`), imported from
// `instrumentation.ts`. Inert unless SENTRY_DSN or NEXT_PUBLIC_SENTRY_DSN is set.
import * as Sentry from "@sentry/nextjs";
import { getSentryInitOptions } from "@/lib/observability/sentry";

const sentryOptions = getSentryInitOptions("edge", process.env);

if (sentryOptions) {
  Sentry.init(sentryOptions);
}
