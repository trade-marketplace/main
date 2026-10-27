"use client";
// A page outside the route groups threw (#109): the 500 view on its own, under the root layout.
import { ServerErrorView } from "@/components/errors/ServerErrorView";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" tabIndex={-1}>
      <ServerErrorView error={error} onRetry={reset} />
    </main>
  );
}
