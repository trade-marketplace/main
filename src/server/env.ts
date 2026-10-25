import { z } from "zod";

// Server-side environment. Every variable is listed, with a comment, in .env.example.
// The database is optional for now: with neither URL set the app runs with it off.

const postgresUrl = z
  .string()
  .trim()
  .refine((value) => /^postgres(ql)?:\/\/[^/]+/.test(value), {
    message: "must be a postgres:// or postgresql:// connection string",
  });

const schema = z.object({
  DATABASE_URL: postgresUrl.optional(),
  DIRECT_URL: postgresUrl.optional(),
});

export type ServerEnv = {
  database: { enabled: false } | { enabled: true; url: string; directUrl: string };
};

export class EnvError extends Error {
  constructor(problems: string[]) {
    super(
      [
        "Environment variables are set up wrong:",
        ...problems.map((problem) => `  - ${problem}`),
        "See .env.example for what each one should be.",
      ].join("\n"),
    );
    this.name = "EnvError";
  }
}

type RawEnv = Record<string, string | undefined>;

/** Validates the raw environment. Throws an EnvError naming every problem; never returns a half-valid result. */
export function parseEnv(raw: RawEnv): ServerEnv {
  // Treat empty strings (e.g. `DATABASE_URL=` copied from .env.example) as unset.
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvError(result.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`));
  }

  const { DATABASE_URL, DIRECT_URL } = result.data;
  if (!DATABASE_URL && !DIRECT_URL) return { database: { enabled: false } };
  if (!DATABASE_URL) throw new EnvError(["DATABASE_URL is missing (DIRECT_URL is set; the app needs both)"]);
  if (!DIRECT_URL) throw new EnvError(["DIRECT_URL is missing (DATABASE_URL is set; migrations need both)"]);
  return { database: { enabled: true, url: DATABASE_URL, directUrl: DIRECT_URL } };
}
