// Loading, empty and error states (#79): the HTML each component renders, the pure helpers, and the CSS rules the
// design depends on. Timing, announcements, retries and the offline banner going on and off are checked in the
// browser: tests/e2e/dev-feedback.spec.ts.
import { readFileSync } from "node:fs";

import { renderToString as renderHtml } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import FeedbackPage from "@/app/dev/components/feedback/page";
import { Button } from "@/components/Button";
import {
  EmptyState,
  ErrorState,
  InlineError,
  JobRowSkeleton,
  LiveMessage,
  LoadingRegion,
  OfflineBanner,
  ProgressBar,
  retryDelayMs,
  Skeleton,
  SkeletonText,
  Spinner,
  TileSkeleton,
} from "@/components/feedback";
import { announcement } from "@/components/feedback/ErrorState";
import { percentOf } from "@/components/feedback/Progress";

// Vitest hashes CSS module class names ("_empty_4f0108"); read them back as the names in the CSS file. React's
// "<!-- -->" text separators are dropped so sentences can be matched whole.
const unhash = (text: string) => text.replace(/\b_([A-Za-z]+)_[0-9a-f]{6}\b/g, "$1").replaceAll("<!-- -->", "");
const render = (node: Parameters<typeof renderHtml>[0]) => unhash(renderHtml(node));

const css = readFileSync(new URL("../../src/components/feedback/feedback.module.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** The declarations of the first rule whose selector list includes exactly `selector`. */
function rule(selector: string, source = css): string {
  const match = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) =>
    m[1].split(",").map((s) => s.trim()).includes(selector),
  );
  if (!match) throw new Error(`${selector} not found`);
  return match[2];
}

/** The text of the CSS inside `@media (prefers-reduced-motion: reduce) { … }`. */
function reducedMotionBlock(): string {
  const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") depth -= 1;
    if (depth === 0) return css.slice(start, i);
  }
  throw new Error("unclosed @media");
}

const LONG_WORD = "Taumatawhakatangihangakoauauotamateaturipukakapikimaungahoronukupokaiwhenuakitanatahu";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("skeletons", () => {
  it("use the M15 .tm-skel class (300ms delay, shimmer, static under reduced motion) and hide from screen readers", () => {
    const html = render(<Skeleton width={200} height={26} />);
    expect(html).toMatch(/^<span aria-hidden="true" class="tm-skel skel"/);
    expect(html).toContain("width:200px;height:26px");
  });

  it("default to one 14px line at the full width; strings are any CSS length", () => {
    expect(render(<Skeleton />)).toMatch(/class="tm-skel skel skelLine"/);
    expect(render(<Skeleton width="40%" height="1rem" />)).toContain("width:40%;height:1rem");
    expect(rule(".skelLine")).toContain("height: 14px");
  });

  it("come as circles and pills, which outrank .tm-skel's 6px corners", () => {
    expect(render(<Skeleton shape="circle" width={44} height={44} />)).toContain("skelCircle");
    expect(render(<Skeleton shape="pill" />)).toContain("skelPill");
    expect(rule(".skel.skelCircle")).toContain("border-radius: 50%");
    expect(rule(".skel.skelPill")).toContain("var(--trade-radius-pill)");
  });

  it("match the real layouts: text lines, .tm-jobrow rows and .tm-cat tiles", () => {
    const text = render(<SkeletonText lines={3} />);
    expect(text.match(/tm-skel/g)).toHaveLength(3);
    expect(text).toContain("width:60%"); // the last line is shorter

    const rows = render(<JobRowSkeleton count={2} />);
    expect(rows).toMatch(/^<ul aria-hidden="true"/);
    expect(rows.match(/<li /g)).toHaveLength(2);
    expect(rows).toContain("width:64px;height:64px");
    expect(rows.match(/tm-skel/g)).toHaveLength(8);

    const tiles = render(<TileSkeleton count={3} />);
    expect(tiles.match(/width:110px;height:96px/g)).toHaveLength(3);
  });
});

describe("<LoadingRegion>", () => {
  const region = (loading: boolean) =>
    render(
      <LoadingRegion loading={loading} label="Loading your jobs" skeleton={<JobRowSkeleton count={1} />}>
        <p>Replace two downlights</p>
      </LoadingRegion>,
    );

  it("while loading: the skeleton, aria-busy, and a polite status region outside the busy area", () => {
    const html = region(true);
    expect(html).toMatch(/^<div class="region" aria-busy="true"><ul aria-hidden="true"/);
    expect(html).not.toContain("Replace two downlights");
    // Screen readers hold back changes inside aria-busy, so the status region is its sibling, not its child.
    expect(html).toMatch(/<\/div><span role="status" class="visuallyHidden"><\/span>$/);
  });

  it("when loaded: the content, not busy, and nothing to say", () => {
    const html = region(false);
    expect(html).toContain("Replace two downlights");
    expect(html).not.toContain("aria-busy");
    expect(html).not.toContain("tm-skel");
    // Content that was there from the first paint doesn't cross-fade.
    expect(html).not.toContain("tm-anim-swap");
  });
});

describe("<LiveMessage>", () => {
  it("is a polite status region that starts empty, so the message is a change screen readers notice", () => {
    expect(render(<LiveMessage message="You’re offline." />)).toBe('<span role="status" class="visuallyHidden"></span>');
  });
});

describe("spinners and progress", () => {
  it("a spinner has a decorative ring, its label on screen and a polite region to say it", () => {
    const html = render(<Spinner label="Loading more jobs" />);
    expect(html).toMatch(/<span aria-hidden="true" class="ring"><\/span><span class="spinnerLabel">Loading more jobs<\/span>/);
    expect(html).toContain('role="status"');
  });

  it("hideLabel keeps the label for screen readers only; sizes change the ring", () => {
    expect(render(<Spinner label="Sending" hideLabel size="lg" />)).toMatch(
      /class="ring ringLg"><\/span><span class="visuallyHidden">Sending<\/span>/,
    );
    expect(render(<Spinner label="Checking" size="sm" />)).toContain('class="ring ringSm"');
  });

  it("a progress bar is a named role=progressbar with its value as a percentage", () => {
    const html = render(<ProgressBar label="Uploading kitchen.jpg" value={0.4} />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Uploading kitchen.jpg"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain('aria-valuenow="40"');
    expect(html).toContain('aria-valuetext="40%"');
    expect(html).toContain("width:40%");
    // The visible label and number would be read twice; the bar's own name and value already say it.
    expect(html).toMatch(/class="progressHead" aria-hidden="true"/);
  });

  it("without a value it is indeterminate: no aria-valuenow, a sliding bar", () => {
    const html = render(<ProgressBar label="Sending your photos" />);
    expect(html).not.toContain("aria-valuenow");
    expect(html).toContain('aria-valuetext="Working on it"');
    expect(html).toContain('class="progress indeterminate"');
  });

  it("percentOf clamps to 0–100 and rounds", () => {
    expect(percentOf(0.444)).toBe(44);
    expect(percentOf(-1)).toBe(0);
    expect(percentOf(3)).toBe(100);
    expect(percentOf(Number.NaN)).toBe(0);
  });

  it("the spinner and the bar stand still under reduced motion", () => {
    const reduced = reducedMotionBlock();
    expect(reduced).toMatch(/\.ring \{ animation: none; \}/);
    expect(reduced).toMatch(/\.indeterminate \.fill \{ animation: none;/);
  });
});

describe("<EmptyState>", () => {
  it("is the illustration, a heading, one line and one kit action (.tm-empty)", () => {
    const html = render(
      <EmptyState
        illustration="van"
        title="Nothing on yet."
        message="Got something that needs doing? Post it free and we’ll get you a price."
        action={<Button href="/jobs/new">Post a job</Button>}
      />,
    );
    expect(html).toMatch(/^<div class="empty"><img alt=""/); // decorative: the heading says what matters
    expect(html).toContain("van.png");
    expect(html).toContain('<h2 class="title">Nothing on yet.</h2>');
    expect(html).toContain('<p class="message">Got something');
    expect(html).toMatch(/<div class="actions"><a [^>]*href="\/jobs\/new"/);
  });

  it("can show an icon instead, a second action, or no action at all", () => {
    const icon = render(<EmptyState icon="search_off" title="No matching jobs." />);
    expect(icon).toMatch(/class="badge"><span class="icon" aria-hidden="true"[^>]*>search_off/);
    expect(icon).not.toContain("<img");
    expect(icon).not.toContain('class="actions"');

    const two = render(<EmptyState title="No messages yet." action={<a href="/a">See my jobs</a>} secondaryAction={<a href="/b">How</a>} />);
    expect(two).toContain('<div class="actions"><a href="/a">See my jobs</a><a href="/b">How</a></div>');
  });

  it("takes the heading level that fits the page", () => {
    expect(render(<EmptyState title="Nothing on yet." headingLevel={3} />)).toContain("<h3 ");
  });
});

describe("<ErrorState>", () => {
  it("section: cloud_off badge, an h2, the line, Try again (a kit Button) and a quieter action", () => {
    const html = render(
      <ErrorState
        title="Can’t load your jobs"
        message="Check your connection and try again."
        onRetry={() => {}}
        secondaryAction={<a href="/help">Contact support</a>}
      />,
    );
    expect(html).toMatch(/class="badge errorBadge"><span class="icon" aria-hidden="true"[^>]*>cloud_off/);
    expect(html).toContain('<h2 class="title">Can’t load your jobs</h2>');
    expect(html).toMatch(/<button type="button" class="btn primary[^"]*tm-press[^"]*">[\s\S]*Try again[\s\S]*refresh/);
    expect(html).toContain('<a href="/help">Contact support</a>');
    expect(html).toContain('role="status"');
  });

  it("page: taller, an h1, small buttons as in the mockup, the support reference (never a raw error)", () => {
    const html = render(
      <ErrorState size="page" icon="build" title="Something broke." reference="7F3A-91" onRetry={() => {}} />,
    );
    expect(html).toMatch(/^<div class="empty page">/);
    expect(html).toMatch(/<button type="button" class="btn primary sm /);
    expect(html).toContain("<h1 ");
    expect(html).toContain(">build<");
    expect(html).toContain("Ref 7F3A-91");
    expect(rule(".page")).toContain("min-height");
  });

  it("retrying: the button shows its spinner and can't be pressed again", () => {
    const html = render(<ErrorState title="Can’t load your jobs" onRetry={() => {}} retrying />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain(", loading");
  });

  it("no onRetry, no button; announce={false}, no status region", () => {
    const html = render(<ErrorState title="Can’t load your jobs" announce={false} />);
    expect(html).not.toContain("<button");
    expect(html).not.toContain('role="status"');
  });

  it("is said as one sentence", () => {
    expect(announcement("Can’t load your jobs", "Check your connection.")).toBe("Can’t load your jobs. Check your connection.");
    expect(announcement("Something broke.", "Try again in a minute.")).toBe("Something broke. Try again in a minute.");
    expect(announcement("Can’t load your jobs", undefined)).toBe("Can’t load your jobs");
  });
});

describe("<InlineError>", () => {
  it("is a red banner with a decorative error icon and a tertiary Try again at the end", () => {
    const html = render(<InlineError id="save-error" message="Couldn’t save." onRetry={() => {}} />);
    expect(html).toMatch(/^<div id="save-error" class="banner alert">/);
    expect(html).toMatch(/aria-hidden="true"[^>]*>error</);
    expect(html).toMatch(/class="btn tertiary[^"]*bannerAction"/);
    expect(rule(".alert")).toContain("var(--trade-danger-bg)");
    expect(rule(".bannerAction")).toContain("text-decoration: underline");
  });

  it("without onRetry it is just the message", () => {
    expect(render(<InlineError message="We couldn’t load the photos." />)).not.toContain("<button");
  });
});

describe("<OfflineBanner> and its hook", () => {
  it("shows nothing in server HTML (the browser decides), but keeps its labelled region and status region ready", () => {
    expect(render(<OfflineBanner onRetry={() => {}} />)).toBe(
      '<section aria-label="Connection" class="sticky"><span role="status" class="visuallyHidden"></span></section>',
    );
  });

  it("offline with a retry: wifi_off, the spec copy and Retry, stuck to the top inside its own landmark", () => {
    const html = render(<OfflineBanner online={false} onRetry={() => {}} />);
    expect(html).toMatch(/^<section aria-label="Connection" class="sticky"><div class="banner offline alert" data-offline="true">/);
    expect(html).toContain(">wifi_off<");
    expect(html).toContain("<b>Offline.</b>");
    expect(html).toMatch(/<button[^>]*>[\s\S]*Retry/);
    expect(rule(".sticky")).toContain("position: sticky");
  });

  it("offline with nothing to retry: the copy-sheet line and no button", () => {
    const html = render(<OfflineBanner online={false} sticky={false} />);
    expect(html).toContain("<b>Offline.</b>");
    expect(html).not.toContain("<button");
    // A preview inside a page: not sticky, and not a landmark of its own (three would clash).
    expect(html).not.toContain("sticky");
    expect(html).not.toContain("<section");
  });

  it("retries with backoff: 2s, 4s, 8s, 16s, then every 30s", () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(retryDelayMs)).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(retryDelayMs(-3)).toBe(2000);
  });
});

describe("what if the text is very long, or the page is zoomed to 200%", () => {
  it("headings, messages, labels and references wrap instead of spilling out", () => {
    for (const selector of [".title", ".message", ".reference", ".spinnerLabel", ".progressLabel"]) {
      expect(rule(selector), selector).toContain("overflow-wrap: anywhere");
    }
    expect(rule(".bannerText > span:last-child")).toContain("overflow-wrap: anywhere");
    expect(rule(".bannerText > span:last-child")).toContain("min-width: 0");
  });

  it("banners and action rows wrap onto more lines; the main action never grows past its column", () => {
    expect(rule(".banner")).toContain("flex-wrap: wrap");
    expect(rule(".actions")).toContain("flex-wrap: wrap");
    expect(rule(".actions > :first-child")).toContain("min-width: min(220px, 100%)");
  });

  it("a long unbroken word renders as text, not cut off", () => {
    const html = render(<EmptyState title={`No jobs near ${LONG_WORD}`} message={LONG_WORD} />);
    expect(html).toContain(LONG_WORD);
  });

  it("sizes come from tokens (rem), so they grow with the browser's zoom and text size", () => {
    expect(rule(".title")).toContain("var(--trade-fs-heading)");
    expect(rule(".message")).toContain("var(--trade-fs-small)");
    expect(rule(".banner")).toContain("var(--trade-fs-small)");
  });
});

describe("/dev/components/feedback", () => {
  const page = async (params: Record<string, string> = {}) =>
    render(await FeedbackPage({ searchParams: Promise.resolve(params) }));

  it("is a 404 in production builds", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(page()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("shows every component and state", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const html = await page();
    for (const id of ["skeletons", "loading", "progress", "empty", "errors", "offline", "long-text", "usage"]) {
      expect(html, id).toContain(`id="${id}"`);
    }
    for (const text of [
      "Nothing on yet.",
      "No matching jobs.",
      "Nothing finished.",
      "Can’t load your jobs",
      "Something broke.",
      "Ref 7F3A-91",
      "Couldn’t save.",
      "Retry",
      'role="progressbar"',
      "tm-skel",
    ]) {
      expect(html, text).toContain(text);
    }
    // Only the page's own h1: the demos use lower headings.
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });

  it("switches palette with ?mode= and keeps ?state= in the links", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(await page({ mode: "trade" })).toMatch(/^<div[^>]*data-mode="trade"/);
    expect(await page({ mode: "purple" })).toMatch(/^<div[^>]*data-mode="customer"/);
    expect(await page({ mode: "office", state: "empty" })).toContain('href="/dev/components/feedback?mode=trade&amp;state=empty"');
  });
});
