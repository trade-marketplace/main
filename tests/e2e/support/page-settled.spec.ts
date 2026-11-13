import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectNoA11yViolations } from "./a11y";
import { waitForPageSettled } from "./page-settled";

test("waits for the correct restored title rather than accepting an old nonempty title", async ({ page }) => {
  await page.setContent("<html lang='en'><head><title>Old title</title></head><body><main><h1>Settled page</h1></main></body></html>");
  await page.evaluate(() => {
    const entrance = document.querySelector("h1")!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500 });
    void entrance.finished.then(() => { document.title = "Correct title"; });
  });
  await waitForPageSettled(page, "Correct title");
  await expect(page).toHaveTitle("Correct title");
  await expectNoA11yViolations(page);
});

test("waits for entrance opacity before axe without finishing an infinite decoration", async ({ page }) => {
  await page.setContent("<html lang='en'><head><title>Animation fixture</title></head><body><main><h1>Readable heading</h1><span aria-hidden='true'>·</span></main></body></html>");
  await page.evaluate(() => {
    document.querySelector("h1")!.animate([{ opacity: 0.05 }, { opacity: 1 }], { duration: 500 });
    document.querySelector("span")!.animate([{ opacity: 0.5 }, { opacity: 1 }], { duration: 500, iterations: Infinity });
  });
  await waitForPageSettled(page, "Animation fixture");
  expect(await page.locator("h1").evaluate(element => getComputedStyle(element).opacity)).toBe("1");
  expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running").length)).toBe(1);
  await expectNoA11yViolations(page);
});

test("does not finish while a requested font is still loading", async ({ page, baseURL }) => {
  const font = await readFile(new URL("../../../public/fonts/roboto-flex/RobotoFlex.woff2", import.meta.url));
  const fontUrl = new URL("/settled-font-fixture.woff2", baseURL).href;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(fontUrl, async route => {
    await held;
    await route.fulfill({ contentType: "font/woff2", headers: { "access-control-allow-origin": "*" }, body: font });
  });
  await page.setContent("<html lang='en'><head><title>Font fixture</title></head><body><main><h1>Readable heading</h1></main></body></html>");
  await page.evaluate(url => {
    const font = new FontFace("Held fixture", `url(${url})`);
    document.fonts.add(font);
    document.querySelector<HTMLElement>("h1")!.style.fontFamily = "'Held fixture'";
    void font.load();
  }, fontUrl);
  await page.waitForFunction(() => document.fonts.status === "loading");
  const settled = waitForPageSettled(page, "Font fixture");
  try {
    const outcome = await Promise.race([
      settled.then(() => "settled"),
      page.evaluate(async () => {
        for (let frame = 0; frame < 8; frame++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        return "font pending";
      }),
    ]);
    expect(outcome).toBe("font pending");
  } finally { release(); }
  await settled;
  expect(await page.evaluate(() => document.fonts.status)).toBe("loaded");
  await expectNoA11yViolations(page);
});

test("global axe audits a live toast instead of waiting for its lifecycle clock to dismiss it", async ({ page }) => {
  await page.setContent(`<html lang="en"><head><title>Live toast</title><style>
    @keyframes tm-time-left { from { transform: scaleX(1); } to { transform: scaleX(0); } }
    .clock { display: block; width: 100px; height: 1px; animation: tm-time-left 60s linear forwards; }
    </style></head><body><main><h1>Toast audit</h1><div role="status" id="toast">Saved.<button></button><span class="clock" aria-hidden="true"></span></div></main></body></html>`);
  await page.evaluate(() => {
    const toast = document.querySelector("#toast")!;
    toast.animate([{ opacity: 0.1 }, { opacity: 1 }], { duration: 500 });
    document.querySelector(".clock")!.addEventListener("animationend", () => toast.remove());
  });
  await expect(expectNoA11yViolations(page)).rejects.toThrow("button-name");
  await expect(page.getByRole("status")).toBeVisible();
  expect(await page.locator("#toast").evaluate(element => getComputedStyle(element).opacity)).toBe("1");
  expect(await page.evaluate(() => document.getAnimations().some(animation =>
    animation instanceof CSSAnimation && animation.animationName === "tm-time-left" && animation.playState === "running"))).toBe(true);
});

test("global axe audits an intentionally held loading read without releasing it", async ({ page, baseURL }) => {
  const fixture = new URL("/settled-loading-fixture", baseURL).href;
  const read = new URL("/settled-loading-fixture?_rsc=fixture", baseURL).href;
  let release!: () => void, seen!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { seen = resolve; });
  await page.route(fixture, route => route.fulfill({ contentType: "text/html", body: '<html lang="en"><head><title>Loading audit</title></head><body><main aria-busy="true"><h1>Job</h1><p role="status">Loading the job</p></main></body></html>' }));
  await page.route(read, async route => { seen(); await held; await route.fulfill({ contentType: "text/x-component", body: "loaded" }); });
  await page.goto(fixture);
  const responded = page.waitForResponse(read);
  await page.evaluate(url => { void fetch(url, { headers: { rsc: "1" } }).then(response => response.text()); }, read);
  await requested;
  try {
    await expectNoA11yViolations(page);
    await expect(page.getByRole("status")).toHaveText("Loading the job");
    expect((await page.requests()).find(request => request.url() === read)?.timing().responseEnd).toBe(-1);
  } finally { release(); }
  await responded;
});

test("a non-busy refresh is allowed to finish before global axe reads its restored title", async ({ page, baseURL }) => {
  const fixture = new URL("/settled-refresh-fixture", baseURL).href;
  const read = new URL("/settled-refresh-fixture?_rsc=fixture", baseURL).href;
  let release!: () => void, seen!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { seen = resolve; });
  await page.route(fixture, route => route.fulfill({ contentType: "text/html", body: '<html lang="en"><head><title>Refresh audit</title></head><body><main><h1>Job</h1></main></body></html>' }));
  await page.route(read, async route => { seen(); await held; await route.fulfill({ contentType: "text/x-component", body: "refreshed" }); });
  await page.goto(fixture);
  await page.evaluate(url => {
    void fetch(url, { headers: { rsc: "1" } }).then(async response => {
      await response.text();
      document.title = "";
      await document.querySelector("h1")!.animate([{ opacity: 0.1 }, { opacity: 1 }], { duration: 500 }).finished;
      document.title = "Restored refresh title";
    });
  }, read);
  await requested;
  const audit = expectNoA11yViolations(page);
  try {
    const outcome = await Promise.race([
      audit.then(() => "audited"),
      page.evaluate(async () => {
        for (let frame = 0; frame < 8; frame++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        return "refresh pending";
      }),
    ]);
    expect(outcome).toBe("refresh pending");
  } finally { release(); }
  await audit;
  await expect(page).toHaveTitle("Restored refresh title");
});

test("global axe takes a new full snapshot if metadata changes during its analysis", async ({ page }) => {
  await page.setContent('<html lang="en"><head><title>Metadata snapshot</title></head><body><main><h1>Readable heading</h1></main></body></html>');
  await page.evaluate(() => {
    let axe: unknown;
    const state = window as unknown as { auditInjections: number };
    state.auditInjections = 0;
    Object.defineProperty(window, "axe", {
      configurable: true,
      get: () => axe,
      set: value => {
        axe = value;
        if (++state.auditInjections !== 1) return;
        document.title = "";
        void document.querySelector("h1")!.animate([{ transform: "translateX(0)" }, { transform: "translateX(0)" }], { duration: 500 }).finished.then(() => {
          document.title = "Metadata snapshot";
        });
      },
    });
  });
  await expectNoA11yViolations(page);
  await expect(page).toHaveTitle("Metadata snapshot");
  expect(await page.evaluate(() => (window as unknown as { auditInjections: number }).auditInjections)).toBeGreaterThanOrEqual(2);
});

test("a real non-title violation is retained when metadata changes and the toast then expires", async ({ page }) => {
  await page.setContent(`<html lang="en"><head><title>Expiring toast</title><style>
    @keyframes tm-time-left { from { transform: scaleX(1); } to { transform: scaleX(0); } }
    .clock { display: block; width: 100px; height: 1px; animation: tm-time-left 60s linear forwards; }
    </style></head><body><main><h1>Toast audit</h1><div role="status" id="toast">Saved.<button></button><span class="clock" aria-hidden="true"></span></div></main></body></html>`);
  await page.evaluate(() => {
    document.querySelector(".clock")!.addEventListener("animationend", () => document.querySelector("#toast")?.remove());
  });
  const analyze = AxeBuilder.prototype.analyze;
  let first = true, capturedButtonViolation = false;
  AxeBuilder.prototype.analyze = async function () {
    const result = await analyze.call(this); // Always use the real full-rule engine; never fabricate its result.
    if (first) {
      first = false;
      capturedButtonViolation = result.violations.some(violation => violation.id === "button-name");
      await page.evaluate(() => {
        document.title = "";
        // The real violation has been captured. Let this fixture's running clock expire before metadata returns.
        document.querySelector<HTMLElement>(".clock")!.style.animationDuration = "100ms";
        void document.querySelector("h1")!.animate([{ transform: "translateX(0)" }, { transform: "translateX(0)" }], { duration: 500 }).finished.then(() => {
          document.title = "Expiring toast";
        });
      });
    }
    return result;
  };
  try { await expect(expectNoA11yViolations(page)).rejects.toThrow("button-name"); }
  finally { AxeBuilder.prototype.analyze = analyze; }
  await expect(page).toHaveTitle("Expiring toast");
  await expect(page.locator("#toast")).toHaveCount(0);
  expect(capturedButtonViolation).toBe(true);
});
