// The global offline banner (#187, G04): what it renders, how it hands over to a page's own banner, and the held-form
// helpers. Going offline for real (setOffline, online/offline events, a form submitted offline, sent again when back)
// is checked in the browser: tests/e2e/offline-banner.spec.ts.
import { readFileSync } from "node:fs";

import { renderToString as renderHtml } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OfflineBanner } from "@/components/feedback";
import {
  ConnectionBanner,
  HeldFormBar,
  OFFLINE_HEIGHT_VAR,
  QUEUED_OFFLINE_TEXT,
  QUEUED_ONLINE_TEXT,
  resubmit,
} from "@/components/feedback/ConnectionBanner";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/" }));

const unhash = (text: string) => text.replace(/\b_([A-Za-z-]+)_[0-9a-f]{6}\b/g, "$1");
const render = (node: Parameters<typeof renderHtml>[0]) => unhash(renderHtml(node));
const source = (path: string) => readFileSync(new URL(`../../src/components/${path}`, import.meta.url), "utf8");

describe("<ConnectionBanner>", () => {
  it("server HTML is quiet: one labelled Connection region with empty status regions, then the page", () => {
    const html = render(<ConnectionBanner><p>page</p></ConnectionBanner>);
    expect(html).toMatch(/^<section aria-label="Connection" class="sticky">/);
    expect(html).toContain('<span role="status" class="visuallyHidden"></span>');
    expect(html).toContain("<p>page</p>");
    expect(html).not.toContain("data-offline");
    expect(html).not.toContain("data-held-form");
  });

  it("a page's own banner that follows the browser renders nothing below it, so there is only one", () => {
    const html = render(<ConnectionBanner><OfflineBanner onRetry={() => {}} /></ConnectionBanner>);
    expect(html.match(/aria-label="Connection"/g)).toHaveLength(1);
  });

  it("a preview that sets `online` still shows below it", () => {
    const html = render(<ConnectionBanner><OfflineBanner online={false} sticky={false} /></ConnectionBanner>);
    expect(html).toContain("You’re offline.");
  });

  it("outside it, a page's own banner is unchanged", () => {
    expect(render(<OfflineBanner />)).toContain('aria-label="Connection"');
  });
});

describe("the held-form strip", () => {
  it("offline: says it isn't sent and that it will be offered when back; no buttons", () => {
    const html = render(<HeldFormBar online={false} />);
    expect(html).toContain(QUEUED_OFFLINE_TEXT);
    expect(html).not.toContain("<button");
  });

  it("online: Send now and Not now", () => {
    const html = render(<HeldFormBar online onSend={() => {}} onDismiss={() => {}} />);
    expect(html).toContain(QUEUED_ONLINE_TEXT);
    expect(html).toMatch(/<button[^>]*>[\s\S]*Send now/);
    expect(html).toMatch(/<button[^>]*>[\s\S]*Not now/);
  });
});

describe("resubmit", () => {
  const fakeForm = (connected: boolean) => {
    const form = { isConnected: connected, requestSubmit: vi.fn(), querySelector: () => ({ focus: vi.fn() }) };
    return form as unknown as HTMLFormElement & typeof form;
  };

  it("submits the same form with the same button, and gives focus back to it", () => {
    const form = fakeForm(true);
    const focus = vi.fn();
    const submitter = { isConnected: true, closest: () => form, focus } as unknown as HTMLElement;
    expect(resubmit({ form, submitter })).toBe(true);
    expect(form.requestSubmit).toHaveBeenCalledWith(submitter);
    expect(focus).toHaveBeenCalled();
  });

  it("does nothing if the form has left the page", () => {
    const form = fakeForm(false);
    expect(resubmit({ form, submitter: null })).toBe(false);
    expect(form.requestSubmit).not.toHaveBeenCalled();
  });

  it("falls back to a plain submit if the button is no longer valid", () => {
    const form = fakeForm(true);
    form.requestSubmit.mockImplementationOnce(() => {
      throw new TypeError("bad submitter");
    });
    const submitter = { isConnected: true, closest: () => form, focus: vi.fn() } as unknown as HTMLElement;
    resubmit({ form, submitter });
    expect(form.requestSubmit).toHaveBeenCalledTimes(2);
  });
});

describe("how the shells sit under the banner", () => {
  it("every sticky shell header and the office sidebar start below the banner height", () => {
    for (const file of ["app/app.module.css", "site/site.module.css", "office/office.module.css", "auth/auth.module.css"]) {
      expect(source(file)).toContain(`var(${OFFLINE_HEIGHT_VAR}, 0px)`);
    }
  });

  it("links to a section and keyboard focus leave room for the banner too", () => {
    expect(source("site/site.module.css")).toMatch(/\.main :target \{[^}]*var\(--trade-offline-h, 0px\)/);
    expect(source("app/app.module.css")).toMatch(/scroll-padding-top: calc\(84px \+ var\(--trade-offline-h, 0px\)\)/);
  });
});
