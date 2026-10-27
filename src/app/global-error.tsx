"use client";
// The root layout itself threw (#109): the last resort. It replaces the whole document, so it brings its own <html>,
// <body> and styles.
import { ServerErrorView } from "@/components/errors/ServerErrorView";

import "@/styles/tokens.css";
import "@/styles/base.css";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-NZ" data-mode="customer">
      <body>
        <main id="main" tabIndex={-1}>
          <ServerErrorView error={error} onRetry={reset} />
        </main>
      </body>
    </html>
  );
}
