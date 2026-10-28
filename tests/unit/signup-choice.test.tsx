import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import SignupPage from "@/app/signup/page";
import { detailsHref, ROLE_CHOICES, SignupChoice } from "@/components/auth/SignupChoice";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const text = (html: string) =>
  html
    .replace(/<span[^>]*aria-hidden="true"[^>]*>[^<]*<\/span>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

describe("detailsHref", () => {
  it("goes to that side's details, keeping where they were headed", () => {
    expect(detailsHref("customer")).toBe("/signup/customer");
    expect(detailsHref("tradie", "/jobs/new?title=Fix tap")).toBe("/signup/tradie?next=%2Fjobs%2Fnew%3Ftitle%3DFix%20tap");
  });
});

describe("SignupChoice", () => {
  it("names the account choices without extra descriptions, customer chosen to start", () => {
    const html = renderToString(<SignupChoice />);
    expect(html).toMatch(/<fieldset[^>]*aria-label="Account type"/);
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html).toMatch(/<input type="radio"[^>]*name="role" checked="" value="customer"/);
    expect(html).not.toMatch(/checked="" value="tradie"/);
    for (const choice of ROLE_CHOICES) expect(text(html)).toContain(choice.title);
    expect(text(html)).not.toMatch(/paperwork/i);
  });

  it("paints the page in the chosen side's colours", () => {
    expect(renderToString(<SignupChoice />)).toMatch(/<div data-mode="customer"/);
    const tradie = renderToString(<SignupChoice initialRole="tradie" />);
    expect(tradie).toMatch(/<div data-mode="trade"/);
    expect(tradie).toMatch(/checked="" value="tradie"/);
  });

  it("has Next and a way to log in instead, keeping the deep link on both", () => {
    const html = renderToString(<SignupChoice next="/dashboard" />);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>[\s\S]*Next/);
    expect(html).toContain('action="/signup/customer?next=%2Fdashboard"');
    expect(html).toContain('href="/login?next=%2Fdashboard"');
  });

  it("has one h1 and the envelope illustration", () => {
    const html = renderToString(<SignupChoice />);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(text(html)).toContain("Create account");
    expect(html).toMatch(/mail\.png/);
  });
});

describe("/signup", () => {
  const page = async (params: Record<string, string>) =>
    renderToString(await SignupPage({ searchParams: Promise.resolve(params) }));

  it("starts on the tradie card from ?as=tradie (links from For tradies)", async () => {
    expect(await page({ as: "tradie" })).toMatch(/data-mode="trade"/);
    expect(await page({ as: "nonsense" })).toMatch(/data-mode="customer"/);
  });

  it("passes on a deep link only if it's one of our own paths", async () => {
    expect(await page({ next: "/jobs/new" })).toContain("next=%2Fjobs%2Fnew");
    expect(await page({ next: "//evil.example" })).not.toContain("evil");
    expect(await page({ next: "https://evil.example" })).not.toContain("evil");
  });
});
