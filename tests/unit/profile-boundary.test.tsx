import { renderToString } from "react-dom/server";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileSettings } from "@/components/account/ProfileSettings";
import { createAvatarService, type AvatarDb } from "@/server/account/avatar";
import { avatarRoute } from "@/server/account/avatar-route";
import type { FileStore } from "@/server/files/storage";

const fakes = vi.hoisted(() => ({ authorize: vi.fn(), update: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/navigation", async (original) => ({ ...(await original<typeof import("next/navigation")>()), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/cache", () => ({ revalidatePath: fakes.revalidate }));
vi.mock("@/server/auth/guard", async (original) => {
  const real = await original<typeof import("@/server/auth/guard")>();
  return { ...real, withRole: real.createGuards(async () => fakes.authorize()).withRole };
});
vi.mock("@/server/account/profile-store", () => ({ prismaProfileStore: () => ({ find: vi.fn(), update: fakes.update }) }));
const { saveProfileAction } = await import("@/server/account/profile-actions");

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

describe("the save action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.authorize.mockResolvedValue({ userId: "session-user", role: "CUSTOMER" });
    fakes.update.mockResolvedValue(undefined);
  });

  it("saves for the checked session, ignoring a user id, email or role in the form", async () => {
    const result = await saveProfileAction(null, form({ name: "Sam Lee", phone: "021 555 0192", id: "victim", userId: "victim", email: "x@y.nz", role: "ADMIN" }));
    expect(result).toEqual({ ok: true, name: "Sam Lee", phone: "021 555 0192" });
    expect(fakes.update).toHaveBeenCalledExactlyOnceWith("session-user", { firstName: "Sam", lastName: "Lee", phone: "+64215550192" });
    expect(fakes.revalidate).toHaveBeenCalledWith("/", "layout");
  });

  it("lets a tradie save their own profile too", async () => {
    fakes.authorize.mockResolvedValue({ userId: "tradie-1", role: "TRADIE" });
    expect(await saveProfileAction(null, form({ name: "Tia Ngata", phone: "027 555 0192" }))).toMatchObject({ ok: true });
    expect(fakes.update).toHaveBeenCalledWith("tradie-1", expect.objectContaining({ firstName: "Tia" }));
  });

  it("answers session-expired, keeping what was typed, and writes nothing when signed out", async () => {
    fakes.authorize.mockResolvedValue(null);
    expect(await saveProfileAction(null, form({ name: "Sam", phone: "021 555 0192" }))).toMatchObject({ ok: false, error: "session-expired", values: { name: "Sam" } });
    expect(fakes.update).not.toHaveBeenCalled();
  });

  it("refuses the office role", async () => {
    fakes.authorize.mockResolvedValue({ userId: "office", role: "ADMIN" });
    expect(await saveProfileAction(null, form({ name: "Sam", phone: "021 555 0192" }))).toEqual({ ok: false, error: "forbidden" });
    expect(fakes.update).not.toHaveBeenCalled();
  });

  it("returns per-field messages for bad input and doesn't refresh the page", async () => {
    expect(await saveProfileAction(null, form({ name: "", phone: "1" }))).toMatchObject({ ok: false, error: "invalid", fields: { name: "Enter your name.", phone: expect.any(String) } });
    expect(fakes.update).not.toHaveBeenCalled();
    expect(fakes.revalidate).not.toHaveBeenCalled();
  });
});

// A real, tiny PNG.
const PNG = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer());
const USER = "123e4567-e89b-12d3-a456-426614174000";

function avatarKit(previous: string | null = null) {
  const store: FileStore = { put: vi.fn(async () => undefined), signedUrl: vi.fn(async (_b, path) => `https://files.test/${path}?token=1`), remove: vi.fn(async () => undefined) };
  const db: AvatarDb = { find: vi.fn(async () => previous), setPath: vi.fn(async () => undefined) };
  return { store, db, service: createAvatarService({ store, db }) };
}

describe("the profile photo", () => {
  it("stores a small private WebP under the person's own folder and records its path", async () => {
    const { store, db, service } = avatarKit();
    const { url } = await service.setAvatar(USER, PNG);
    expect(store.put).toHaveBeenCalledWith("photos", expect.stringMatching(new RegExp(`^avatars/${USER}/[0-9a-f]{32}\\.webp$`)), expect.anything(), "image/webp");
    expect(db.setPath).toHaveBeenCalledWith(USER, expect.stringContaining(`avatars/${USER}/`));
    expect(url).toContain("https://files.test/avatars/");
  });

  it("removes the old photo once the new one is saved, but never someone else's file", async () => {
    const own = avatarKit(`avatars/${USER}/${"a".repeat(32)}.webp`);
    await own.service.setAvatar(USER, PNG);
    expect(own.store.remove).toHaveBeenCalledWith("photos", [`avatars/${USER}/${"a".repeat(32)}.webp`]);
    const other = avatarKit(`avatars/00000000-0000-4000-8000-000000000000/${"a".repeat(32)}.webp`);
    await other.service.setAvatar(USER, PNG);
    expect(other.store.remove).not.toHaveBeenCalled();
  });

  it("refuses a file that isn't a JPG, PNG or HEIC picture, whatever it is called", async () => {
    const { store, service } = avatarKit();
    await expect(service.setAvatar(USER, new TextEncoder().encode("<script>alert(1)</script>"))).rejects.toMatchObject({ code: "wrong-type" });
    expect(store.put).not.toHaveBeenCalled();
  });

  it("only hands out a link to the person's own photo", async () => {
    const { service } = avatarKit();
    expect(await service.avatarUrl(USER, `avatars/${USER}/${"b".repeat(32)}.webp`)).toContain("https://files.test/");
    expect(await service.avatarUrl(USER, `avatars/00000000-0000-4000-8000-000000000000/${"b".repeat(32)}.webp`)).toBeNull();
    expect(await service.avatarUrl(USER, `jobs/x/${"b".repeat(32)}.webp`)).toBeNull();
    expect(await service.avatarUrl(USER, null)).toBeNull();
  });

  const post = (body: BodyInit | null) => new Request("https://app.test/api/profile/avatar", { method: "POST", body });
  const withPhoto = (file: Blob) => {
    const data = new FormData();
    data.set("photo", file, "me.png");
    return data;
  };

  it("the route saves for the session's person and answers with the new link", async () => {
    const { db, service } = avatarKit();
    const limit = vi.fn(async () => ({ allowed: true as const }));
    const response = await avatarRoute(USER, post(withPhoto(new Blob([PNG]))), { service: () => service, limit });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, url: expect.stringContaining("https://files.test/") });
    expect(limit).toHaveBeenCalledWith("upload", USER);
    expect(db.setPath).toHaveBeenCalledWith(USER, expect.any(String));
  });

  it("the route turns bad files, a missing file and a busy minute into plain sentences", async () => {
    const { service } = avatarKit();
    const deps = { service: () => service, limit: async () => ({ allowed: true as const }) };
    const bad = await avatarRoute(USER, post(withPhoto(new Blob(["not a picture"]))), deps);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ ok: false, error: "wrong-type", message: "Photos must be a JPG, PNG or HEIC picture." });
    expect((await avatarRoute(USER, post(new FormData()), deps)).status).toBe(400);
    const busy = await avatarRoute(USER, post(withPhoto(new Blob([PNG]))), { ...deps, limit: async () => ({ allowed: false as const, retryAfter: 90 }) });
    expect(busy.status).toBe(429);
    expect((await busy.json()).message).toMatch(/^Too many tries\. Try again in/);
  });

  it("the route says storage is unavailable when it isn't set up, without leaking why", async () => {
    const response = await avatarRoute(USER, post(withPhoto(new Blob([PNG]))), { service: () => { throw new Error("SUPABASE_SECRET_KEY missing"); }, limit: async () => ({ allowed: true as const }) });
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("SUPABASE");
  });
});

describe("the profile screen", () => {
  const html = (props: Partial<Parameters<typeof ProfileSettings>[0]> = {}) =>
    renderToString(<ProfileSettings initial={{ name: "Sarah Thompson", phone: "021 555 0192" }} email="sarah@example.nz" {...props} />).replaceAll("<!-- -->", "");

  it("shows the saved values, the current email read-only, and a way to change it in Security", () => {
    const page = html();
    expect(page).toContain("<h1");
    expect(page).toContain('value="Sarah Thompson"');
    expect(page).toContain('value="021 555 0192"');
    expect(page).toMatch(/<input[^>]*readOnly=""[^>]*value="sarah@example.nz"|<input[^>]*value="sarah@example.nz"[^>]*readOnly=""/);
    expect(page).toContain('href="/profile/security"');
    expect(page).toContain("Change email");
  });

  it("has no email field to submit, so the email can't be switched here before it is confirmed", () => {
    expect(html()).not.toMatch(/<input[^>]*name="email"/);
  });

  it("starts with Save off and a Change photo button", () => {
    const page = html();
    expect(page).toMatch(/<button[^>]*aria-disabled="true"[^>]*>[\s\S]*?Save changes/);
    expect(page).toContain("Change photo");
  });

  it("says a new address is waiting for its link while the current one stays", () => {
    const page = html({ pendingEmail: "new@example.nz" });
    expect(page).toContain("Check new@example.nz and your current inbox to confirm your new email.");
    expect(page).toContain('value="sarah@example.nz"');
  });
});
