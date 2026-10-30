import type { Metadata } from "next";

import { HowItWorks } from "@/components/site/HowItWorks";

export const metadata: Metadata = {
  title: "How it works",
  description: "Post any job free. Accept the price. Someone local sorts it. Invercargill, New Zealand.",
  alternates: { canonical: "/how-it-works" },
};

export default function HowItWorksPage() {
  return <HowItWorks />;
}
