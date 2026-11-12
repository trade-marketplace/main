import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Workspace, WorkspaceLoadError, WorkspaceLoading } from "@/components/jobs/worker/Workspace";
import { WorkspacePage } from "@/components/jobs/worker/WorkspacePage";
import { BookWindow, BookWindowLoadError } from "@/components/jobs/worker/BookWindow";
import { FinishJob } from "@/components/jobs/worker/FinishJob";
import { workspaceBackHref } from "@/components/jobs/worker/use-workspace-return";
import { workspaceExample } from "@/app/dev/components/worker-workspace/WorkspaceDemo";
import { finishExample } from "@/app/dev/components/finish-job/FinishDemo";

const deps = vi.hoisted(() => ({ search: "", load: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams(deps.search), notFound: () => { throw Error("not-found"); } }));
vi.mock("@/server/db", () => ({ getDb: () => ({}) }));
vi.mock("@/server/jobs/worker-workspace", () => ({ loadWorkspace: deps.load }));
beforeEach(() => { vi.clearAllMocks(); deps.search = ""; deps.load.mockResolvedValue({ ...workspaceExample, extras: [] }); });
describe("bounded My work workspace returns", () => {
  it.each(["/dashboard?column=on-now", "/dashboard?tab=quotes", "/dashboard?tab=quotes&column=done"])("retains %s through the breadcrumb and worker task links", back => {
    const html = renderToStaticMarkup(<Workspace job={workspaceExample} myWorkHref={back} />);
    expect(html).toContain(`href="${back.replaceAll("&", "&amp;")}">My work`);
    for (const task of ["book", "complete"]) expect(html).toContain(`/jobs/${workspaceExample.id}/${task}?from=${encodeURIComponent(back)}`);
    expect(renderToStaticMarkup(<WorkspaceLoading myWorkHref={back} />)).toContain(`href="${back.replaceAll("&", "&amp;")}"`);
    expect(renderToStaticMarkup(<WorkspaceLoadError myWorkHref={back} />)).toContain(`href="${back.replaceAll("&", "&amp;")}"`);
  });
  it.each([undefined, "https://outside.test/dashboard?column=on-now", "//outside.test/dashboard", "/jobs?kind=ready", "/dashboard?column=unknown"])("keeps the existing default for %s", back => {
    const html = renderToStaticMarkup(<Workspace job={workspaceExample} myWorkHref={back} />);
    expect(html).toContain('href="/dashboard">My work'); expect(html).not.toContain("?from=");
    expect(renderToStaticMarkup(<WorkspaceLoadError myWorkHref={back} />)).toContain('href="/dashboard">My work');
  });
  it("forwards the canonical return through successful and failed workspace reads", async () => {
    const props = { viewer: { userId: "worker", role: "TRADIE" as const }, id: workspaceExample.id, back: "/dashboard?column=on-now&ignored=value" };
    expect((await WorkspacePage(props)).props.myWorkHref).toBe("/dashboard?column=on-now");
    deps.load.mockRejectedValueOnce(Error("unavailable")); const failed = await WorkspacePage(props);
    expect(failed.type).toBe(WorkspaceLoadError); expect(failed.props.myWorkHref).toBe("/dashboard?column=on-now");
    expect((await WorkspacePage({ ...props, back: "/jobs?kind=ready" })).props.myWorkHref).toBe("/dashboard");
    deps.load.mockResolvedValueOnce(null); await expect(WorkspacePage(props)).rejects.toThrow("not-found");
  });
  it("keeps Book, its read-error Back and Finish on the same bounded workspace", () => {
    const back = "/dashboard?column=on-now"; deps.search = `from=${encodeURIComponent(back)}`;
    const jobHref = `/jobs/${workspaceExample.id}?from=${encodeURIComponent(back)}`;
    expect(workspaceBackHref(`/jobs/${workspaceExample.id}`, back)).toBe(jobHref);
    const initial = { id: workspaceExample.id, title: "Sub wiring", suburb: "Windsor", customerFirstName: "Sarah", windows: [], booked: null, anyTime: true, revision: "1" };
    expect(renderToStaticMarkup(<BookWindow initial={initial} />)).toContain(`href="${jobHref}"`);
    expect(renderToStaticMarkup(<BookWindowLoadError backHref={`/jobs/${workspaceExample.id}`} />)).toContain(`href="${jobHref}"`);
    expect(renderToStaticMarkup(<FinishJob job={{ ...finishExample, id: workspaceExample.id }} />)).toContain(`href="${jobHref}"`);
    expect(workspaceBackHref("/dev/components/worker-book", back)).toBe("/dev/components/worker-book");
    for (const from of ["/jobs?kind=ready", "https://outside.test", "//outside.test"]) expect(workspaceBackHref(`/jobs/${workspaceExample.id}`, from)).toBe(`/jobs/${workspaceExample.id}`);
  });
});
