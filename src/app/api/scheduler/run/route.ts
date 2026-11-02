// The scheduled-jobs endpoint (#99): the database timer calls it every minute. Only POST with the shared secret does
// anything; everything else is refused. The logic and its tests are in src/server/scheduler/handler.ts.
import { handleSchedulerPost, refuseOtherMethods } from "@/server/scheduler/handler";

export const dynamic = "force-dynamic";
// Vercel's limit for the function; the database timer waits up to 55s.
export const maxDuration = 60;

export const POST = (request: Request) => handleSchedulerPost(request);
export const GET = refuseOtherMethods;
export const HEAD = refuseOtherMethods;
export const PUT = refuseOtherMethods;
export const PATCH = refuseOtherMethods;
export const DELETE = refuseOtherMethods;
