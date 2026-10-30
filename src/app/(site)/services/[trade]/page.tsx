import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { ServicePage } from "@/components/site/ServicePage";
import { CATEGORIES, isCategory } from "@/lib/cards";
import { loadService } from "@/server/services";

import { joinServiceWaitlist } from "./actions";

export const dynamicParams = false;
export function generateStaticParams() { return CATEGORIES.map((trade) => ({ trade })); }

const readService = cache(loadService);

type Props = { params: Promise<{ trade: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { trade } = await params;
  if (!isCategory(trade)) notFound();
  const data = await readService(trade);
  const title = `${data.headline} in ${data.coverage.name}`;
  const description = data.live ? `${data.intro} Post your job free in ${data.coverage.name}, New Zealand.` : `${title}. Coming soon. Join the waitlist.`;
  return { title, description, alternates: { canonical: `/services/${trade}` }, openGraph: { title, description, url: `/services/${trade}` } };
}

export default async function Service({ params }: Props) {
  const { trade } = await params;
  if (!isCategory(trade)) notFound();
  return <ServicePage data={await readService(trade)} submit={joinServiceWaitlist} />;
}
