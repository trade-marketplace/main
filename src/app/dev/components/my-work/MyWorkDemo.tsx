"use client";
import { useState } from "react";
import { MyWork } from "@/components/mywork/MyWork";
import type { MyWorkQuery, MyWorkState } from "@/lib/my-work";
import { PREVIEW_NOW, previewQuotes, previewWork } from "./preview-data";
export function MyWorkDemo({ state, query }: { state: MyWorkState; query: MyWorkQuery }) {
  const [retried, setRetried] = useState(false);
  const failed = state === "error" && !retried;
  return <MyWork query={query} work={failed || state === "loading" ? null : previewWork(state)} quotes={failed || state === "loading" ? null : previewQuotes(state === "quotes-empty")}
    loading={state === "loading"} previewOffline={state === "offline"} now={PREVIEW_NOW} basePath={`/dev/components/my-work?state=${state}`} onRetry={() => setRetried(true)} />;
}
