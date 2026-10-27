import { SHARE_IMAGE_SIZE, SHARE_IMAGE_TYPE, shareImage } from "@/server/share-image";

// Share image for /for-tradies (mockup `w-meta`, trade mode). The line is Matt's (#344, DECISIONS.md).
// The page itself is its own task; this is only the image.

export const alt = "Trade Marketplace for tradies. You do the work. We find the jobs.";
export const size = SHARE_IMAGE_SIZE;
export const contentType = SHARE_IMAGE_TYPE;

export default function Image() {
  return shareImage({
    mode: "trade",
    headline: ["You do the work.", "We find the jobs."],
    subline: "Local jobs, already priced and paid · trademarketplace.nz",
  });
}
