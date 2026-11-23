import type { Metadata } from "next";
import { TradieProfile } from "@/components/site/TradieProfile";
import { profileFor } from "./profile-data";

type Props = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Public tradie profile", robots: { index: false, follow: false } };

export default async function Page({ params }: Props) {
  return <TradieProfile profile={await profileFor((await params).id)} />;
}
