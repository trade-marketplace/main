import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadAvatar } from "@/lib/account/avatar-upload";

import { formatMobile, joinName, parseProfile, profileChanged, readProfileForm, splitName } from "@/lib/account/profile";
import { loadProfilePage } from "@/server/account/profile-page";
import { profileForm, saveProfile, type ProfileRecord, type ProfileStore } from "@/server/account/profile";

vi.mock("@/server/auth/security", () => ({ readSecurityUser: vi.fn() }));
vi.mock("@/server/auth/security-deps", () => ({ securityDeps: vi.fn() }));
vi.mock("@/server/account/avatar-store", () => ({ getAvatarService: vi.fn() }));
vi.mock("@/server/account/profile-store", () => ({ prismaProfileStore: () => ({}) }));

const record: ProfileRecord = { firstName: "Sarah", lastName: "Thompson", phone: "+64215550192", email: "sarah@example.nz", avatarPath: null };
const fakeStore = (found: ProfileRecord | null = record) => ({
  find: vi.fn(async () => found),
  update: vi.fn(async () => undefined),
}) satisfies ProfileStore;

describe("profile fields", () => {
  it("splits and joins a name like sign-up does", () => {
    expect(splitName("  Mary  Anne Smith ")).toEqual({ firstName: "Mary", lastName: "Anne Smith" });
    expect(splitName("Cher")).toEqual({ firstName: "Cher", lastName: null });
    expect(joinName("Mary", "Anne Smith")).toBe("Mary Anne Smith");
    expect(joinName("Cher", null)).toBe("Cher");
  });

  it("shows a stored mobile the way people type it", () => {
    expect(formatMobile("+64215550192")).toBe("021 555 0192");
    expect(formatMobile(null)).toBe("");
  });

  it("accepts the sign-up phone formats and stores +64", () => {
    for (const phone of ["021 555 0192", "021-555-0192", "+64 21 555 0192", "0064215550192"]) {
      expect(parseProfile({ name: "Sam Lee", phone })).toEqual({ ok: true, data: { firstName: "Sam", lastName: "Lee", phone: "+64215550192" } });
    }
  });

  it("says what is wrong with each field", () => {
    expect(parseProfile({ name: "   ", phone: "12345" })).toEqual({
      ok: false,
      fields: { name: "Enter your name.", phone: "Enter a New Zealand mobile number, like 021 555 0192." },
    });
    expect(parseProfile({ name: "A".repeat(81), phone: "021 555 0192" })).toEqual({ ok: false, fields: { name: "That name is too long." } });
    expect(parseProfile({ name: `Sam ${"B".repeat(81)}`, phone: "021 555 0192" })).toMatchObject({ ok: false, fields: { name: "That name is too long." } });
    expect(parseProfile({ name: "Sam", phone: "09 555 0192" })).toMatchObject({ ok: false, fields: { phone: expect.any(String) } });
  });

  it("only reads the name and mobile from the form, so an email, id or role in it is ignored", () => {
    const form = new FormData();
    form.set("name", "Sam");
    form.set("phone", "021 555 0192");
    form.set("email", "someone@else.nz");
    form.set("id", "another-user");
    form.set("role", "ADMIN");
    expect(readProfileForm(form)).toEqual({ name: "Sam", phone: "021 555 0192" });
  });

  it("keeps Save off until something really changes", () => {
    const saved = { name: "Sarah Thompson", phone: "021 555 0192" };
    expect(profileChanged(saved, saved)).toBe(false);
    expect(profileChanged(saved, { name: " Sarah   Thompson ", phone: "0215550192" })).toBe(false);
    expect(profileChanged(saved, { name: "Sarah T", phone: saved.phone })).toBe(true);
    expect(profileChanged(saved, { name: saved.name, phone: "021 555 0193" })).toBe(true);
  });
});

describe("saving the profile", () => {
  it("writes the checked name and mobile to the signed-in person's row only", async () => {
    const store = fakeStore();
    const result = await saveProfile(store, "session-user", { name: "Sarah  Jane Thompson", phone: "021 555 0192" });
    expect(result).toEqual({ ok: true, name: "Sarah Jane Thompson", phone: "021 555 0192" });
    expect(store.update).toHaveBeenCalledExactlyOnceWith("session-user", { firstName: "Sarah", lastName: "Jane Thompson", phone: "+64215550192" });
  });

  it("writes nothing and returns the field messages when a field is wrong", async () => {
    const store = fakeStore();
    const result = await saveProfile(store, "session-user", { name: "", phone: "nope" });
    expect(result).toMatchObject({ ok: false, error: "invalid", fields: { name: "Enter your name.", phone: expect.any(String) } });
    expect(store.update).not.toHaveBeenCalled();
  });

  it("never writes an email: changing it is done in Security, which confirms the new address first", async () => {
    const store = fakeStore();
    const form = new FormData();
    form.set("name", "Sarah Thompson");
    form.set("phone", "021 555 0192");
    form.set("email", "new@example.nz");
    await saveProfile(store, "session-user", readProfileForm(form));
    expect(JSON.stringify(store.update.mock.calls)).not.toContain("new@example.nz");
    expect(Object.keys((store.update.mock.calls[0] as unknown[])[1] as object).sort()).toEqual(["firstName", "lastName", "phone"]);
  });

  it("says it is unavailable, without the database's message, when the write fails", async () => {
    const store = fakeStore();
    store.update.mockRejectedValue(new Error("connection to db.secret-host failed"));
    const result = await saveProfile(store, "session-user", { name: "Sam", phone: "021 555 0192" });
    expect(result).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("the profile page's data", () => {
  const sources = (over: Partial<Parameters<typeof loadProfilePage>[1]> = {}) => ({
    store: fakeStore(),
    pendingEmail: vi.fn(async () => undefined),
    avatarUrl: vi.fn(async () => null),
    ...over,
  });

  it("shows the saved values as form text, reading only the signed-in person's row", async () => {
    const s = sources();
    expect(await loadProfilePage("session-user", s)).toEqual({ initial: { name: "Sarah Thompson", phone: "021 555 0192" }, email: "sarah@example.nz", avatarUrl: null });
    expect(s.store.find).toHaveBeenCalledExactlyOnceWith("session-user");
    expect(profileForm(record).name).toBe("Sarah Thompson");
  });

  it("shows an email change that is waiting for confirmation, while the current email stays", async () => {
    const page = await loadProfilePage("u", sources({ pendingEmail: async () => "new@example.nz" }));
    expect(page).toMatchObject({ email: "sarah@example.nz", pendingEmail: "new@example.nz" });
  });

  it("still shows the page when Auth or Storage can't be reached", async () => {
    const page = await loadProfilePage("u", sources({ pendingEmail: async () => { throw new Error("auth down"); }, avatarUrl: async () => { throw new Error("storage down"); } }));
    expect(page).toMatchObject({ email: "sarah@example.nz", avatarUrl: null });
    expect(page).not.toHaveProperty("pendingEmail");
  });

  it("gives null (the page offers Try again) when the profile can't be read or doesn't exist", async () => {
    const broken = fakeStore();
    broken.find.mockRejectedValue(new Error("db down"));
    expect(await loadProfilePage("u", sources({ store: broken }))).toBeNull();
    expect(await loadProfilePage("u", sources({ store: fakeStore(null) }))).toBeNull();
  });
});

describe("sending a photo from the browser", () => {
  afterEach(() => vi.unstubAllGlobals());
  const png = () => new File([new Uint8Array([1, 2, 3])], "me.png", { type: "image/png" });

  it("posts the picture to our own route and returns the new link", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true, url: "https://files.test/a.webp" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await uploadAvatar(png())).toEqual({ ok: true, url: "https://files.test/a.webp" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/profile/avatar");
    expect(init.method).toBe("POST");
    expect((init.body as FormData).get("photo")).toBeInstanceOf(File);
  });

  it("turns away a file that isn't a photo before sending anything", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await uploadAvatar(new File(["x"], "notes.pdf", { type: "application/pdf" }));
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("notes.pdf") });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's sentence, or a plain one when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, message: "That file is over 10 MB. Choose a smaller one." }, { status: 413 })));
    expect(await uploadAvatar(png())).toEqual({ ok: false, message: "That file is over 10 MB. Choose a smaller one." });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect(await uploadAvatar(png())).toEqual({ ok: false, message: "We couldn’t save that file. Try again." });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "session-expired" }, { status: 401 })));
    expect(await uploadAvatar(png())).toEqual({ ok: false, message: "Log in to save." });
  });
});
