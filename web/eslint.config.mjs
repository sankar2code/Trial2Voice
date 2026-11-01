import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // PRD §11: the decision engine is the only component that sets eligibility,
    // and no LLM may take part in that decision.
    files: ["src/lib/engine.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["@anthropic-ai/*"], message: "The decision engine must not use an LLM." },
          { group: ["**/interpreter*", "**/llm*", "**/builder*"], message: "The decision engine must not use an LLM." },
        ],
      }],
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
