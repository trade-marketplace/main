"use client";
import { ErrorState } from "@/components/feedback/ErrorState";
export default function HelpError({ reset }: { reset: () => void }) {
  return <ErrorState title="Can’t load help articles" onRetry={reset} />;
}
