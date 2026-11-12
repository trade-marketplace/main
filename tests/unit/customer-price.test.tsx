import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PriceReadyPanel } from "@/components/jobs/customer/PriceReadyPanel";
import { DECLINE_PRICE_REASONS, claimPriceReveal, hasPreviousPrice, priceReadyTicks } from "@/lib/customer-price";
import { exampleJob, VIEWERS } from "@/app/dev/components/job-views/preview-data";
import { customerJobView } from "@/server/views";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

describe("price ready", () => {
  const job = customerJobView(VIEWERS.customer, exampleJob({ status: "PRICED" }))!;
  it("shows only the two applicable promises outside electrical, and keeps customer money private", () => {
    for (const category of ["ELECTRICAL", "PLUMBING", "GAS", "CONSTRUCTION", "OTHER"] as const) {
      const html = renderToStaticMarkup(<PriceReadyPanel job={{ ...job, category }} online />);
      expect(priceReadyTicks(category)).toHaveLength(category === "ELECTRICAL" ? 3 : 2);
      expect(html.includes("Licensed electrician")).toBe(category === "ELECTRICAL");
      for (const text of ["Your price", "Fixed price · incl. GST", "Accept &amp; pay", "No thanks", "Saying no is free."]) expect(html).toContain(text);
      expect(html).not.toMatch(/estimates|averages|margins|workerGross|workerRate|holiday pay|Earn/);
    }
  });
  it("strikes through only a different earlier customer price with an accessible announcement", () => {
    for (const previous of [null, 37200, 42000]) {
      expect(hasPreviousPrice(job.priceCents, previous)).toBe(previous === 42000);
      const html = renderToStaticMarkup(<PriceReadyPanel job={job} online previousPriceCents={previous} />);
      expect(html.includes("<del")).toBe(previous === 42000);
      if (previous === 42000) expect(html).toContain("Was $420.00, now $372.00");
    }
    expect(hasPreviousPrice(null, 42000)).toBe(false);
  });
  it("remembers a reveal once per job, including a first reduced-motion visit, and never animates on failed storage", () => {
    const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(claimPriceReveal("first", storage, false)).toBe(true);
    expect(values.get("tm:price-seen:first")).toBe("1");
    expect(claimPriceReveal("first", storage, false)).toBe(false);
    expect(claimPriceReveal("second", storage, true)).toBe(false);
    expect(claimPriceReveal("second", storage, false)).toBe(false);
    expect(claimPriceReveal("third", { ...storage, getItem: () => { throw Error(); } }, false)).toBe(false);
    expect(claimPriceReveal("fourth", { ...storage, setItem: () => { throw Error(); } }, false)).toBe(false);
  });
  it("uses the dialog's exact optional choices and disables both actions offline or while paying", () => {
    expect(DECLINE_PRICE_REASONS).toEqual(["Too expensive", "Changed my mind", "Found someone else", "Something else"]);
    const dialog = renderToStaticMarkup(<PriceReadyPanel job={job} online preview="decline" />);
    for (const text of ["No worries.", "Want to tell us why? (optional)", "Go back", ...DECLINE_PRICE_REASONS]) expect(dialog).toContain(text);
    for (const props of [{ online: false }, { online: true, preview: "paying" }]) {
      const html = renderToStaticMarkup(<PriceReadyPanel job={job} {...props} />);
      expect(html.match(/aria-disabled="true"/g)?.length).toBe(2);
      if (!props.online) expect(html).toContain("You’re offline");
    }
  });
});
