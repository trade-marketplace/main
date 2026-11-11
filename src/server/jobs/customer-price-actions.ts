"use server";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { declineCustomerPrice } from "./customer-price";

export const declineCustomerPriceAction = withRole(["CUSTOMER"], (viewer, id: string, revision: string, reason: unknown) => declineCustomerPrice(getDb(), viewer, id, revision, reason));
