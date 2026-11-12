import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { canEditReview, reviewDate, type CustomerReview } from "@/lib/customer-review";
import { ReviewCard } from "@/components/jobs/customer/ReviewCard";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const now = Date.parse("2026-11-12T00:00:00Z");
describe("finished-job review card", () => {
  it("keeps Post review off and hides tags/comment until a star is picked", () => {
    const data = { workerFirstName: "Jack", review: null };
    const empty = renderToStaticMarkup(<ReviewCard jobId="job" data={data} online preview="none" now={now} />);
    expect(empty).toContain("How was Jack?"); expect(empty).toContain('aria-disabled="true"');
    expect(empty).not.toContain("Review tags"); expect(empty).not.toContain("Add a comment (optional)");
    const picked = renderToStaticMarkup(<ReviewCard jobId="job" data={data} online preview="stars-picked" now={now} />);
    expect(picked).toContain("Review tags"); expect(picked).toContain("Add a comment (optional)"); expect(picked).not.toContain('aria-disabled="true"');
  });
  it("offers Edit only before the stored deadline", () => {
    for (const [until, expected] of [[now - 1, false], [now, false], [now + 1, true]] as const) {
      const data: CustomerReview = { workerFirstName: "Jack", review: { rating: 5, tags: ["Tidy"], comment: "Great work.", editableUntil: new Date(until).toISOString() } };
      expect(canEditReview(data.review!.editableUntil, now)).toBe(expected);
      const html = renderToStaticMarkup(<ReviewCard jobId="job" data={data} online preview="posted" now={now} />);
      expect(html.includes(">Edit</span>")).toBe(expected); expect(html).toContain("Great work.");
    }
  });
  it("formats the editing date in New Zealand time across midnight", () => {
    expect(reviewDate("2026-11-17T11:30:00Z")).toBe("Wed 18 Nov");
    expect(reviewDate("2026-11-17T10:30:00Z")).toBe("Tue 17 Nov");
    expect(canEditReview("invalid", now)).toBe(false);
  });
});
