import { z } from "zod";

// Server-side environment. Every variable is listed, with a comment, in .env.example.
// The database and Supabase are optional for now: with their variables unset the app runs with them off.

const postgresUrl = z
  .string()
  .trim()
  .refine((value) => /^postgres(ql)?:\/\/[^/]+/.test(value), {
    message: "must be a postgres:// or postgresql:// connection string",
  });

const httpsUrl = z
  .string()
  .trim()
  .refine((value) => /^https?:\/\/[^/]+/.test(value), {
    message: "must be the project URL, e.g. https://<project-ref>.supabase.co",
  });

const schema = z.object({
  DATABASE_URL: postgresUrl.optional(),
  DIRECT_URL: postgresUrl.optional(),
  NEXT_PUBLIC_SUPABASE_URL: httpsUrl.optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().trim().optional(),
});

export type ServerEnv = {
  database: { enabled: false } | { enabled: true; url: string; directUrl: string };
  supabase: { enabled: false } | { enabled: true; url: string; publishableKey: string };
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

  const env = result.data;
  const problems = [
    ...pairProblems("DATABASE_URL", env.DATABASE_URL, "DIRECT_URL", env.DIRECT_URL),
    ...pairProblems(
      "NEXT_PUBLIC_SUPABASE_URL",
      env.NEXT_PUBLIC_SUPABASE_URL,
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
  ];
  if (problems.length > 0) throw new EnvError(problems);

  return {
    database:
      env.DATABASE_URL && env.DIRECT_URL
        ? { enabled: true, url: env.DATABASE_URL, directUrl: env.DIRECT_URL }
        : { enabled: false },
    supabase:
      env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
        ? { enabled: true, url: env.NEXT_PUBLIC_SUPABASE_URL, publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }
        : { enabled: false },
  };
}

/** Some variables only work together: set both, or neither. */
function pairProblems(nameA: string, a: string | undefined, nameB: string, b: string | undefined): string[] {
  if (a && !b) return [`${nameB} is missing (${nameA} is set; set both or neither)`];
  if (b && !a) return [`${nameA} is missing (${nameB} is set; set both or neither)`];
  return [];
}
