import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { supabaseConfig } from "@/lib/supabase/config";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers, signed in as the current visitor
 * through their cookies. Throws SupabaseNotConfiguredError until the keys are set.
 */
export async function createSupabaseServerClient() {
  const { url, publishableKey } = supabaseConfig(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  const cookieStore = await cookies();
  return createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components can't set cookies. Refreshing the session in a proxy arrives with sign-in (#101).
        }
      },
    },
  });
}
