import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { PEOPLE } from "../../prisma/seed/data.mjs";
import { sessionChecks, sessionCookies } from "./auth-stub";
import { OUT } from "./global-setup";
import { resolvePlan, type PlanEntry } from "./shots";

// Takes every planned screenshot (#90) at 1440 and 390 px, signed in as the shot's demo account, with reduced
// motion on. Writes `<id>-<width>.png` and `results/<id>.json` for scripts/ci/screenshots.mjs to turn into the
// PR comment.

const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

const plan = JSON.parse(readFileSync(join(OUT, "plan.json"), "utf8")) as { entries: PlanEntry[] };
const { shots } = resolvePlan(plan.entries);

for (const shot of shots) {
  test(shot.label, async ({ browser, baseURL }) => {
    const files: Record<string, string> = {};
    const notes = new Set<string>();

    for (const viewport of WIDTHS) {
      const context = await browser.newContext({ viewport, reducedMotion: "reduce", deviceScaleFactor: 1 });
      try {
        const person = shot.account ? PEOPLE[shot.account] : null;
        if (person) {
          const secret = process.env.SCREENSHOTS_STUB_SECRET ?? "";
          await context.addCookies(await sessionCookies({ id: person.id, email: person.email }, secret, baseURL ?? ""));
        }
        const checksBefore = person ? await sessionChecks(person.id) : 0;
        const page = await context.newPage();
        const response = await page.goto(shot.url, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready.then(() => undefined));

        const finalUrl = new URL(page.url());
        const wanted = new URL(shot.url, baseURL);
        if (finalUrl.pathname !== wanted.pathname) notes.add(`redirected to ${finalUrl.pathname}${finalUrl.search}`);
        const status = response?.status() ?? 0;
        if (status >= 400) notes.add(`HTTP ${status}`);

        // Proof the sign-in took: the app checked this person's session, and the layout paints their role's
        // colours (<html data-mode>).
        if (person) {
          expect(await sessionChecks(person.id), `the app checked ${person.email}'s session`).toBeGreaterThan(checksBefore);
        }
        if (shot.expectMode) {
          await expect(page.locator("html"), `signed in as ${shot.account}`).toHaveAttribute("data-mode", shot.expectMode);
        }

        const file = `${shot.id}-${viewport.width}.png`;
        await page.screenshot({ path: join(OUT, file), fullPage: true, animations: "disabled", caret: "hide" });
        files[String(viewport.width)] = file;
      } finally {
        await context.close();
      }
    }

    writeFileSync(
      join(OUT, "results", `${shot.id}.json`),
      `${JSON.stringify({ id: shot.id, label: shot.label, url: shot.url, files, notes: [...notes] }, null, 2)}\n`,
    );
  });
}
