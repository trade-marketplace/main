"use client";
import { ErrorState } from "@/components/feedback/ErrorState";

export default function ProfileError({ reset }: { reset: () => void }) {
  return <ErrorState size="page" title="Can’t load this profile" message="Check your connection and try again." onRetry={reset} />;
}
