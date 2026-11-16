import "server-only";

import { createClient } from "@supabase/supabase-js";

import { supabaseConfig } from "@/lib/supabase/config";
import type { SecurityDeps, SecurityUser } from "@/server/auth/security";
import { getDb } from "@/server/db";
import { createSupabaseServerClient } from "@/server/supabase";

export async function syncSecurityEmail(user: SecurityUser, emailLinkProved = false) {
  if (!user.email) return;
  // #106: Auth can mark signup emails confirmed without proof when "Confirm email" is off.
  // Merely visiting Security or checking a password must never grant our independent verified status.
  // #353: with Secure email change on, the first of the two links leaves the change pending (`new_email` set) and
  // `email` still the old address. That link may have gone to the new address, so it proves nothing about `email`.
  const proved = emailLinkProved && !user.new_email;
  const changed = { email: { not: user.email } };
  await getDb().profile.updateMany({
    where: { id: user.id, ...(proved ? { OR: [changed, { emailVerifiedAt: null }] } : changed) },
    data: { email: user.email, emailVerifiedAt: proved ? new Date() : null },
  });
}

export async function securityDeps(): Promise<SecurityDeps> {
  const client = await createSupabaseServerClient();
  return {
    auth: client.auth,
    syncEmail: syncSecurityEmail,
    verifyPassword: async (email, password) => {
      const { url, publishableKey } = supabaseConfig(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
      // No cookies/storage: proving the password must not rotate the session used by signOut(others).
      const proof = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      try {
        return await proof.auth.signInWithPassword({ email, password });
      } finally {
        await proof.auth.signOut({ scope: "local" });
      }
    },
  };
}
