import { unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";
import { profileFor } from "./profile-data";

export default async function Layout({ params, children }: { params: Promise<{ id: string }>; children: ReactNode }) {
  // Resolve eligibility outside the loading boundary so a paused or unknown profile has an HTTP 404.
  try {
    await profileFor((await params).id);
  } catch (error) {
    // Forward 404s here. A database failure is rethrown by the cached page read inside its retry boundary.
    unstable_rethrow(error);
  }
  return children;
}
