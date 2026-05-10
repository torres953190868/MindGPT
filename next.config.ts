import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

function getDistDir(phase: string) {
  if (phase === PHASE_DEVELOPMENT_SERVER) return ".next-dev";

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
