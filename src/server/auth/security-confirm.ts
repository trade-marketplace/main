import "server-only";

import type { SecurityUser } from "./security";

export async function confirmSecurityEmail(deps: {
  exchange(code: string): Promise<{ data: { user: SecurityUser | null }; error: unknown }>;
  syncEmail(user: SecurityUser): Promise<void>;
  discard(): Promise<void>;
}, userId: string, code: string | null): Promise<boolean> {
  if (!code || code.length > 2048) return false;
  try {
    const { data, error } = await deps.exchange(code);
    if (error) return false;
    if (!data.user || data.user.id !== userId) { await deps.discard(); return false; }
    await deps.syncEmail(data.user);
    return true;
  } catch { return false; }
}
