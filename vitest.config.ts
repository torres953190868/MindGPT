import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  // tsconfig uses `"jsx": "preserve"` for Next.js; component tests need JSX compiled.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  resolve: {
    alias: {
      "@": rootDir,
    },
  },
  test: {
    clearMocks: true,
    exclude: ["node_modules", ".next", "e2e"],
    restoreMocks: true,
    // Two projects share the options above (`extends: true`):
    // - `node`: logic/route tests (`*.test.ts`) in the plain Node environment.
    // - `dom`: React component tests (`*.test.tsx`) in jsdom with Testing Library.
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["tests/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["tests/**/*.test.tsx"],
          setupFiles: ["tests/setup/dom.ts"],
          unstubGlobals: true,
        },
      },
    ],
  },
});
