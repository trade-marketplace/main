import { authorize } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { createCustomerJobRevisionRoute } from "@/server/jobs/customer-revision";

export const GET = createCustomerJobRevisionRoute({ authorize, db: getDb });
