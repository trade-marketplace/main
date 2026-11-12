"use server";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { removeEvidencePhoto, saveDraft, sendForSignOff } from "./evidence";
export const saveFinishDraftAction = withRole(["TRADIE"], (viewer, id: unknown, input: unknown) => saveDraft(getDb(), viewer, id, input));
export const sendForSignOffAction = withRole(["TRADIE"], (viewer, id: unknown, input: unknown) => sendForSignOff(getDb(), viewer, id, input));
export const removeEvidencePhotoAction = withRole(["TRADIE"], (viewer, id: unknown, photoId: unknown) => removeEvidencePhoto(getDb(), viewer, id, photoId));
