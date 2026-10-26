import { SHARE_IMAGE_SIZE, SHARE_IMAGE_TYPE, shareImage } from "@/server/share-image";

// Share image for the landing page and any public page without its own (mockup `w-meta`, customer mode).
// Private pages turn it off with `privateMetadata` (src/lib/metadata.ts).

export const alt = "Trade Marketplace. Sorted in a flash. Post any job free.";
export const size = SHARE_IMAGE_SIZE;
export const contentType = SHARE_IMAGE_TYPE;

export default function Image() {
  return shareImage({
    mode: "customer",
    headline: ["Sorted in", "a flash."],
    subline: "Post any job free · trademarketplace.nz",
    art: "van",
  });
}
