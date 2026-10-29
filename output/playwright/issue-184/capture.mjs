import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const pass = process.argv[2] || "pass-1";
const dir = `output/playwright/issue-184/${pass}`;
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
const results = [];
for (const width of [1440, 390]) {
  const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 900 : 844 }, reducedMotion: "reduce" });
  for (const state of ["empty", "loading", "joined", "already-on-list", "error", "offline"]) {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:4284/dev/components/waitlist?state=${state}`);
    await page.getByRole("form", { name: "Waitlist", exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${dir}/${state}-${width}.png` });
    const info = await page.locator("main").evaluate((main) => {
      const words = [];
      const walk = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
      for (let node = walk.nextNode(); node; node = walk.nextNode()) {
        const el = node.parentElement;
        if (!el || el.closest('[aria-hidden="true"], [hidden]')) continue;
        let hidden = false;
        for (let ancestor = el; ancestor && ancestor !== main; ancestor = ancestor.parentElement) {
          const css = getComputedStyle(ancestor);
          if (css.visibility === "hidden" || css.display === "none" || css.opacity === "0" || css.clipPath === "inset(50%)") { hidden = true; break; }
        }
        if (hidden) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        if (range.getBoundingClientRect().height && node.textContent.trim()) words.push(node.textContent.trim());
      }
      for (const input of main.querySelectorAll("input")) words.push(input.value || input.placeholder);
      const text = words.join(" ");
      return { text, words: text.split(/\s+/u).filter(Boolean).length, overflow: document.documentElement.scrollWidth - innerWidth,
        emailRadius: getComputedStyle(main.querySelector('input[name="email"]').parentElement).borderRadius,
        emailHeight: main.querySelector('input[name="email"]').parentElement.getBoundingClientRect().height,
        buttonWidth: main.querySelector('button[type="submit"]').getBoundingClientRect().width,
        form: main.querySelector("form").getBoundingClientRect().toJSON(), heading: main.querySelector("h1").getBoundingClientRect().toJSON() };
    });
    const { violations } = await new AxeBuilder({ page }).analyze();
    results.push({ state, width, ...info, axe: violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length})) });
    await page.close();
  }
  await context.close();
}
await browser.close();
await writeFile(`${dir}/measurements.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map(({ state, width, words, overflow, axe })=>({ state, width, words, overflow, axe })),null,2));
