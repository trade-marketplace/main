// Supabase project settings, shared by the browser and server clients. Both values are public by design:
// what each user can read or change is enforced by Postgres row-level security, not by hiding the key.

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "Supabase isn't connected. Copy .env.example to .env.local and fill in NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY from Supabase (Project Settings → API Keys).",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

export type SupabaseConfig = { url: string; publishableKey: string };

/**
 * Pass the values in, rather than reading process.env here: Next.js only inlines NEXT_PUBLIC_ variables
 * into browser code where they are written out in full, as in ./browser.ts.
 */
export function supabaseConfig(url: string | undefined, publishableKey: string | undefined): SupabaseConfig {
  if (!url?.trim() || !publishableKey?.trim()) throw new SupabaseNotConfiguredError();
  return { url: url.trim(), publishableKey: publishableKey.trim() };
}
