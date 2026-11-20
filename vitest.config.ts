import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "server-only": at("./tests/stubs/server-only.ts"),
      "@/": at("./"),
    },
  },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
