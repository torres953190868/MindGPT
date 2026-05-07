import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

function getDistDir(phase: string) {
  if (phase === PHASE_DEVELOPMENT_SERVER) return ".next/development";

  return ".next";
}

const createNextConfig = (phase: string): NextConfig => ({
  reactStrictMode: true,
  distDir: getDistDir(phase),
});

export default createNextConfig;
