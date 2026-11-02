import type { MetadataRoute } from "next";

import { absoluteUrl, PUBLIC_SITE_PATHS } from "@/lib/seo";
import { loadHelpArticles } from "@/server/help/articles";
import { SERVICE_CONTENT } from "@/server/services";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const articles = await loadHelpArticles();
  return [
    ...PUBLIC_SITE_PATHS.map(path => ({ url: absoluteUrl(path) })),
    ...Object.values(SERVICE_CONTENT).filter(service => service.live).map(service => ({ url: absoluteUrl(`/services/${service.category}`) })),
    ...articles.map(article => ({ url: absoluteUrl(`/help/${article.slug}`), lastModified: article.updated })),
  ];
}
