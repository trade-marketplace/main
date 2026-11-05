import { describe, expect, it } from "vitest";
import { officeSupportJobHref, officeSupportJobReturn, officeSupportSearch, officeSupportThreadHref, parseOfficeSupportQuery } from "@/lib/office-support";

const id = "00000000-0000-4000-8000-000000001830";
describe("office support navigation", () => {
  it("bounds input and round-trips search, status and page without accepting a return URL", () => {
    expect(parseOfficeSupportQuery({ q: ["a", "b"], status: "bad", page: "-1" })).toEqual({ q: "", status: "open", page: 1 });
    expect(parseOfficeSupportQuery({ q: `  ${"x".repeat(110)}  `, page: "10000" }).q).toHaveLength(100);
    const query = parseOfficeSupportQuery({ q: "  Sarah & Jack  ", status: "all", page: "3" });
    expect(parseOfficeSupportQuery(Object.fromEntries(new URLSearchParams(officeSupportSearch(query))))).toEqual(query);
    const destination = new URL(officeSupportJobHref(id, query), "https://local.test");
    expect(destination.hash).toBe("#job-messages");
    expect(officeSupportJobReturn(Object.fromEntries(destination.searchParams))).toEqual({ label: "Support inbox", href: `/admin/support${officeSupportSearch(query)}` });
    const privateDestination = new URL(officeSupportJobHref(id, query, id), "https://local.test");
    expect(officeSupportJobReturn(Object.fromEntries(privateDestination.searchParams))).toEqual({ label: "Support", href: officeSupportThreadHref(id, query) });
    expect(officeSupportJobReturn({ from: "https://evil.test", returnTo: "//evil.test" })).toBeUndefined();
    expect(officeSupportJobReturn({ from: "support", supportThread: "//evil.test", q: "x" })).toEqual({ label: "Support inbox", href: "/admin/support?q=x" });
  });
});
