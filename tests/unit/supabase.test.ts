import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { SupabaseNotConfiguredError, supabaseConfig } from "@/lib/supabase/config";

afterEach(() => vi.unstubAllEnvs());

describe("supabaseConfig", () => {
  it("explains how to connect when the keys aren't set", () => {
    expect(() => supabaseConfig(undefined, undefined)).toThrow(SupabaseNotConfiguredError);
    expect(() => supabaseConfig("https://ref.supabase.co", " ")).toThrow(/Copy \.env\.example to \.env\.local/);
  });

  it("returns the trimmed URL and key when both are set", () => {
    expect(supabaseConfig(" https://ref.supabase.co ", "sb_publishable_x")).toEqual({
      url: "https://ref.supabase.co",
      publishableKey: "sb_publishable_x",
    });
  });
});

describe("createSupabaseBrowserClient", () => {
  it("throws the guidance error, without calling Supabase, when the keys aren't set", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    expect(() => createSupabaseBrowserClient()).toThrow(SupabaseNotConfiguredError);
  });

  it("creates a client when the keys are set", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
    expect(createSupabaseBrowserClient().auth).toBeDefined();
  });
});
