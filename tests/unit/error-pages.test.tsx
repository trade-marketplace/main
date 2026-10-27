import { readFileSync } from "node:fs";

import { renderToString } from "react-dom/server";
import { prerender } from "react-dom/static";
import { describe, expect, it, vi } from "vitest";

import AppNotFound from "@/app/(app)/not-found";
import AppError from "@/app/(app)/error";
import AdminNotFound from "@/app/admin/not-found";
import RootError from "@/app/error";
import GlobalError from "@/app/global-error";
import RootNotFound from "@/app/not-found";
import { NOT_FOUND_TITLE, NotFoundView, SERVER_ERROR_TITLE, ServerErrorView } from "@/components/errors";
import { errorReference } from "@/lib/error-ref";

// The root 404 sits in the public site's shell, which reads who is signed in: nobody, here.
vi.mock("@/server/auth/viewer", () => ({ getViewer: vi.fn(async () => null) }));

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
/** The text a screen reader gets: tags and aria-hidden parts (icons) removed. */
const text = (html: string) =>
  html
    .replace(/<span[^>]*aria-hidden="true"[^>]*>[^<]*<\/span>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("errorReference", () => {
  it("groups the digest in fours for reading out", () => {
    expect(errorReference("1234567890")).toBe("1234-5678-90");
    expect(errorReference("7f3a91c2")).toBe("7F3A-91C2");
  });

  it("drops anything that isn't a letter or digit", () => {
    expect(errorReference(" 12-34 <b>56 ")).toBe("1234-B56");
  });

  it("is null without a digest (an error in the browser)", () => {
    expect(errorReference(undefined)).toBeNull();
    expect(errorReference("")).toBeNull();
    expect(errorReference("---")).toBeNull();
  });
});

describe("NotFoundView", () => {
  const html = renderToString(<NotFoundView />);

  it("says it plainly in one heading, with the 404 hidden from screen readers", () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(NOT_FOUND_TITLE);
    expect(html).toMatch(/<p[^>]*aria-hidden="true"[^>]*>404<\/p>/);
  });

  it("offers Go home and the help centre", () => {
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>[\s\S]*?Go home/);
    expect(html).toMatch(/<a[^>]*href="\/help"[^>]*>[\s\S]*?Help centre/);
  });

  it("never mentions a job or whether anything exists (WEBAPP_SPEC G01)", () => {
    expect(text(html)).not.toMatch(/job|exist|permission|private|not allowed/i);
  });
});

describe("ServerErrorView", () => {
  it("owns the problem, offers Try again and Contact us, and shows the reference", () => {
    const error = Object.assign(new Error("db password is hunter2"), { digest: "1234567890" });
    const html = renderToString(<ServerErrorView error={error} onRetry={() => {}} />);
    expect(text(html)).toContain(`${SERVER_ERROR_TITLE} It’s not you.`);
    expect(text(html)).toContain("Try again");
    expect(html).toMatch(/<a[^>]*href="\/contact"[^>]*>[\s\S]*?Contact us/);
    expect(text(html)).toContain("Error ref 1234-5678-90 (for support)");
  });

  it("never shows the error's own message", () => {
    const error = Object.assign(new Error("db password is hunter2"), { digest: "1" });
    expect(renderToString(<ServerErrorView error={error} />)).not.toContain("hunter2");
  });

  it("shows no reference for an error with no digest", () => {
    expect(renderToString(<ServerErrorView error={new Error("x")} />)).not.toContain("Error ref");
  });

  it("is said to screen readers, since it can replace a page that was already showing", () => {
    expect(renderToString(<ServerErrorView />)).toMatch(/role="status"|aria-live/);
  });

  it("is the page's h1", () => {
    expect(renderToString(<ServerErrorView />)).toMatch(/<h1\b[^>]*>Something broke on our end\.<\/h1>/);
  });
});

describe("the route files", () => {
  it("puts the root 404 in the public site's header and footer", async () => {
    const { prelude } = await prerender(<RootNotFound />);
    const html = await new Response(prelude).text();
    expect(html).toContain(NOT_FOUND_TITLE);
    expect(html).toContain("Skip to content");
    expect(html).toContain("<footer");
  });

  it("gives the app and the office the same 404 inside their own shells", () => {
    for (const NotFound of [AppNotFound, AdminNotFound]) expect(renderToString(<NotFound />)).toContain(NOT_FOUND_TITLE);
  });

  it("shows the 500 view from every error boundary, including the last-resort one with its own <html>", () => {
    const error = Object.assign(new Error("x"), { digest: "abcd" });
    const reset = () => {};
    expect(renderToString(<AppError error={error} reset={reset} />)).toContain(SERVER_ERROR_TITLE);
    expect(renderToString(<RootError error={error} reset={reset} />)).toMatch(/<main id="main"/);
    const global = renderToString(<GlobalError error={error} reset={reset} />);
    expect(global).toMatch(/^<html lang="en-NZ"/);
    expect(global).toContain(SERVER_ERROR_TITLE);
  });

  it("has an error boundary in every route group, so the nav stays when a page breaks", () => {
    for (const group of ["(site)", "(app)", "admin"]) expect(read(`src/app/${group}/error.tsx`)).toContain("ServerErrorView");
  });

  it("keeps 404 pages out of search results", () => {
    for (const file of ["src/app/not-found.tsx", "src/app/(app)/not-found.tsx", "src/app/admin/not-found.tsx"]) {
      expect(read(file)).toMatch(/robots: \{ index: false/);
    }
  });
});

describe("errors.module.css", () => {
  const css = read("src/components/errors/errors.module.css");
  it("uses the mockup's 620px cards and the signature-coloured 404", () => {
    expect(css).toMatch(/width: min\(100%, 620px\)/);
    expect(css).toMatch(/\.code \{[^}]*color: var\(--trade-signature\)/s);
  });
});
