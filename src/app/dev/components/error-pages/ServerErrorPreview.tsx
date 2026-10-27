"use client";
// The 500 page with a pretend server error (dev only). Try again just says it was pressed.
import { useState } from "react";

import { ServerErrorView } from "@/components/errors/ServerErrorView";

// An example digest: real ones come from Next.js and match the server log.
const EXAMPLE = Object.assign(new Error("Example error for the preview"), { digest: "7F3A91C2" });

export function ServerErrorPreview({ withReference }: { withReference: boolean }) {
  const [tries, setTries] = useState(0);
  const error = withReference ? EXAMPLE : new Error("Example browser error for the preview");
  return (
    <>
      <ServerErrorView error={error} log={false} onRetry={() => setTries((n) => n + 1)} />
      <p role="status" style={{ textAlign: "center", margin: 0 }}>
        {tries > 0 ? `Try again pressed ${tries} time${tries === 1 ? "" : "s"} (preview).` : ""}
      </p>
    </>
  );
}
