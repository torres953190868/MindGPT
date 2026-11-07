import { createSentryTunnelRoute } from "@sentry/nextjs/tunnel";
import { getSentryDsn } from "@/lib/observability/sentry";

// Target of the `/monitoring` tunnel rewrite added by `withSentryConfig` in
// `next.config.ts`. Forwarding through this handler (instead of a plain rewrite)
// sends only the envelope to Sentry: no cookies, auth headers, or client IP.
// It accepts envelopes for the browser DSN only, so it cannot be used as an
// open proxy; it is intentionally not origin-checked or rate-limited because
// the browser SDK posts error reports here, including while the app is failing.
const browserDsn = getSentryDsn("client", {
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
});
const tunnel = browserDsn ? createSentryTunnelRoute({ allowedDsns: [browserDsn] }) : null;

export async function POST(request: Request) {
  if (!tunnel) return new Response(null, { status: 404 });
  return tunnel.POST(request);
}
