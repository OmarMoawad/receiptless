import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated Prisma client: thousands of require() imports and
    // TypeScript suppression comments we neither wrote nor can fix.
    // Linting it made `npm run lint` report 729 errors and rendered the
    // whole signal useless, which is part of why CI never gated on it.
    "src/generated/**",
    // Agent worktrees are checkouts of this same repo — linting them
    // double-counts every finding and reports paths that do not exist on
    // the branch being linted.
    ".worktrees/**",
  ]),
]);

export default eslintConfig;
