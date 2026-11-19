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

  test(`${width}px explicitly requested loading preview keeps its skeleton`, async ({ page }) => {
    const url = "/dev/components/worker-claim?state=loading";
    await page.setViewportSize({ width, height: 844 });
    await page.route("http://shots.test/**", route => route.fulfill({ contentType: "text/html", body: loading }));
    await page.goto(`http://shots.test${url}`);
    expect(await waitForCaptureContent(page, { url, expectMode: null }, 500)).toBeNull();
    const pixel = await sharp(await page.screenshot()).extract({ left: 20, top: 400, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    expect([...pixel]).toEqual([255, 0, 0]);
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
