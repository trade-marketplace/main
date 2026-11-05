import type { Metadata, Viewport } from "next";
import { redirect, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { CustomerHome } from "@/components/home/CustomerHome";
import { CustomerHomePage } from "@/components/home/CustomerHomePage";
import { SiteShell } from "@/components/site/SiteShell";
import { homeForRole } from "@/lib/auth/routes";
import { privateMetadata } from "@/lib/metadata";
import { getViewer } from "@/server/auth/viewer";
import { PublicHome } from "@/components/site/PublicHome";

const publicMetadata: Metadata = { title: { absolute: "Trade Marketplace — Sorted in a flash." }, description: "Post any job free. Accept the price. Someone local sorts it. Trades, moving, cleaning, gardening and more.", alternates: { canonical: "/" } };

async function readViewer() {
  try { return await getViewer(); }
  catch (error) { unstable_rethrow(error); console.error("Home could not read the signed-in visitor."); return null; }
}

export async function generateMetadata(): Promise<Metadata> {
  return (await readViewer())?.role === "CUSTOMER" ? { ...privateMetadata, title: "Home" } : publicMetadata;
}

/** The app's bottom bar needs the phone safe area; the public shell keeps its existing viewport. */
export async function generateViewport(): Promise<Viewport> {
  return (await readViewer())?.role === "CUSTOMER" ? { viewportFit: "cover" } : {};
}

/** One route owns the landing dispatch. Other public pages retain their public shell. */
export default async function Home() {
  const viewer = await readViewer();
  if (viewer?.role === "CUSTOMER") return <AppShell><Suspense fallback={<CustomerHome result={{ ok: false }} loading />}><CustomerHomePage viewer={viewer} /></Suspense></AppShell>;
  if (viewer) redirect(homeForRole(viewer.role));
  return <SiteShell><PublicHome /></SiteShell>;
}
