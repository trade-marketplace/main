import { readdirSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import { metadata as appMetadata } from "@/app/(app)/layout";
import { metadata as officeMetadata } from "@/app/admin/layout";
import { StructuredData } from "@/components/site/StructuredData";
import { routeAccess } from "@/lib/auth/routes";
import { PRIVATE_PATHS, privateMetadata, SITE_URL } from "@/lib/metadata";
import { absoluteUrl, businessStructuredData, faqStructuredData, PUBLIC_SITE_PATHS, serializeJsonLd, serviceStructuredData } from "@/lib/seo";
import { LANDING_FAQ, WORKER_FAQ } from "@/lib/site-faqs";
import { loadAllHelpArticles, loadHelpArticles } from "@/server/help/articles";
import { loadService, SERVICE_CONTENT } from "@/server/services";

vi.mock("@/components/app/AppShell", () => ({ AppShell: () => null }));
vi.mock("@/components/office/OfficeShell", () => ({ OfficeShell: () => null }));

function pageFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? pageFiles(path.join(directory, entry.name))
    : entry.name === "page.tsx" ? [path.join(directory, entry.name)] : []);
}

function pagePath(file: string): string {
  return `/${path.relative("src/app", path.dirname(file)).split(path.sep).filter(part => !part.startsWith("(")).join("/")}`;
}

describe("published sitemap", () => {
  it("lists every implemented marketing page and published service/help page on the primary domain", async () => {
    const entries = await sitemap();
    const urls = entries.map(entry => entry.url);
    const articles = await loadHelpArticles();
    const expected = [
      ...PUBLIC_SITE_PATHS,
      ...Object.values(SERVICE_CONTENT).filter(service => service.live).map(service => `/services/${service.category}`),
      ...articles.map(article => `/help/${article.slug}`),
    ].map(absoluteUrl);
    expect(urls.toSorted()).toEqual(expected.toSorted());
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) {
      const parsed = new URL(url);
      expect(parsed.origin).toBe(SITE_URL.origin);
      expect(parsed.search).toBe("");
      expect(PRIVATE_PATHS.some(prefix => parsed.pathname.startsWith(prefix))).toBe(false);
    }
    // A new static marketing page must join the sitemap, not silently disappear from search.
    const marketing = [...pageFiles("src/app/(site)"), "src/app/for-tradies/page.tsx"]
      .map(pagePath).filter(route => !route.includes("[") && route !== "/coming-soon");
    expect(marketing.toSorted()).toEqual([...PUBLIC_SITE_PATHS].toSorted());
    for (const article of articles) expect(entries.find(entry => entry.url.endsWith(`/help/${article.slug}`))?.lastModified).toBe(article.updated);
  });

  it("excludes held articles, unavailable services and account utilities", async () => {
    const held = (await loadAllHelpArticles()).filter(article => article.confirm);
    const original = SERVICE_CONTENT.gas.live;
    try {
      SERVICE_CONTENT.gas.live = false;
      const urls = (await sitemap()).map(entry => entry.url);
      expect(urls).not.toContain(absoluteUrl("/services/gas"));
      for (const article of held) expect(urls).not.toContain(absoluteUrl(`/help/${article.slug}`));
      for (const utility of ["/login", "/signup", "/recovery", "/verify", "/coming-soon"]) expect(urls).not.toContain(absoluteUrl(utility));
    } finally { SERVICE_CONTENT.gas.live = original; }
  });
});

describe("private route indexing", () => {
  it("advertises the sitemap and blocks every implemented private page", () => {
    expect(robots().sitemap).toBe("https://trademarketplace.nz/sitemap.xml");
    expect(appMetadata).toEqual(privateMetadata);
    expect(officeMetadata).toEqual(privateMetadata);
    const rules = robots().rules;
    const disallow = [((Array.isArray(rules) ? rules[0] : rules).disallow ?? [])].flat();
    for (const file of pageFiles("src/app")) {
      const route = pagePath(file);
      if (routeAccess(route).kind !== "roles") continue;
      expect(disallow.some(prefix => route.startsWith(prefix)), route).toBe(true);
      // The noindex metadata is inherited even when an individual page doesn't export metadata.
      expect(file.startsWith("src/app/(app)/") || file.startsWith("src/app/admin/"), file).toBe(true);
    }
  });
});

function keys(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...keys(child)]);
}

describe("structured data", () => {
  it("identifies the actual business without invented ratings, reviews or prices", async () => {
    const business = businessStructuredData();
    expect(business["@graph"].map(entity => entity["@type"])).toEqual(["Organization", "LocalBusiness"]);
    for (const entity of business["@graph"]) {
      expect(entity).toMatchObject({ name: "Trade Marketplace", url: "https://trademarketplace.nz/", logo: "https://trademarketplace.nz/icon.svg", email: "hello@trademarketplace.nz", areaServed: { name: "Invercargill" } });
    }
    const data = [business, ...await Promise.all(Object.keys(SERVICE_CONTENT).map(async category => serviceStructuredData(await loadService(category as keyof typeof SERVICE_CONTENT, null))))];
    for (const item of data) {
      expect(JSON.parse(serializeJsonLd(item))).toEqual(item);
      expect(keys(item).some(key => /rating|review|price|offers/i.test(key))).toBe(false);
    }
  });

  it("describes the displayed service and its coverage", async () => {
    const service = await loadService("other", null);
    expect(serviceStructuredData(service)).toMatchObject({ "@type": "Service", serviceType: service.headline, description: service.intro, url: absoluteUrl("/services/other"), areaServed: { name: service.coverage.name } });
  });

  it("uses the very same questions and answers displayed by each FAQ", () => {
    for (const questions of [LANDING_FAQ, WORKER_FAQ]) {
      const data = faqStructuredData(questions);
      expect(data["@type"]).toBe("FAQPage");
      expect(data.mainEntity.map(question => [question.name, question.acceptedAnswer.text])).toEqual(questions);
    }
  });

  it("renders parseable JSON without allowing text to close the script", () => {
    const data = faqStructuredData([["A question?", "</script><script>alert('x')</script> & <answer>"]]);
    const markup = renderToStaticMarkup(<StructuredData data={data} />);
    expect(markup.match(/<script/g)).toHaveLength(1);
    expect(JSON.parse(markup.replace(/^<script[^>]*>|<\/script>$/g, ""))).toEqual(data);
    expect(serializeJsonLd(data)).not.toContain("<");
  });
});
