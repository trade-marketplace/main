import { describe, expect, it, vi } from "vitest";
import WorkAreaPage from "@/app/(app)/profile/area/page";
import WorkAreaLoading from "@/app/(app)/profile/area/loading";
import { requireUser } from "@/server/auth/guard";
import { loadWorkArea } from "@/server/workers/area";
import { WorkAreaLoadingPage } from "@/components/account/WorkArea";

vi.mock("@/server/auth/guard", () => ({ requireUser: vi.fn() }));
vi.mock("@/components/account/WorkArea", () => ({ WorkArea: () => null, WorkAreaLoadingPage: () => null }));
vi.mock("@/server/db", () => ({ getDb: () => ({}) }));
vi.mock("@/server/workers/area", () => ({ loadWorkArea: vi.fn(async () => null) }));
describe("work area route", () => {
  it("returns 404 for a customer before reading worker details", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "customer", role: "CUSTOMER", email: "customer@example.test", firstName: "Test", emailVerified: true });
    await expect(WorkAreaPage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    expect(loadWorkArea).not.toHaveBeenCalled();
  });
  it("preserves a safe board return through the page's independent login guard", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "tradie", role: "TRADIE", email: "tradie@example.test", firstName: "Test", emailVerified: true });
    await WorkAreaPage({ searchParams: Promise.resolve({ next: "/jobs?view=all" }) });
    expect(requireUser).toHaveBeenLastCalledWith({ next: "/profile/area?next=%2Fjobs%3Fview%3Dall" });
  });
  it("keeps loading navigation inert until the page can preserve the board return", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "tradie", role: "TRADIE", email: "tradie@example.test", firstName: "Test", emailVerified: true });
    expect((await WorkAreaLoading()).type).toBe(WorkAreaLoadingPage);
  });
});
