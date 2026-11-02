import type { Metadata } from "next";

import { TrustPage } from "@/components/site/TrustPage";

export const metadata: Metadata = {
  title: "Trust & safety",
  description: "What we check, how payments work and what happens if something goes wrong, for trades and everyday jobs.",
  alternates: { canonical: "/trust" },
};

export default function Trust() {
  return <TrustPage />;
}
