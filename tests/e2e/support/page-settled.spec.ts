import { readFile } from "node:fs/promises";
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

test("explicit settling preserves a live toast instead of waiting for its lifecycle clock to dismiss it", async ({ page }) => {
  await page.setContent(`<html lang="en"><head><title>Live toast</title><style>
    @keyframes tm-time-left { from { transform: scaleX(1); } to { transform: scaleX(0); } }
    .clock { display: block; width: 100px; height: 1px; animation: tm-time-left 60s linear forwards; }
    </style></head><body><main><h1>Toast audit</h1><div role="status" id="toast">Saved.<button></button><span class="clock" aria-hidden="true"></span></div></main></body></html>`);
  await page.evaluate(() => {
    const toast = document.querySelector("#toast")!;
    toast.animate([{ opacity: 0.1 }, { opacity: 1 }], { duration: 500 });
    document.querySelector(".clock")!.addEventListener("animationend", () => toast.remove());
  });
  await waitForPageSettled(page, "Live toast");
  await expect(expectNoA11yViolations(page)).rejects.toThrow("button-name");
  await expect(page.getByRole("status")).toBeVisible();
  expect(await page.locator("#toast").evaluate(element => getComputedStyle(element).opacity)).toBe("1");
  expect(await page.evaluate(() => document.getAnimations().some(animation =>
    animation instanceof CSSAnimation && animation.animationName === "tm-time-left" && animation.playState === "running"))).toBe(true);
});

test("explicit settling preserves an intentionally held loading read without releasing it", async ({ page, baseURL }) => {
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
    await waitForPageSettled(page, "Loading audit");
    await expectNoA11yViolations(page);
    await expect(page.getByRole("status")).toHaveText("Loading the job");
    expect((await page.requests()).find(request => request.url() === read)?.timing().responseEnd).toBe(-1);
  } finally { release(); }
  await responded;
});

test("an action's old identical title cannot settle before its delayed metadata commit", async ({ page }) => {
  await page.setContent('<html lang="en"><head><title>Declared title</title></head><body><main><h1>Metadata audit</h1><button>Refresh</button></main></body></html>');
  await page.evaluate(() => {
    document.querySelector("button")!.addEventListener("click", () => {
      window.addEventListener("commit-fixture-metadata", () => {
        const title = document.querySelector("title")!;
        title.remove();
        // Identical text still belongs to a new metadata generation.
        document.head.append(title);
      }, { once: true });
    });
  });
  let actionReturned!: () => void;
  const returned = new Promise<void>(resolve => { actionReturned = resolve; });
  const settled = waitForPageSettled(page, "Declared title", async () => {
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    actionReturned();
  });
  await returned;
  try {
    const outcome = await Promise.race([
      settled.then(() => "settled"),
      page.evaluate(async () => {
        for (let frame = 0; frame < 8; frame++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        return "metadata pending";
      }),
    ]);
    expect(outcome).toBe("metadata pending");
  } finally { await page.evaluate(() => window.dispatchEvent(new Event("commit-fixture-metadata"))); }
  await settled;
  await expectNoA11yViolations(page);
});
