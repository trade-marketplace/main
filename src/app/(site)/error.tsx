"use client";
// A page in this group threw (#109): the 500 view inside the group's shell, so the nav still works. Try again
// renders the page again.
import { ServerErrorView } from "@/components/errors/ServerErrorView";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ServerErrorView error={error} onRetry={reset} />;
}
