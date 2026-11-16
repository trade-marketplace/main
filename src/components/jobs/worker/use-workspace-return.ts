"use client";
import { useSearchParams } from "next/navigation";
import { myWorkReturn } from "@/lib/my-work";

/** Only the existing My work parser can add context to a same-job workspace Back link. */
export function workspaceBackHref(fallback: string, from: unknown): string {
  const back = myWorkReturn(from);
  return back && /^\/jobs\/[0-9a-f-]{36}$/i.test(fallback)
    ? `${fallback}?from=${encodeURIComponent(back)}` : fallback;
}
export function useWorkspaceReturn(fallback: string): string {
  return workspaceBackHref(fallback, useSearchParams()?.get("from"));
}
