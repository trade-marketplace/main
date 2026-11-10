"use server";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { decideTradie } from "./tradie-commands";
export const decideTradieAction = withRole(["ADMIN"], async (viewer, input: unknown) => decideTradie(getDb(), viewer, input));
