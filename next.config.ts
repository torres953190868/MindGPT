import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

function getArgValue(flags: string[]) {
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    for (const flag of flags) {
      if (arg === flag) return process.argv[index + 1] ?? null;
      if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
    }
  }

  return null;
}

function getDevDistDir() {
  const rawPort = process.env.PORT ?? getArgValue(["-p", "--port"]);
  if (!rawPort) return ".next-dev";

  return `.next-dev-${rawPort.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function getDistDir(phase: string) {
  if (phase === PHASE_DEVELOPMENT_SERVER) return getDevDistDir();

  return ".next";
}

const isDev = process.env.NODE_ENV !== "production";

// Next.js inline scripts/styles require 'unsafe-inline'; React Refresh in dev
// additionally requires 'unsafe-eval'. KaTeX ships data: fonts, pdfjs-dist
// loads its worker from a same-origin bundle (blob: kept for its fallback),
// and the Supabase client talks to https/wss on *.supabase.co.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "worker-src 'self' blob:",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(isDev
    ? []
    : [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]),
];

const createNextConfig = (phase: string): NextConfig => ({
  reactStrictMode: true,
  distDir: getDistDir(phase),
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  webpack: (config) => {
    const ignored = config.watchOptions?.ignored;
    const ignoredPatterns = Array.isArray(ignored)
      ? ignored.filter((pattern) => typeof pattern === "string" && pattern.length > 0)
      : typeof ignored === "string" && ignored
        ? [ignored]
        : [];

    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        ...ignoredPatterns,
        "**/data/**",
        "**/test-results/**",
        "**/playwright-report/**",
      ],
    };

    return config;
  },
});

export default createNextConfig;
