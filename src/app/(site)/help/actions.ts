"use server";
import { createHash, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { HelpFeedbackInput, HelpFeedbackResult } from "@/lib/help";
import { loadHelpArticles } from "@/server/help/articles";
import { recordHelpFeedback } from "@/server/help/feedback";
import { consumeForClient } from "@/server/rate-limit";

export async function saveHelpFeedback(input: HelpFeedbackInput): Promise<HelpFeedbackResult> {
  const limit = await consumeForClient("helpFeedback");
  if (!limit.allowed) return { status: "error", retryAfter: limit.retryAfter };
  const jar = await cookies();
  let token = jar.get("trade-help-voter")?.value;
  if (!token || !/^[a-f0-9-]{36}$/.test(token)) {
    token = randomUUID();
    jar.set("trade-help-voter", token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/help", maxAge: 60 * 60 * 24 * 365 });
  }
  return recordHelpFeedback(input, createHash("sha256").update(token).digest("hex"), (await loadHelpArticles()).map(article => article.slug));
}
