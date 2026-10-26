// Turns the plan's routes (scripts/ci/screenshots.mjs) into concrete shots (#90): which demo account to sign in
// as, which seeded job fills `[id]`, and the URL to open. Pure, so tests/unit/screenshots-shots.test.ts covers it.

import { routeAccess } from "@/lib/auth/routes";
import { modeForRole, type Mode, type Role } from "@/lib/mode";

import { JOBS, PEOPLE } from "../../prisma/seed/data.mjs";

export type RoleWord = "guest" | "customer" | "tradie" | "worker" | "office";
export type JobStatus =
  | "REVIEW"
  | "QUOTE_BOUNTY"
  | "PRICED"
  | "BOOKABLE"
  | "ASSIGNED"
  | "SUBMITTED"
  | "COMPLETED"
  | "CANCEL_REVIEW"
  | "CANCELLED";
export type PlanEntry = { path: string; role?: RoleWord; status?: JobStatus };

/** A seeded demo person (prisma/seed/data.mjs). */
export type Account = keyof typeof PEOPLE;

export type Shot = {
  /** Safe as a file name, unique within a run. */
  id: string;
  /** What the comment's Route column shows. */
  label: string;
  /** Path and query to open. */
  url: string;
  /** Null: signed out. */
  account: Account | null;
  /** The palette the page must show when the sign-in worked (the layout sets <html data-mode>). */
  expectMode: Mode | null;
  status?: JobStatus;
};

export type Resolved = { shots: Shot[]; skipped: { label: string; reason: string }[] };

const ACCOUNT_FOR_WORD: Record<Exclude<RoleWord, "guest">, Account> = {
  customer: "customer",
  tradie: "tradie",
  worker: "otherWorker",
  office: "office",
};
const ACCOUNT_FOR_ROLE: Record<Role, Account> = { CUSTOMER: "customer", TRADIE: "tradie", ADMIN: "office" };
const LABEL_FOR_ACCOUNT: Record<Account, string> = {
  customer: "customer",
  tradie: "tradie",
  otherWorker: "worker",
  office: "office",
};

/** Each seeded job's status: the last step it went through after being posted as REVIEW. */
export function seededJobs(): { id: string; status: JobStatus; worker: Account | null }[] {
  return JOBS.map((job) => ({
    id: job.id,
    status: (job.steps.at(-1)?.[0] ?? "REVIEW") as JobStatus,
    worker: (job.worker ?? null) as Account | null,
  }));
}

/** Route params we can fill without a seeded row. `[slug]` and the like need a real URL in `screenshots:`. */
const SAMPLE_PARAMS: Record<string, string> = { trade: "electrical", city: "invercargill" };

/** Which job status a page about one job is shown in, unless the PR says otherwise with `status=`. */
export function defaultStatus(route: string, account: Account | null): JobStatus {
  if (/\/book$/.test(route)) return "BOOKABLE";
  if (/\/(complete|help)$/.test(route)) return "ASSIGNED";
  if (/\/problem$/.test(route)) return "SUBMITTED";
  if (route.startsWith("/receipts/")) return "COMPLETED";
  if (route.startsWith("/admin/")) return "REVIEW";
  // A job's own page: the customer sees their price; a tradie sees a job they can book.
  return account === "customer" ? "PRICED" : "BOOKABLE";
}

function isWorker(account: Account | null): boolean {
  return account === "tradie" || account === "otherWorker";
}

/** Does this `[param]` stand for a job? Job pages, receipts and the office's job pages. */
function isJobParam(segments: string[], index: number): boolean {
  const name = segments[index].slice(1, -1);
  const parent = segments[index - 1];
  return (parent === "jobs" || parent === "receipts") && /^(id|jobId)$/.test(name);
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "home"
  );
}

/** Who a route is shot as, when the PR doesn't say: each role that may open it, or signed out for public pages. */
export function defaultAccounts(route: string): (Account | null)[] {
  const access = routeAccess(route.replace(/\[[^\]]+\]/g, "x"));
  switch (access.kind) {
    case "public":
    case "guest":
      return [null];
    case "landing":
      // `/` is two pages: the landing page signed out, the customer home signed in.
      return [null, "customer"];
    case "roles":
      return access.roles.map((role) => ACCOUNT_FOR_ROLE[role]);
  }
}

/**
 * The shots for one plan entry. An entry can give way to several (a page both sides of a job see is shot as
 * each), or be skipped with a reason the comment shows.
 */
export function resolveEntry(entry: PlanEntry): Resolved {
  const queryAt = entry.path.indexOf("?");
  const route = queryAt === -1 ? entry.path : entry.path.slice(0, queryAt);
  const query = queryAt === -1 ? "" : entry.path.slice(queryAt);
  const segments = route.split("/");

  const accounts: (Account | null)[] = entry.role
    ? [entry.role === "guest" ? null : ACCOUNT_FOR_WORD[entry.role]]
    : defaultAccounts(route);

  const resolved: Resolved = { shots: [], skipped: [] };
  for (const first of accounts) {
    let account = first;
    let status: JobStatus | undefined;
    let problem: string | null = null;

    const filled: string[] = [];
    for (const [index, segment] of segments.entries()) {
      const param = /^\[{1,2}(?:\.\.\.)?([^\]]+)\]{1,2}$/.exec(segment);
      if (!param) {
        filled.push(segment);
      } else if (isJobParam(segments, index)) {
        status = entry.status ?? defaultStatus(route, account);
        const candidates = seededJobs().filter((job) => job.status === status);
        // The tradie doing the job sees it as theirs; if another demo worker has it, sign in as them instead.
        const job =
          candidates.find((job) => job.worker !== null && job.worker === account) ??
          (isWorker(account) ? candidates.find((job) => job.worker !== null) : undefined) ??
          candidates[0];
        if (!job) {
          problem = `no seeded job is ${status} (prisma/seed/data.mjs).`;
          break;
        }
        if (isWorker(account) && job.worker) account = job.worker;
        filled.push(job.id);
      } else if (param[1] === "id" && segments[index - 1] === "tradies") {
        filled.push(PEOPLE.tradie.id);
      } else if (SAMPLE_PARAMS[param[1]]) {
        filled.push(SAMPLE_PARAMS[param[1]]);
      } else {
        const example = `${segments.slice(0, index).join("/")}/some-${param[1]}`;
        problem = `\`${segment}\` needs a real value: list the URL under \`screenshots:\`, e.g. \`${example}\`.`;
        break;
      }
    }

    const who = account ? LABEL_FOR_ACCOUNT[account] : "signed out";
    const label = [`${route}${query}`, who, status].filter(Boolean).join(" · ");
    if (problem) {
      resolved.skipped.push({ label, reason: problem });
      continue;
    }
    const role = account ? PEOPLE[account].role : null;
    resolved.shots.push({
      id: slug(`${route === "/" ? "home" : route}${query}-${who}${status ? `-${status}` : ""}`),
      label,
      url: `${filled.join("/") || "/"}${query}`,
      account,
      expectMode: role ? modeForRole(role) : null,
      ...(status ? { status } : {}),
    });
  }
  return resolved;
}

/** Every shot in the plan, with duplicate ids made unique. */
export function resolvePlan(entries: PlanEntry[]): Resolved {
  const all: Resolved = { shots: [], skipped: [] };
  const seen = new Map<string, number>();
  for (const entry of entries) {
    const { shots, skipped } = resolveEntry(entry);
    for (const shot of shots) {
      const count = (seen.get(shot.id) ?? 0) + 1;
      seen.set(shot.id, count);
      all.shots.push(count === 1 ? shot : { ...shot, id: `${shot.id}-${count}` });
    }
    all.skipped.push(...skipped);
  }
  return all;
}
