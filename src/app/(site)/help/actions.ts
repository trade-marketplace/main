"use server";
import { createHash, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { HelpFeedbackInput } from "@/lib/help";
import { loadHelpArticles } from "@/server/help/articles";
import { recordHelpFeedback } from "@/server/help/feedback";

export async function saveHelpFeedback(input: HelpFeedbackInput) {
  const jar = await cookies();
  let token = jar.get("trade-help-voter")?.value;
  if (!token || !/^[a-f0-9-]{36}$/.test(token)) {
    token = randomUUID();
    jar.set("trade-help-voter", token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/help", maxAge: 60 * 60 * 24 * 365 });
  }
  return recordHelpFeedback(input, createHash("sha256").update(token).digest("hex"), (await loadHelpArticles()).map(article => article.slug));
}
