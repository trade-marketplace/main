import type { NextConfig } from "next";

import { SECURITY_HEADERS } from "./src/lib/security-headers";
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
  // Next's invocation logger prints action arguments, including bank/IRD numbers and current passwords.
  // Keep request diagnostics, but never let the framework write private form values to the terminal.
  logging: { serverFunctions: false },
  // The pure G05 renderer reads this immutable file when the actual creation transaction freezes its message.
  outputFileTracingIncludes: { "/*": ["./src/styles/tokens.css", "./public/firebase-messaging-worker.js"] },
  // Clickjacking, sniffing, referrer and HTTPS headers on every response (#220, src/lib/security-headers.ts).
  async headers() {
    return [{ source: "/:path*", headers: [...SECURITY_HEADERS] }];
  },
};

export default nextConfig;
