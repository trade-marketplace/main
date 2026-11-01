import { readFileSync } from "node:fs";

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Avatar, DropZone, PhotoGallery, PhotoPicker, ProgressRing, StarInput, StarRating } from "@/components/media";
import { checkPhotos, formatBytes, MAX_PHOTO_BYTES, photoCountLine, starLabel, starParts } from "@/lib/media";

const MB = 1024 * 1024;
const file = (name: string, type: string, size = MB) => ({ name, type, size });
const text = (html: string) =>
  html
    .replace(/<span[^>]*aria-hidden="true"[^>]*>[^<]*<\/span>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

describe("checkPhotos", () => {
  it("takes JPG, PNG, HEIC and WebP up to 10 MB", () => {
    const files = [file("a.jpg", "image/jpeg"), file("b.png", "image/png"), file("c.heic", "image/heic"), file("d.webp", "image/webp")];
    expect(checkPhotos(files)).toEqual({ accepted: files, problems: [] });
  });

  it("trusts the extension when the browser gives no type (HEIC on some browsers)", () => {
    expect(checkPhotos([file("IMG_0001.HEIC", "")]).accepted).toHaveLength(1);
    expect(checkPhotos([file("notes.txt", "")]).accepted).toHaveLength(0);
  });

  it("says plainly why a file wasn't added", () => {
    const { accepted, problems } = checkPhotos([file("plan.pdf", "application/pdf"), file("huge.jpg", "image/jpeg", 12.5 * MB)]);
    expect(accepted).toEqual([]);
    expect(problems).toEqual([
      "“plan.pdf” isn’t a photo we can use. Use JPG, PNG or HEIC.",
      "“huge.jpg” is too big (12.5 MB). Photos can be up to 10 MB.",
    ]);
  });

  it("stops at 6 photos in all and says how many were left out", () => {
    const four = Array.from({ length: 4 }, (_, i) => file(`p${i}.jpg`, "image/jpeg"));
    expect(checkPhotos(four, { existing: 3 })).toEqual({
      accepted: four.slice(0, 3),
      problems: ["You can add up to 6 photos, so 1 wasn’t added."],
    });
    expect(checkPhotos(four, { existing: 6 }).problems).toEqual(["You can add up to 6 photos, so 4 weren’t added."]);
  });

  it("allows exactly 10 MB", () => {
    expect(checkPhotos([file("edge.jpg", "image/jpeg", MAX_PHOTO_BYTES)]).accepted).toHaveLength(1);
  });
});

describe("formatting", () => {
  it("formats sizes and the count line", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(2.5 * MB)).toBe("2.5 MB");
    expect(formatBytes(10 * MB)).toBe("10 MB");
    expect(photoCountLine(2)).toBe("2 of 6 · JPG, PNG or HEIC up to 10 MB each");
  });

  it("rounds ratings to half stars, within 0–5", () => {
    expect(starParts(4.6)).toEqual({ full: 4, half: true, empty: 0 });
    expect(starParts(4.8)).toEqual({ full: 5, half: false, empty: 0 });
    expect(starParts(3)).toEqual({ full: 3, half: false, empty: 2 });
    expect(starParts(-1)).toEqual({ full: 0, half: false, empty: 5 });
    expect(starParts(9)).toEqual({ full: 5, half: false, empty: 0 });
    expect(starParts(Number.NaN)).toEqual({ full: 0, half: false, empty: 5 });
    expect(starLabel(4.56)).toBe("4.6 out of 5 stars");
    expect(starLabel(1)).toBe("1 out of 5 star");
  });
});

describe("ProgressRing", () => {
  it("is a progressbar with the percentage while uploading", () => {
    const html = renderToString(<ProgressRing status="uploading" progress={0.42} label="kitchen.jpg" />);
    expect(html).toMatch(/role="progressbar"/);
    expect(html).toContain('aria-label="Uploading kitchen.jpg"');
    expect(html).toContain('aria-valuenow="42"');
  });

  it("has no value while the size isn't known, and says when it's done or failed", () => {
    expect(renderToString(<ProgressRing status="uploading" label="a.jpg" />)).not.toContain("aria-valuenow");
    expect(renderToString(<ProgressRing status="done" label="a.jpg" />)).toContain('aria-label="a.jpg uploaded"');
    expect(renderToString(<ProgressRing status="failed" label="a.jpg" />)).toContain('aria-label="a.jpg didn’t upload"');
  });
});

describe("DropZone", () => {
  it("has a real button to choose files and a file input for photos", () => {
    const html = renderToString(<DropZone onFiles={() => {}} hint="JPG, PNG, HEIC up to 10 MB" />);
    expect(html).toMatch(/<button type="button"[^>]*>choose files<\/button>/);
    expect(html).toMatch(/<input type="file" accept="image\/jpeg,image\/png,image\/heic,image\/heif,image\/webp,.heic,.heif" multiple=""/);
    expect(html).toContain("tm-dropzone");
  });

  it("when full: the button is disabled and the reason is its description", () => {
    const html = renderToString(<DropZone onFiles={() => {}} disabled="That’s 6 photos." />);
    expect(html).toMatch(/<button[^>]*aria-describedby="([^"]+)"[^>]*disabled=""/);
    const id = html.match(/aria-describedby="([^"]+)"/)![1];
    expect(html).toContain(`id="${id}">That’s 6 photos.`);
  });
});

describe("PhotoPicker", () => {
  const photos = [
    { id: "1", src: "/a.jpg", name: "wires.jpg", status: "done" as const },
    { id: "2", src: "/b.jpg", name: "board.jpg", status: "uploading" as const, progress: 0.5 },
    { id: "3", src: "/c.jpg", name: "switch.jpg", status: "failed" as const },
  ];
  const picker = (props: Partial<Parameters<typeof PhotoPicker>[0]> = {}) =>
    renderToString(<PhotoPicker photos={photos} onAdd={() => {}} onRemove={() => {}} onRetry={() => {}} {...props} />);

  it("names each photo, its remove button and its retry", () => {
    const html = picker();
    expect(html).toContain('alt="Photo 1: wires.jpg"');
    expect(html).toContain('aria-label="Remove wires.jpg"');
    expect(text(html)).toContain("Failed · Retry switch.jpg");
    expect(html).toContain('aria-valuenow="50"');
  });

  it("shows the count and an Add photo tile until it's full", () => {
    expect(text(picker())).toContain("3 of 6 · JPG, PNG or HEIC up to 10 MB each");
    expect(text(picker())).toContain("Add photo");
    expect(text(picker({ max: 3 }))).not.toContain("Add photo");
    expect(text(picker({ addTile: false }))).not.toContain("Add photo");
  });

  it("reads out problems with picked files", () => {
    expect(picker({ problems: ["“plan.pdf” isn’t a photo we can use."] })).toMatch(/role="alert"[^>]*>[\s\S]*plan\.pdf/);
  });

  it("keeps long file names from spilling", () => {
    const css = readFileSync(new URL("../../src/components/media/media.module.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.problems li \{[^}]*overflow-wrap: anywhere/);
    expect(css).toMatch(/\.tileImg \{[^}]*object-fit: cover/);
  });
});

describe("PhotoGallery", () => {
  it("makes each photo a button that opens the viewer, named with its place and description", () => {
    const html = renderToString(<PhotoGallery photos={[{ src: "/a.jpg", alt: "Old wiring" }, { src: "/b.jpg", alt: "Switchboard" }]} />);
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(2);
    expect(text(html)).toContain("Open photo 2 of 2: Switchboard");
    expect(html).toMatch(/<dialog/);
  });
});

describe("Avatar", () => {
  it("shows initials without a photo, named by the person", () => {
    const html = renderToString(<Avatar name="Jack Wilson" />);
    expect(html).toContain('role="img" aria-label="Jack Wilson"');
    expect(html).toContain(">JW<");
  });

  it("shows the photo when there is one, and can be hidden next to a written name", () => {
    expect(renderToString(<Avatar name="Sarah" src="/s.jpg" size="lg" />)).toMatch(/data-size="lg"[\s\S]*<img src="\/s.jpg" alt=""/);
    expect(renderToString(<Avatar name="Sarah" decorative />)).toContain('aria-hidden="true"');
  });
});

describe("StarRating and StarInput", () => {
  it("reads a rating as words, with the number of reviews", () => {
    const html = renderToString(<StarRating value={4.6} count={32} />);
    expect(html).toContain('aria-label="4.6 out of 5 stars, 32 reviews"');
    expect(html).toContain("star_half");
  });

  it("is a radio group of five named stars, sent with the form", () => {
    const html = renderToString(<StarInput name="stars" value={4} onChange={() => {}} label="How did Jack do?" />);
    expect(html).toMatch(/<fieldset[\s\S]*<legend[^>]*>How did Jack do\?<\/legend>/);
    expect(html.match(/<input type="radio"[^>]*name="stars"/g)).toHaveLength(5);
    expect(text(html)).toContain("4 stars, Great");
    expect(html).toMatch(/checked="" value="4"|value="4" checked=""/);
  });

  it("describes the group by its error", () => {
    const html = renderToString(<StarInput name="s" value={null} onChange={() => {}} error="Choose how many stars." />);
    const id = html.match(/<fieldset[^>]*aria-describedby="([^"]+)"/)![1];
    expect(html).toContain(`id="${id}"`);
    expect(text(html)).toContain("Choose how many stars.");
  });
});
