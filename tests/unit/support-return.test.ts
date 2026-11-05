import { describe, expect, it } from "vitest";
import { supportReturn, supportThreadHref } from "@/lib/support-return";
describe("private support return paths", () => {
  it("allows bounded Help search/article paths and keeps notification Back on existing public Help", () => {
    for (const path of ["/help", "/help/change-your-details", "/support", "/support?q=pay%20now&topic=payments", "/support?page=2", "/support/articles/when-do-i-pay"]) expect(supportReturn(path)).toBe(path);
    for (const path of ["https://evil.test/support", "//evil.test/support", "/support/../admin", "/support/new", "/support?next=https://evil.test", "/support?topic=a&topic=b", "/support?page=0", "/support?q=" + "a".repeat(201), "/support%2farticles%2frefunds", "/support\\evil", "/support#reply", ["/support"]]) expect(supportReturn(path)).toBe("/help");
    expect(supportReturn(undefined, "/support")).toBe("/support");
    const href = new URL(supportThreadHref("thread", "/support?q=bank", "cursor"), "https://local.test");
    expect(href.searchParams.get("returnTo")).toBe("/support?q=bank"); expect(href.searchParams.get("before")).toBe("cursor");
    expect(new URL(supportThreadHref("thread"), "https://local.test").searchParams.get("returnTo")).toBe("/help");
  });
});
