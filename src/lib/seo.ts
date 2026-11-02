import type { ServiceData } from "@/lib/services";
import { SITE_NAME, SITE_URL } from "@/lib/metadata";

/** Implemented marketing routes. Dynamic service and help routes are added from their published content. */
export const PUBLIC_SITE_PATHS = ["/", "/how-it-works", "/for-tradies", "/help", "/trust", "/contact"] as const;

export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).href;
}

export function businessStructuredData() {
  const details = {
    name: SITE_NAME,
    url: SITE_URL.href,
    logo: absoluteUrl("/icon.svg"),
    email: "hello@trademarketplace.nz",
    areaServed: { "@type": "City", name: "Invercargill" },
  };
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": absoluteUrl("/#organization"), ...details },
      { "@type": "LocalBusiness", "@id": absoluteUrl("/#business"), ...details, parentOrganization: { "@id": absoluteUrl("/#organization") } },
    ],
  };
}

export function serviceStructuredData(service: ServiceData) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    "@id": absoluteUrl(`/services/${service.category}#service`),
    name: `${service.headline} in ${service.coverage.name}`,
    serviceType: service.headline,
    description: service.intro,
    url: absoluteUrl(`/services/${service.category}`),
    provider: { "@type": "Organization", "@id": absoluteUrl("/#organization"), name: SITE_NAME, url: SITE_URL.href },
    areaServed: { "@type": "City", name: service.coverage.name },
  };
}

export function faqStructuredData(questions: readonly (readonly [string, string])[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.map(([question, answer]) => ({
      "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
}

/** Escape HTML's opening delimiter so even repo-owned text can never close its script element. */
export function serializeJsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
