"use server";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { postAgain } from "./post-again";

export const postAgainAction = withRole(["CUSTOMER"], (viewer, jobId: string, replace: boolean) => postAgain(getDb(), viewer, jobId, replace === true));
