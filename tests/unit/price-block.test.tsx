// The price block must never show one side the other side's number (AGENTS.md §5: customers never see margins
// or estimates; tradies see what they earn, never the customer price). The type checks below run in
// `npm run typecheck`: each @ts-expect-error fails the build if that call ever becomes allowed.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  formatBreakdown,
  formatCents,
  PriceBlock,
  type PriceBlockProps,
  type TradiePriceBlockProps,
} from "@/components/status/PriceBlock";

const CUSTOMER_PRICE = 37200;
const TRADIE_EARNS = 25920;

const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ");

// Never called: these lines only exist for the type checker.
export function typeChecks() {
  return (
    <>
      {/* @ts-expect-error a tradie's block can't take the customer's price */}
      <PriceBlock audience="tradie" earnCents={TRADIE_EARNS} priceCents={CUSTOMER_PRICE} />
      {/* @ts-expect-error a customer's block can't take the tradie's pay */}
      <PriceBlock audience="customer" priceCents={CUSTOMER_PRICE} earnCents={TRADIE_EARNS} />
      {/* @ts-expect-error … or their pay breakdown */}
      <PriceBlock audience="customer" priceCents={CUSTOMER_PRICE} breakdown={{ minutes: 240, rateCents: 6480 }} />
      {/* @ts-expect-error a tradie's block needs what they earn, not the price */}
      <PriceBlock audience="tradie" priceCents={CUSTOMER_PRICE} />
      {/* @ts-expect-error every block says whose it is */}
      <PriceBlock priceCents={CUSTOMER_PRICE} />
    </>
  );
}

export function spreadCheck(job: { priceCents: number; earnCents: number }) {
  // A whole job row spread in still carries the customer's price, so it's refused too.
  // @ts-expect-error priceCents is `never` on the tradie's block
  const props: TradiePriceBlockProps = { audience: "tradie", ...job };
  return props;
}

describe("<PriceBlock>", () => {
  it("shows the customer their fixed price incl. GST", () => {
    const html = text(renderToString(<PriceBlock audience="customer" priceCents={CUSTOMER_PRICE} />));
    expect(html).toContain("Your price");
    expect(html).toContain("$372.00");
    expect(html).toContain("Fixed price · incl. GST");
  });

  it("shows the tradie what they earn and how it's made up", () => {
    const html = text(
      renderToString(
        <PriceBlock audience="tradie" earnCents={TRADIE_EARNS} breakdown={{ minutes: 240, rateCents: 6480, holidayPay: true }} />,
      ),
    );
    expect(html).toContain("You earn");
    expect(html).toContain("$259.20");
    expect(html).toContain("4 hrs × $64.80 + holiday pay");
    expect(html).not.toContain("Your price");
  });

  it("never shows a tradie the customer's price, even if it's smuggled past the types", () => {
    const smuggled = { audience: "tradie", earnCents: TRADIE_EARNS, priceCents: CUSTOMER_PRICE } as unknown as PriceBlockProps;
    const html = renderToString(<PriceBlock {...smuggled} />);
    expect(html).toContain("$259.20");
    expect(html).not.toContain("372");
  });

  it("never shows a customer the tradie's pay, even if it's smuggled past the types", () => {
    const smuggled = {
      audience: "customer",
      priceCents: CUSTOMER_PRICE,
      earnCents: TRADIE_EARNS,
      breakdown: { minutes: 240, rateCents: 6480, holidayPay: true },
    } as unknown as PriceBlockProps;
    const html = renderToString(<PriceBlock {...smuggled} />);
    expect(html).toContain("$372.00");
    expect(html).not.toMatch(/259|64\.80|You earn|holiday/);
  });

  it("server-renders the final number with no reveal, so a refresh never replays M09", () => {
    const html = renderToString(
      <PriceBlock audience="customer" priceCents={CUSTOMER_PRICE} revealId="price-ready:job-1" ticks={["Saying no is free"]} />,
    );
    expect(html).not.toMatch(/tm-anim-(wipe|underline|tick)/);
    // The visible number and the screen-reader copy are both the final price.
    expect(html.match(/\$372\.00/g)).toHaveLength(2);
  });

  it("lists the reassurance ticks", () => {
    const ticks = ["Labour, parts and call-out included", "Fixed: it won’t go up", "Saying no is free"];
    const html = renderToString(<PriceBlock audience="customer" priceCents={CUSTOMER_PRICE} ticks={ticks} />);
    for (const tick of ticks) expect(html).toContain(tick);
    expect(html.match(/<li/g)).toHaveLength(3);
  });

  it("keeps a very big price as one number", () => {
    expect(text(renderToString(<PriceBlock audience="customer" priceCents={123456789} />))).toContain("$1,234,567.89");
  });
});

describe("formatting", () => {
  it("formats whole cents as dollars", () => {
    expect(formatCents(25920)).toBe("$259.20");
    expect(formatCents(0)).toBe("$0.00");
  });

  it("writes the breakdown in hours", () => {
    expect(formatBreakdown({ minutes: 60, rateCents: 3800 })).toBe("1 hr × $38.00");
    expect(formatBreakdown({ minutes: 90, rateCents: 3800 })).toBe("1.5 hrs × $38.00");
  });
});
