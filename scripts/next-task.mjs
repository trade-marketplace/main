// "What should I work on next?" for agents and people (#71).
//
//   npm run next-task                      every task you can pick up now, best first
//   npm run next-task -- --limit 5         only the first 5
//   npm run next-task -- --area customer   only issues labelled area:customer
//
// Lists open tasks that nobody has taken and whose `Blocked by` issues are all closed, sorted by milestone, then
// priority (P1 → P2 → P3), then oldest first (AGENTS.md §1, docs/PLANNING.md). Epics, features, decisions, ideas
// and human-only issues are left out.
//
// "Taken" means: someone is assigned, a comment starts with "Taking this" (AGENTS.md §1), or an open pull request
// says "Closes #<n>".
//
// Uses the `gh` CLI with the REST API only (no GraphQL, which some agent environments block). Pages are fetched
// with `&page=N` rather than `gh api --paginate`, because GitHub's "next page" links point at
// `repositories/<id>/…`, which some agent proxies refuse.

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const REPO = "trade-marketplace/main";
export const EXCLUDED_LABELS = ["epic", "feature", "decision", "idea", "human-only"];
const PER_PAGE = 100;

/**
 * @typedef {{ name: string }} Label
 * @typedef {{
 *   number: number,
 *   title: string,
 *   state?: string,
 *   labels: Array<Label | string>,
 *   assignees?: Array<unknown>,
 *   assignee?: unknown,
 *   milestone?: { number: number, title: string } | null,
 *   comments?: number,
 *   pull_request?: unknown,
 *   issue_dependencies_summary?: { blocked_by: number },
 * }} Issue
 * @typedef {{ number: number, title: string, milestone: string, priority: string, size: string }} Task
 * @typedef {(args: string[]) => unknown} GhApi  Runs `gh api <args>` and returns the parsed JSON.
 */

// ---------------------------------------------------------------------------------------------------------------
// Pure logic (unit-tested in tests/unit/next-task.test.ts)
// ---------------------------------------------------------------------------------------------------------------

/** @param {Issue} issue */
export function labelNames(issue) {
  return issue.labels.map((l) => (typeof l === "string" ? l : l.name));
}

/** "P1" / "P2" / "P3", or "" when the issue has no priority label. */
export function priorityOf(issue) {
  return labelNames(issue).find((l) => /^P[1-3]$/.test(l)) ?? "";
}

/** "S" / "M" from a `size:S` label, or "". */
export function sizeOf(issue) {
  const label = labelNames(issue).find((l) => l.startsWith("size:"));
  return label ? label.slice("size:".length) : "";
}

/**
 * Sort key for a milestone. Titles start with their build-order number ("0 · Foundations"); fall back to the
 * milestone's own number, and put issues with no milestone last.
 * @param {Issue["milestone"]} milestone
 */
export function milestoneRank(milestone) {
  if (!milestone) return Number.POSITIVE_INFINITY;
  const lead = /^\s*(\d+)/.exec(milestone.title);
  return lead ? Number(lead[1]) : milestone.number;
}

/** @param {string} priority */
function priorityRank(priority) {
  return priority ? Number(priority.slice(1)) : 9;
}

/** True when someone has claimed the issue by assignment. */
export function isAssigned(issue) {
  return Boolean(issue.assignee) || (issue.assignees ?? []).length > 0;
}

/** True when this comment claims the issue (AGENTS.md §1: comment `Taking this — <agent/model name>`). */
export function isClaimComment(body) {
  return /^\s*taking this\b/i.test(body ?? "");
}

/** Issue numbers an open pull request closes ("Closes #12", "fixes #3", "Resolves #7"). */
export function issuesClosedBy(prBody) {
  const numbers = new Set();
  for (const m of (prBody ?? "").matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)\b/gi)) {
    numbers.add(Number(m[1]));
  }
  return [...numbers];
}

/** Normalises `--area customer` and `--area area:customer` to the label `area:customer`. */
export function areaLabel(area) {
  const name = area.trim().toLowerCase();
  return name.startsWith("area:") ? name : `area:${name}`;
}

/**
 * Can this issue be picked up, judging by its own fields? (Open, not a PR, not an excluded kind, unassigned,
 * in the area asked for.) Blockers and claim comments are checked separately because they can need more API calls.
 * @param {Issue} issue
 * @param {{ area?: string }} [options]
 */
export function isCandidate(issue, options = {}) {
  if (issue.pull_request) return false;
  if (issue.state && issue.state !== "open") return false;
  const labels = labelNames(issue);
  if (labels.some((l) => EXCLUDED_LABELS.includes(l))) return false;
  if (isAssigned(issue)) return false;
  if (options.area && !labels.includes(areaLabel(options.area))) return false;
  return true;
}

/**
 * Lowest milestone first, then P1 → P2 → P3 (no priority last), then oldest (lowest number) first.
 * Returns a new array.
 * @param {Issue[]} issues
 */
export function sortIssues(issues) {
  return [...issues].sort(
    (a, b) =>
      milestoneRank(a.milestone) - milestoneRank(b.milestone) ||
      priorityRank(priorityOf(a)) - priorityRank(priorityOf(b)) ||
      a.number - b.number,
  );
}

/**
 * @param {Issue} issue
 * @returns {Task}
 */
export function toTask(issue) {
  return {
    number: issue.number,
    title: issue.title,
    milestone: issue.milestone?.title ?? "",
    priority: priorityOf(issue),
    size: sizeOf(issue),
  };
}

/**
 * The whole decision, given everything already fetched.
 * @param {Issue[]} issues  open issues (pull requests are skipped)
 * @param {{
 *   area?: string,
 *   limit?: number,
 *   blockedBy?: (issue: Issue) => number,  open blockers; defaults to issue_dependencies_summary.blocked_by
 *   claimed?: Set<number>,                  issues taken by a "Taking this" comment or an open PR
 * }} [options]
 * @returns {Task[]}
 */
export function selectTasks(issues, options = {}) {
  const blockedBy = options.blockedBy ?? ((issue) => issue.issue_dependencies_summary?.blocked_by ?? 0);
  const claimed = options.claimed ?? new Set();
  const ready = issues.filter(
    (issue) => isCandidate(issue, options) && !claimed.has(issue.number) && blockedBy(issue) === 0,
  );
  const sorted = sortIssues(ready).map(toTask);
  return options.limit === undefined ? sorted : sorted.slice(0, options.limit);
}

/**
 * Lines to print: a header row and one aligned row per task.
 * @param {Task[]} tasks
 */
export function formatTasks(tasks) {
  if (tasks.length === 0) return ["Nothing to pick up right now: every open task is taken, blocked or excluded."];
  const rows = tasks.map((t) => [`#${t.number}`, t.priority || "-", t.size || "-", t.milestone || "-", t.title]);
  const header = ["Issue", "Pri", "Size", "Milestone", "Title"];
  const widths = header.slice(0, -1).map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells) =>
    cells.map((c, i) => (i < widths.length ? c.padEnd(widths[i]) : c)).join("  ").trimEnd();
  return [line(header), ...rows.map(line)];
}

/**
 * @param {string[]} argv  arguments after the script name
 * @returns {{ limit?: number, area?: string, repo: string, help: boolean }}
 */
export function parseArgs(argv) {
  /** @type {{ limit?: number, area?: string, repo: string, help: boolean }} */
  const options = { repo: REPO, help: false };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s, 2);
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined || v === "") throw new Error(`${flag} needs a value`);
      return v;
    };
    if (flag === "--help" || flag === "-h") options.help = true;
    else if (flag === "--limit" || flag === "-n") {
      const raw = value();
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) throw new Error(`--limit must be a whole number above 0, not "${raw}"`);
      options.limit = n;
    } else if (flag === "--area") options.area = value();
    else if (flag === "--repo") options.repo = value();
    else throw new Error(`Unknown option "${argv[i]}". Try --help.`);
  }
  return options;
}

export const HELP = `Usage: npm run next-task -- [--limit N] [--area <name>]

Lists open, unassigned, unblocked tasks in milestone then priority order (P1 -> P3).

  --limit N, -n N   show only the first N tasks
  --area <name>     only issues labelled area:<name> (e.g. customer, tradie, setup, design-system)
  --repo owner/name another repo (default ${REPO})
  --help            this message`;

// ---------------------------------------------------------------------------------------------------------------
// Talking to GitHub (REST through the gh CLI)
// ---------------------------------------------------------------------------------------------------------------

/** @type {GhApi} */
export function ghApi(args) {
  const out = execFileSync("gh", ["api", ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return JSON.parse(out);
}

/**
 * Every page of a list endpoint, using `page=N` (see the note at the top of the file).
 * @param {GhApi} gh
 * @param {string} path  e.g. "repos/o/r/issues?state=open"
 */
export function fetchAllPages(gh, path) {
  const all = [];
  for (let page = 1; ; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const items = /** @type {unknown[]} */ (gh([`${path}${sep}per_page=${PER_PAGE}&page=${page}`]));
    all.push(...items);
    if (items.length < PER_PAGE) return all;
  }
}

/**
 * Number of open issues blocking this one. Uses `issue_dependencies_summary.blocked_by` from the issue list; if the
 * API didn't include it, asks the dependencies endpoint and counts the blockers that are still open.
 * @param {GhApi} gh
 * @param {string} repo
 * @param {Issue} issue
 */
export function openBlockerCount(gh, repo, issue) {
  const summary = issue.issue_dependencies_summary;
  if (summary && typeof summary.blocked_by === "number") return summary.blocked_by;
  const blockers = /** @type {Issue[]} */ (
    fetchAllPages(gh, `repos/${repo}/issues/${issue.number}/dependencies/blocked_by`)
  );
  return blockers.filter((b) => b.state === "open").length;
}

/**
 * Issue numbers already taken by a "Taking this" comment or an open pull request that closes them.
 * Only looks at comments on issues that are otherwise ready and have comments, to keep API calls down.
 * @param {GhApi} gh
 * @param {string} repo
 * @param {Issue[]} ready
 */
export function claimedIssues(gh, repo, ready) {
  const claimed = new Set();
  for (const pr of /** @type {Array<{ body?: string | null }>} */ (
    fetchAllPages(gh, `repos/${repo}/pulls?state=open`)
  )) {
    for (const n of issuesClosedBy(pr.body ?? "")) claimed.add(n);
  }
  for (const issue of ready) {
    if (claimed.has(issue.number) || !issue.comments) continue;
    const comments = /** @type {Array<{ body?: string }>} */ (
      fetchAllPages(gh, `repos/${repo}/issues/${issue.number}/comments`)
    );
    if (comments.some((c) => isClaimComment(c.body ?? ""))) claimed.add(issue.number);
  }
  return claimed;
}

/**
 * Fetch, filter and sort. Separate from `main` so tests can pass a fake `gh`.
 * @param {GhApi} gh
 * @param {ReturnType<typeof parseArgs>} options
 */
export function findNextTasks(gh, options) {
  const issues = /** @type {Issue[]} */ (fetchAllPages(gh, `repos/${options.repo}/issues?state=open`));
  const blockers = new Map();
  const ready = issues.filter((issue) => {
    if (!isCandidate(issue, options)) return false;
    const count = openBlockerCount(gh, options.repo, issue);
    blockers.set(issue.number, count);
    return count === 0;
  });
  const claimed = claimedIssues(gh, options.repo, ready);
  return selectTasks(issues, { ...options, claimed, blockedBy: (issue) => blockers.get(issue.number) ?? 1 });
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(/** @type {Error} */ (error).message);
    process.exit(2);
  }
  if (options.help) {
    console.log(HELP);
    return;
  }
  let tasks;
  try {
    tasks = findNextTasks(ghApi, options);
  } catch (error) {
    const err = /** @type {Error & { code?: string, stderr?: string }} */ (error);
    if (err.code === "ENOENT") console.error("The GitHub CLI (gh) isn't installed. See https://cli.github.com.");
    else console.error(`Couldn't read issues from GitHub. Is \`gh auth status\` OK?\n${err.stderr || err.message}`);
    process.exit(1);
  }
  if (tasks.length === 0 && options.area) {
    console.log(`No tasks to pick up with the label ${areaLabel(options.area)}.`);
    return;
  }
  for (const line of formatTasks(tasks)) console.log(line);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
