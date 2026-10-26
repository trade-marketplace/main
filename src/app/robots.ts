import type { MetadataRoute } from "next";

import { PRIVATE_PATHS } from "@/lib/metadata";

// /robots.txt (#218). Public pages can be crawled; the private parts of the app can't (WEBAPP_SPEC G07: "Private
// pages are noindex with no share image"). Each private page also exports `privateMetadata` (noindex, nofollow).
// The sitemap line is added with sitemap.xml (SEO basics).

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Prefixes: "/jobs" covers /jobs, /jobs/new, /jobs/123 and so on.
      disallow: [...PRIVATE_PATHS],
    },
  };
}
