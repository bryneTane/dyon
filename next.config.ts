import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The agent SDKs start their own CLI binaries, located inside their packages: they are loaded from
  // node_modules at runtime instead of being bundled.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "@openai/codex-sdk", "@openai/codex"],
};

export default nextConfig;
