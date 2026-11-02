import { expect, test } from "@playwright/test";

const origin = "https://trademarketplace.nz";

function meta(html: string, name: string): string | undefined {
  return new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(html)?.[1];
}

test("every published URL has distinct metadata and a canonical on the primary domain", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.ok()).toBe(true);
  const urls = [...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  expect(urls.length).toBeGreaterThan(30);
  const titles = new Set<string>(), descriptions = new Set<string>();
  for (const url of urls) {
    expect(url.startsWith(`${origin}/`)).toBe(true);
    const page = await request.get(new URL(url).pathname);
    expect(page.status(), url).toBe(200);
    const html = await page.text();
    const title = /<title>([^<]+)<\/title>/.exec(html)?.[1];
    const description = meta(html, "description");
    expect(title, url).toBeTruthy();
    expect(description, url).toBeTruthy();
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
    expect(canonical, url).toBeTruthy();
    expect(new URL(canonical!).href, url).toBe(url);
    expect(meta(html, "robots") ?? "", url).not.toContain("noindex");
    expect(titles.has(title!), `duplicate title at ${url}`).toBe(false);
    expect(descriptions.has(description!), `duplicate description at ${url}`).toBe(false);
    titles.add(title!); descriptions.add(description!);
  }
  const robots = await request.get("/robots.txt");
  expect(await robots.text()).toContain(`Sitemap: ${origin}/sitemap.xml`);
});

test("account and waitlist utilities have their own metadata but stay out of search", async ({ request }) => {
  for (const route of ["/login", "/signup", "/signup/customer", "/signup/tradie", "/recovery", "/verify", "/coming-soon"]) {
    const response = await request.get(route);
    expect(response.status(), route).toBe(200);
    const html = await response.text();
    expect(meta(html, "robots"), route).toContain("noindex");
    expect(meta(html, "description"), route).toBeTruthy();
    expect(/<link rel="canonical" href="([^"]+)"/.exec(html)?.[1], route).toBe(`${origin}${route}`);
  }
});

test("server HTML publishes only real business, service and visible FAQ structured data", async ({ request }) => {
  for (const [route, types] of [["/", ["Organization", "LocalBusiness", "FAQPage"]], ["/for-tradies", ["FAQPage"]], ["/services/other", ["Service"]], ["/how-it-works", []]] as const) {
    const response = await request.get(route);
    const html = await response.text();
    const data = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]) as Record<string, unknown>);
    const entities = data.flatMap(item => item["@graph"] as Record<string, unknown>[] ?? [item]);
    expect(entities.map(item => item["@type"]), route).toEqual(types);
    for (const item of entities) {
      if (item["@type"] !== "FAQPage") continue;
      for (const question of item.mainEntity as { name: string; acceptedAnswer: { text: string } }[]) {
        const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("'", "&#x27;").replaceAll('"', "&quot;");
        expect(html).toContain(escape(question.name));
        expect(html).toContain(escape(question.acceptedAnswer.text));
      }
    }
  }
});
