import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Import Zod through lib/zod.ts, which turns on jitless mode (no CSP eval probe).
    files: ["**/*.{ts,tsx}"],
    ignores: ["lib/zod.ts", "lib/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "zod", allowTypeImports: true, message: "Import { z } from \"@/lib/zod\" (or a relative lib/zod.ts) instead." }] },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "node_modules/**", "next-env.d.ts", "public/**"]),
]);
