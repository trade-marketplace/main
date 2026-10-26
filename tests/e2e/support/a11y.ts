import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

import { formatViolations } from "./format-violations";

export type A11yOptions = {
  /** Only check inside this CSS selector (e.g. a dialog that just opened). Default: the whole page. */
  include?: string;
  /** Skip a part of the page we don't control (e.g. a third-party map canvas). */
  exclude?: string[];
  /**
   * Turn off axe rules. Every entry needs a reason, which is printed with the results, and the PR needs
   * Matt's review: switching a rule off hides a problem rather than fixing it.
   */
  disableRules?: { id: string; reason: string }[];
};

/**
 * Runs axe (every rule axe ships: WCAG 2.0–2.2 A/AA and best practices) on the page as it is now,
 * and fails the test if there is any violation, listing each one and where it is.
 */
export async function expectNoA11yViolations(page: Page, options: A11yOptions = {}): Promise<void> {
  let builder = new AxeBuilder({ page });
  if (options.include) builder = builder.include(options.include);
  for (const selector of options.exclude ?? []) builder = builder.exclude(selector);
  if (options.disableRules?.length) builder = builder.disableRules(options.disableRules.map((rule) => rule.id));

  const { violations } = await builder.analyze();

  const size = page.viewportSize();
  const where = `${new URL(page.url()).pathname}${size ? ` at ${size.width}px` : ""}`;
  const skipped = (options.disableRules ?? []).map((rule) => `\n(rule "${rule.id}" off: ${rule.reason})`).join("");

  expect(violations, `${formatViolations(violations, where)}${skipped}`).toEqual([]);
}
