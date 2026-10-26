import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BountyPill } from "@/components/status/BountyPill";
import { Pill } from "@/components/status/Pill";
import { StatusPill } from "@/components/status/StatusPill";
import { Tracker } from "@/components/status/Tracker";
import { AUDIENCES, JOB_STATUSES, statusPill } from "@/lib/job-status";
import { jobTracker } from "@/lib/job-tracker";

/** What a screen reader reads: no React text markers, nothing aria-hidden (icon ligatures), no tags. */
const text = (html: string) =>
  html
    .replace(/<!-- -->/g, "")
    .replace(/<span[^>]*aria-hidden="true"[^>]*>[^<]*<\/span>/g, "")
    .replace(/<[^>]+>/g, "");

describe("<StatusPill>", () => {
  it("shows the status as words for every status and audience that sees it", () => {
    for (const status of JOB_STATUSES) {
      for (const audience of AUDIENCES) {
        const pill = statusPill(status, audience);
        const html = renderToString(<StatusPill status={status} audience={audience} />);
        if (!pill) {
          expect(html, `${status} ${audience}`).toBe("");
          continue;
        }
        expect(text(html)).toBe(pill.label);
        expect(html).toContain(`data-kind="${pill.kind}"`);
      }
    }
  });

  it("doesn't animate on first render, so a refresh never replays M25", () => {
    const html = renderToString(<StatusPill status="PRICED" audience="customer" announce />);
    expect(html).not.toContain("tm-anim-status");
    expect(html).toContain("tm-swap");
  });

  it("announces changes only when asked (the pill at the top of a job page)", () => {
    expect(renderToString(<StatusPill status="PRICED" audience="customer" announce />)).toContain('role="status"');
    expect(renderToString(<StatusPill status="PRICED" audience="customer" />)).not.toContain('role="status"');
  });

  it("keeps a live region even when the status is hidden, so a later change is still announced", () => {
    expect(renderToString(<StatusPill status="PRICED" audience="tradie" announce />)).toBe('<span role="status"></span>');
  });

  it("uses the context the server passes", () => {
    const html = renderToString(<StatusPill status="ASSIGNED" audience="tradie" context={{ customerFirstName: "Sarah" }} />);
    expect(text(html)).toBe("Message Sarah");
  });
});

describe("<Pill>", () => {
  it("keeps a decorative dot next to the words, so colour is never the only signal", () => {
    const html = renderToString(<Pill kind="good">Paid</Pill>);
    expect(html).toMatch(/<span[^>]*aria-hidden="true"><\/span><span[^>]*>Paid<\/span>/);
  });

  it("wraps a very long label by default, and can truncate with the full label as a tooltip", () => {
    const long = "Waiting on Wiremu Hēnare-Fitzgerald to approve the extra work";
    expect(renderToString(<Pill kind="action">{long}</Pill>)).not.toContain("title=");
    const truncated = renderToString(
      <Pill kind="action" truncate>
        {long}
      </Pill>,
    );
    expect(truncated).toContain(`title="${long}"`);
    // Screen readers still get every word.
    expect(text(truncated)).toBe(long);
  });
});

describe("<BountyPill>", () => {
  it("is gold with the paid icon hidden from screen readers", () => {
    const html = renderToString(<BountyPill />);
    expect(html).toContain('data-kind="bounty"');
    expect(html).toMatch(/aria-hidden="true"[^>]*>paid<\/span>/);
    expect(text(html)).toBe("Quote bounty");
  });

  it("adds the time left or distance, and the M27 glint on request", () => {
    expect(text(renderToString(<BountyPill label="Bounty" detail="17h" />))).toContain("Bounty · 17h");
    expect(renderToString(<BountyPill />)).not.toContain("tm-glint");
    expect(renderToString(<BountyPill glint />)).toContain("tm-glint");
  });
});

describe("<Tracker>", () => {
  const model = jobTracker("BOOKABLE", "customer")!;

  it("is a named ordered list with the current step marked", () => {
    const html = renderToString(<Tracker {...model} />);
    expect(html).toMatch(/^<ol[^>]*aria-label="Job progress"/);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html.replace(/<!-- -->/g, "")).toMatch(/aria-current="step"[^>]*>.*Now: .*Tradie on the way/);
  });

  it("says each step's state in words for screen readers", () => {
    const html = text(renderToString(<Tracker {...model} />));
    expect(html).toContain("Done: Posted");
    expect(html).toContain("Done: Price accepted");
    expect(html).toContain("Now: Tradie on the wayFinding someone local");
    expect(html).toContain("To do: Sorted");
  });

  it("doesn't animate on first render (M11 only plays when the step moves on)", () => {
    expect(renderToString(<Tracker {...model} />)).not.toMatch(/tm-anim-(fill|step-dot|step-label)/);
  });

  it("shows every step done once the job is sorted, with no current step", () => {
    const done = jobTracker("COMPLETED", "customer")!;
    const html = renderToString(<Tracker {...done} />);
    expect(html).not.toContain("aria-current");
    expect(html.match(/data-state="done"/g)).toHaveLength(done.steps.length);
  });

  it("keeps a very long name in full", () => {
    const name = "Wiremu Hēnare-Fitzgerald-MacPherson of Invercargill Electrical Services Limited";
    const html = renderToString(<Tracker steps={[{ label: "Tradie confirmed", note: name }]} current={0} />);
    expect(text(html)).toContain(name);
  });

  it("clamps a current step outside the list", () => {
    const html = renderToString(<Tracker steps={[{ label: "A" }, { label: "B" }]} current={9} />);
    expect(html.match(/data-state="done"/g)).toHaveLength(2);
  });
});
