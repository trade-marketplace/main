import { authorize } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { createCalendarRoute } from "@/server/jobs/customer-calendar";

export const GET = createCalendarRoute(authorize, getDb);
