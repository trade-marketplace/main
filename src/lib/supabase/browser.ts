import { createBrowserClient } from "@supabase/ssr";

import { supabaseConfig } from "./config";

/** Supabase client for Client Components. Throws SupabaseNotConfiguredError until the keys are set. */
export function createSupabaseBrowserClient() {
  const { url, publishableKey } = supabaseConfig(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  return createBrowserClient(url, publishableKey);
}
