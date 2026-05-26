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

const createNextConfig = (phase: string): NextConfig => ({
  reactStrictMode: true,
  distDir: getDistDir(phase),
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
