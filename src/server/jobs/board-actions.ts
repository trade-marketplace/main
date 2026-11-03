"use server";

import { z } from "zod";
import { boardQuerySchema, type BoardQuery, type BoardRequest, type BoardResult, type BoardUpdates } from "@/lib/job-board";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { loadJobBoard, newBoardJobs } from "./board";

const ids = z.array(z.uuid()).max(5000);
const requestSchema = z.object({ savedIds: ids.optional(), cursor: z.string().max(2048).nullable().optional(), before: z.iso.datetime().optional() });
const updatesSchema = z.object({ since: z.iso.datetime(), knownIds: ids, savedIds: ids });

export const loadJobBoardAction = withRole(["TRADIE"], async (viewer, query: BoardQuery, request: BoardRequest = {}): Promise<BoardResult> => {
  const checked = boardQuerySchema.safeParse(query), input = requestSchema.safeParse(request);
  if (!checked.success || !input.success) return { ok: false, error: "unavailable" };
  try { return await loadJobBoard(getDb(), viewer, checked.data, input.data); }
  catch { console.error("Job board unavailable."); return { ok: false, error: "unavailable" }; }
});

export const newBoardJobsAction = withRole(["TRADIE"], async (viewer, query: BoardQuery, request: { since: string; knownIds: string[]; savedIds: string[] }): Promise<BoardUpdates> => {
  const checked = boardQuerySchema.safeParse(query), input = updatesSchema.safeParse(request);
  if (!checked.success || !input.success) return { ok: false, error: "unavailable" };
  try { return await newBoardJobs(getDb(), viewer, checked.data, input.data); }
  catch { console.error("Job board updates unavailable."); return { ok: false, error: "unavailable" }; }
});
