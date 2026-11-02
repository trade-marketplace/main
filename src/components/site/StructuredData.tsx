import { serializeJsonLd } from "@/lib/seo";

/** Server-rendered and invisible; no client script or extra request is needed. */
export function StructuredData({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
