"use server";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { reportCustomerProblem } from "./customer-problem";
export const reportCustomerProblemAction = withRole(["CUSTOMER"], async (viewer, input: unknown) => reportCustomerProblem(getDb(), viewer, input));
