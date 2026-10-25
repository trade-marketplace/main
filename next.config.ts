import type { NextConfig } from "next";

import { EnvError, parseEnv } from "./src/server/env";

// Fail fast, before anything starts, if an environment variable is set up wrong.
try {
  parseEnv(process.env);
} catch (error) {
  if (!(error instanceof EnvError)) throw error;
  console.error(`\n${error.message}\n`);
  process.exit(1);
}

const nextConfig: NextConfig = {
  // Don't let `next dev` add its own block to AGENTS.md: that file holds the founders' rules.
  agentRules: false,
};

export default nextConfig;
