"use server";
import { revalidatePath } from "next/cache";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { bookJobWindow, requestOtherTimes } from "./worker-booking";
export const bookJobWindowAction = withRole(["TRADIE"], async (viewer, id: string, window: unknown, revision: string) => {
  const result = await bookJobWindow(getDb(), viewer, id, window, revision);
  if (result.status === "booked") { revalidatePath(`/jobs/${id}`); revalidatePath(`/jobs/${id}/book`); }
  return result;
});
export const requestOtherTimesAction = withRole(["TRADIE"], (viewer, id: string) => requestOtherTimes(getDb(), viewer, id));
