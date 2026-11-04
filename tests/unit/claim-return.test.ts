import { describe, expect, it } from "vitest";
import { boardJobHref } from "@/lib/job-board";
import { claimJobReturn, claimMessageHref, claimReturnFromQuery } from "@/lib/claim-return";
const id = "00000000-0000-4000-8000-000000001005", other = "00000000-0000-4000-8000-000000001006";
const back = "/jobs?kind=ready&trade=electrical&sort=earn&view=map", href = boardJobHref(id, back);
describe("claim Messages return context", () => {
  it("preserves exact job and canonical board context through thread/history URLs", () => {
    expect(claimJobReturn(href, id)).toBe(href);
    const thread = claimMessageHref(`/messages/${other}`, href);
    expect(new URL(thread, "https://local.test").searchParams.get("returnTo")).toBe(href);
    expect(claimReturnFromQuery({ returnTo: href, before: "cursor" }, "thread", id)).toBe(href);
    expect(claimReturnFromQuery({ returnTo: href, job: id }, "list", id)).toBe(href);
    expect(claimMessageHref(`/messages/${other}`, null)).toBe(`/messages/${other}`);
  });
  it.each([
    undefined, [href], `https://evil.test${href}`, `//evil.test${href}`, `${href}#address`,
    `/jobs/${id}?posted=1`, `${href}&posted=1`, `${href}&extra=1`, `${href}&from=${encodeURIComponent(back)}`,
    boardJobHref(id, "/jobs").replace("%2Fjobs", encodeURIComponent("/jobs?kind=ready&kind=ready")),
    `/jobs/${id}?from=${encodeURIComponent("/jobs?unexpected=1")}`,
    `/jobs/${id}?from=${encodeURIComponent("https://evil.test/jobs")}`,
    `/jobs/${id}?from=${encodeURIComponent("/dashboard")}`,
  ])("rejects unbounded or ambiguous context %s", value => { expect(claimJobReturn(value)).toBeNull(); });
  it("rejects a different authorized job, duplicates and unexpected Messages query keys", () => {
    expect(claimJobReturn(href, other)).toBeNull();
    expect(claimReturnFromQuery({ returnTo: href, job: other }, "list")).toBeNull();
    expect(claimReturnFromQuery({ returnTo: href, job: other }, "list", id)).toBeNull();
    expect(claimMessageHref(`/messages?job=${other}`, href)).toBe(`/messages?job=${other}`);
    expect(claimReturnFromQuery({ returnTo: [href, href], job: id }, "list")).toBeNull();
    expect(claimReturnFromQuery({ returnTo: href, job: id, posted: "1" }, "list")).toBeNull();
    expect(claimReturnFromQuery({ returnTo: href, before: ["a", "b"] }, "thread", id)).toBeNull();
    expect(claimMessageHref("https://evil.test/messages", href)).toBe("https://evil.test/messages");
  });
});
