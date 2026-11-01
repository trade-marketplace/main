"use client";

import { ErrorState } from "@/components/feedback";

export default function ServiceError({ reset }: { reset: () => void }) {
  return <ErrorState size="page" title="Couldn’t load this service." message="Try again in a minute." onRetry={reset} />;
}
