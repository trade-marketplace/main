import { expect, test } from "@playwright/test";
import sharp from "sharp";

import { JOBS } from "../../prisma/seed/data.mjs";
import { waitForCaptureContent } from "../../scripts/screenshots/readiness";

const job = JOBS.find(row => row.steps.at(-1)?.[0] === "ASSIGNED")!;
const jobShot = { url: `/jobs/${job.id}`, status: "ASSIGNED", expectMode: "trade" } as const;
const loading = '<main><div role="status" aria-label="Loading job" style="background:red;height:100vh"><h1>Job</h1><span class="tm-skel">Loading</span></div></main>';

for (const width of [390, 1440]) {
  test(`${width}px screenshot waits for the assigned job and reports a captured fallback`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route("http://shots.test/**", route => route.fulfill({ contentType: "text/html", body: loading }));
    await page.goto(`http://shots.test${jobShot.url}`, { waitUntil: "load" });
    await expect(page.getByRole("status")).toBeVisible();
    expect(await waitForCaptureContent(page, jobShot, 100)).toBe("still loading at capture");
    await expect(page.getByRole("status")).toBeVisible();
    // Delay the streamed content beyond load. A generic page heading or the end of the fallback is insufficient.
    await page.evaluate(title => {
      const main = document.querySelector("main")!;
      main.innerHTML = "<h1>Job</h1>";
      window.setTimeout(() => {
        main.innerHTML = '<h1></h1><div aria-busy="true">Preparing booking</div>';
        main.querySelector("h1")!.textContent = title;
        window.setTimeout(() => {
          main.querySelector("div")!.outerHTML = '<a href="book">Book a time</a>';
          document.body.style.background = "rgb(0, 128, 0)";
        }, 150);
      }, 250);
    }, job.title);
    expect(await waitForCaptureContent(page, jobShot)).toBeNull();
    expect(await page.getByRole("link", { name: "Book a time" }).isVisible()).toBe(true);
    const pixel = await sharp(await page.screenshot()).extract({ left: width - 1, top: 400, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    expect([...pixel]).toEqual([0, 128, 0]);
  });

  test(`${width}px office screenshot waits for All jobs and its requested customer filter`, async ({ page }) => {
    const url = "/admin/jobs?customer=de000000-0000-4000-8000-000000000001";
    const shot = { url, expectMode: "office" } as const;
    await page.setViewportSize({ width, height: 844 });
    await page.route("http://shots.test/**", route => route.fulfill({
      contentType: "text/html", body: '<main><h1>Today</h1><div aria-busy="true">Queue totals</div></main>',
    }));
    await page.goto(`http://shots.test${url}`);
    expect(await waitForCaptureContent(page, shot, 100)).toBe("still loading at capture");

    await page.locator("main").evaluate(main => {
      main.innerHTML = '<h1>Today</h1><section hidden><h1>All jobs</h1><button>Remove customer filter: Sam</button></section>';
    });
    const missing = "All jobs or the requested customer filter did not appear before capture";
    expect(await waitForCaptureContent(page, shot, 100)).toBe(missing);
    await page.locator("main").evaluate(main => { main.innerHTML = "<h1>All jobs</h1>"; });
    expect(await waitForCaptureContent(page, shot, 100)).toBe(missing);

    await page.evaluate(() => {
      setTimeout(() => document.querySelector("main")!.insertAdjacentHTML("beforeend", "<button>Remove customer filter: Sam</button>"), 250);
    });
    expect(await waitForCaptureContent(page, shot)).toBeNull();
    expect(await page.getByRole("button", { name: "Remove customer filter: Sam" }).isVisible()).toBe(true);
  });

  test(`${width}px explicitly requested loading preview keeps its skeleton`, async ({ page }) => {
    const url = "/dev/components/worker-claim?state=loading";
    await page.setViewportSize({ width, height: 844 });
    await page.route("http://shots.test/**", route => route.fulfill({ contentType: "text/html", body: loading }));
    await page.goto(`http://shots.test${url}`);
    expect(await waitForCaptureContent(page, { url, expectMode: null }, 500)).toBeNull();
    const pixel = await sharp(await page.screenshot()).extract({ left: 20, top: 400, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    expect([...pixel]).toEqual([255, 0, 0]);
  });

  test(`${width}px settled gallery retains its persistent loading example`, async ({ page }) => {
    const url = width === 390 ? "/dev/components/worker-workspace?state=recovery-gallery" : "/dev/components/board-map?state=gallery";
    await page.setViewportSize({ width, height: 844 });
    await page.route("http://shots.test/**", route => route.fulfill({ contentType: "text/html", body: loading }));
    await page.goto(`http://shots.test${url}`);
    expect(await waitForCaptureContent(page, { url, expectMode: "trade" }, 100)).toBe("component gallery content did not appear before capture");
    await page.evaluate(() => {
      document.querySelector("main")!.innerHTML = '<h1>Map states</h1><section><h2>Loading</h2><div aria-busy="true"><span class="tm-skel">Loading your jobs</span></div></section>';
    });
    expect(await waitForCaptureContent(page, { url, expectMode: "trade" }, 500)).toBeNull();
    await expect(page.getByText("Loading your jobs")).toBeVisible();
  });
}

test("ordinary routes wait for visible loading regions and ignore hidden regions", async ({ page }) => {
  const url = "/messages";
  await page.route("http://shots.test/**", route => route.fulfill({ contentType: "text/html", body: loading }));
  await page.goto(`http://shots.test${url}`);
  await page.evaluate(() => {
    window.setTimeout(() => {
      document.querySelector("main")!.innerHTML = '<div aria-busy="true" hidden></div><h1>Messages</h1>';
    }, 250);
  });
  expect(await waitForCaptureContent(page, { url, expectMode: null })).toBeNull();
  await expect(page.getByRole("heading", { name: "Messages" })).toBeVisible();
});

test("a compound component loading state can show its pending button", async ({ page }) => {
  const url = "/dev/components/recovery?state=reset-loading";
  await page.route("http://shots.test/**", route => route.fulfill({
    contentType: "text/html", body: '<main><button aria-busy="true">Saving</button></main>',
  }));
  await page.goto(`http://shots.test${url}`);
  expect(await waitForCaptureContent(page, { url, expectMode: null }, 500)).toBeNull();
});

test("an unfiltered office jobs screenshot accepts the finished list without a customer chip", async ({ page }) => {
  const url = "/admin/jobs";
  await page.route("http://shots.test/**", route => route.fulfill({ contentType: "text/html", body: "<main><h1>All jobs</h1></main>" }));
  await page.goto(`http://shots.test${url}`);
  expect(await waitForCaptureContent(page, { url, expectMode: "office" })).toBeNull();
});

test("the Today queue belongs on the office home but is an inherited fallback on a subpage", async ({ page }) => {
  const body = '<main><h1>Today</h1><div role="group" aria-label="Queue totals">Jobs</div></main>';
  await page.route("http://shots.test/**", route => route.fulfill({ contentType: "text/html", body }));
  await page.goto("http://shots.test/admin/customers");
  expect(await waitForCaptureContent(page, { url: "/admin/customers", expectMode: "office" }, 100))
    .toBe("inherited Today queue still visible at capture");
  await page.goto("http://shots.test/admin");
  expect(await waitForCaptureContent(page, { url: "/admin", expectMode: "office" })).toBeNull();
});
