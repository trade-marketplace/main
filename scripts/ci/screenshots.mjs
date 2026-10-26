#!/usr/bin/env node
// Screenshots on every UI PR (#90). Run by .github/workflows/screenshots.yml; how it fits together: docs/TESTING.md
// ("Screenshots on UI PRs").
//
//   node scripts/ci/screenshots.mjs plan      changed files on stdin → screenshots/plan.json (+ GitHub outputs)
//   node scripts/ci/screenshots.mjs start     start the built app in the background; fail with its log if it won't
//   node scripts/ci/screenshots.mjs comment   screenshots/plan.json + screenshots/results/*.json → comment.md
//   node scripts/ci/screenshots.mjs publish   push the images to the screenshots branch, post ONE comment, re-run
//                                             the PR gate
//
// The capture in between (start the app, sign in, take the pictures) is a Playwright run:
// scripts/screenshots/capture.spec.ts. Everything here uses Node built-ins only, and the pure functions are
// exported for tests (tests/unit/screenshots.test.ts).

import { execFileSync, spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, posix, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { isUiFile, SCREENSHOTS_MARKER, screenshotsShaLine, UI_LABEL, visibleText } from "./pr-gate.mjs";

/** The branch the workflow alone pushes images to. Never merged; nothing else lives there. */
export const IMAGES_BRANCH = "pr-screenshots";
export const RETENTION_DAYS = 7;
/** Widths every route is shot at (AGENTS.md §3: desktop 1440 + phone 390). */
export const WIDTHS = /** @type {const} */ ([1440, 390]);
/** More than this and the run would pass 3 minutes; the rest are listed in the comment instead. */
export const MAX_ENTRIES = 12;

/** Changes to these files run the screenshots even without a UI change, so the tooling proves itself. */
const TOOLING_FILES = ["scripts/ci/screenshots.mjs", "scripts/screenshots/", ".github/workflows/screenshots.yml"];

export const ROLE_WORDS = /** @type {const} */ (["guest", "customer", "tradie", "worker", "office"]);
const ROLE_ALIASES = /** @type {Record<string, (typeof ROLE_WORDS)[number]>} */ ({
  guest: "guest",
  "signed-out": "guest",
  anonymous: "guest",
  customer: "customer",
  tradie: "tradie",
  trade: "tradie",
  worker: "worker",
  office: "office",
  admin: "office",
});
export const JOB_STATUSES = /** @type {const} */ ([
  "REVIEW",
  "QUOTE_BOUNTY",
  "PRICED",
  "BOOKABLE",
  "ASSIGNED",
  "SUBMITTED",
  "COMPLETED",
  "CANCEL_REVIEW",
  "CANCELLED",
]);

/**
 * @typedef {(typeof ROLE_WORDS)[number]} RoleWord
 * @typedef {(typeof JOB_STATUSES)[number]} JobStatus
 * @typedef {{ path: string, role?: RoleWord, status?: JobStatus }} PlanEntry
 *   `path` is a route (`/jobs/[id]`) or a real URL path, with any `?state=…` query flags.
 * @typedef {{ capture: boolean, reason: string, source: "description" | "files" | "tooling" | "none",
 *   entries: PlanEntry[], omitted: string[], problems: string[] }} Plan
 * @typedef {{ id: string, label: string, url: string, files: Record<string, string>,
 *   notes?: string[], error?: string }} ShotResult
 *   `files` maps width ("1440") to the image's file name.
 */

// ---------------------------------------------------------------------------------------------
// The `screenshots:` list in the PR description

/**
 * Reads the `screenshots:` list from the PR description:
 *
 *     screenshots:
 *     - /jobs?state=empty as tradie
 *     - /jobs/[id] status=ASSIGNED
 *     - `/admin`
 *
 * or on one line: `screenshots: /, /jobs?state=empty`. Each item is a path (with any query flags for the state),
 * then optionally `as <guest|customer|tradie|worker|office>` and `status=<JOB STATUS>`. Hidden text (HTML
 * comments, code blocks) doesn't count, so the PR template's example can't trigger it.
 * @param {string | null | undefined} body
 * @returns {{ found: boolean, entries: PlanEntry[], problems: string[] }}
 */
export function parseScreenshotsList(body) {
  const lines = visibleText(body, { keepInlineCode: true }).split("\n");
  const start = lines.findIndex((line) => /^[ \t>]*(?:#{1,6}[ \t]*)?\**screenshots\**:/i.test(line));
  if (start === -1) return { found: false, entries: [], problems: [] };

  /** @type {string[]} */
  const items = [];
  const inline = lines[start].replace(/^[ \t>]*(?:#{1,6}[ \t]*)?\**screenshots\**:\**/i, "").trim();
  if (inline)
    items.push(
      ...inline
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );
  for (const line of inline ? [] : lines.slice(start + 1)) {
    if (/^[ \t>]*$/.test(line)) {
      if (items.length > 0) break; // a blank line after the list ends it
      continue;
    }
    const item = /^[ \t>]*(?:[-*+]|\d{1,9}[.)])[ \t]+(.*)$/.exec(line);
    if (!item) break;
    items.push(item[1].trim());
  }

  /** @type {PlanEntry[]} */
  const entries = [];
  /** @type {string[]} */
  const problems = [];
  for (const raw of items) {
    const parsed = parseItem(raw);
    if (typeof parsed === "string") problems.push(parsed);
    else entries.push(parsed);
  }
  return { found: true, entries, problems };
}

/**
 * @param {string} raw
 * @returns {PlanEntry | string} the entry, or what's wrong with it
 */
function parseItem(raw) {
  const words = raw.replace(/`/g, " ").trim().split(/\s+/).filter(Boolean);
  const [path, ...rest] = words;
  if (!path?.startsWith("/") || path.startsWith("//")) {
    return `\`${raw.replace(/`/g, "'")}\` isn't a path: start each item with \`/\`, e.g. \`/jobs?state=empty\`.`;
  }
  /** @type {PlanEntry} */
  const entry = { path };
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i].replace(/[.,;]+$/, "");
    if (word.toLowerCase() === "as" && rest[i + 1]) {
      const role = ROLE_ALIASES[rest[i + 1].toLowerCase().replace(/[.,;]+$/, "")];
      if (!role) return `\`${raw}\`: unknown role "${rest[i + 1]}" (use ${ROLE_WORDS.join(", ")}).`;
      entry.role = role;
      i++;
      continue;
    }
    const status = /^status=(\w+)$/i.exec(word);
    if (status) {
      const value = /** @type {JobStatus} */ (status[1].toUpperCase());
      if (!JOB_STATUSES.includes(value)) {
        return `\`${raw}\`: unknown job status "${status[1]}" (use ${JOB_STATUSES.join(", ")}).`;
      }
      entry.status = value;
      continue;
    }
    return `\`${raw}\`: didn't understand "${rest[i]}" (expected \`as <role>\` or \`status=<STATUS>\`).`;
  }
  return entry;
}

// ---------------------------------------------------------------------------------------------
// Changed routes from changed files

const SOURCE_EXT = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".css"];
/** Files that wrap every page in and below their folder. */
const WRAPPERS = /^(layout|template|loading|error|not-found|forbidden|unauthorized|default|global-error)\.[jt]sx?$/;

/**
 * `src/app/(shop)/jobs/[id]/page.tsx` → `/jobs/[id]`. Null for files that aren't pages, and for pages no one can
 * open by URL (private `_folders`, intercepting `(.)` routes).
 * @param {string} file
 */
export function routeForPage(file) {
  const match = /^src\/app\/(?:(.*)\/)?page\.[jt]sx?$/.exec(file);
  if (!match) return null;
  const segments = (match[1] ?? "").split("/").filter(Boolean);
  if (segments.some((segment) => segment.startsWith("_") || /^\(\.+\)/.test(segment))) return null;
  const visible = segments.filter((segment) => !/^\(.*\)$/.test(segment) && !segment.startsWith("@"));
  return `/${visible.join("/")}`;
}

/**
 * Import specifiers in a source file: `import … from "x"`, `import "x"`, `export … from "x"`, `import("x")`,
 * and CSS `@import "x"`.
 * @param {string} source
 */
export function importsOf(source) {
  const found = new Set();
  const patterns = [
    /\b(?:import|export)\s[^"'`;]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /@import\s+(?:url\()?["']([^"']+)["']/g,
  ];
  for (const re of patterns) for (const match of source.matchAll(re)) found.add(match[1]);
  return [...found];
}

/**
 * Where an import points, as a repo path, or null for packages.
 * @param {string} from the importing file
 * @param {string} specifier
 * @param {Set<string>} known every source file
 */
function resolveImport(from, specifier, known) {
  let base;
  if (specifier.startsWith("@/")) base = `src/${specifier.slice(2)}`;
  else if (specifier.startsWith(".")) base = posix.normalize(posix.join(posix.dirname(from), specifier));
  else return null;
  for (const candidate of [
    base,
    ...SOURCE_EXT.map((ext) => base + ext),
    ...SOURCE_EXT.map((ext) => `${base}/index${ext}`),
  ]) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

/**
 * The routes a change shows up on. A changed page is its own route; a changed layout (or loading/error file) is
 * every page in and below its folder; any other changed file counts for every page that imports it, directly or
 * through other files. Deleted pages aren't routes any more, so they're left out.
 * @param {string[]} changed changed file paths (repo-relative)
 * @param {Map<string, string>} sources every file under src/ that still exists, with its contents
 * @returns {string[]} sorted, unique routes
 */
export function detectRoutes(changed, sources) {
  const known = new Set(sources.keys());
  /** @type {Map<string, string[]>} */
  const importers = new Map();
  for (const [file, source] of sources) {
    for (const specifier of importsOf(source)) {
      const target = resolveImport(file, specifier, known);
      if (target) importers.set(target, [...(importers.get(target) ?? []), file]);
    }
  }

  // Everything that depends on a changed file.
  const reached = new Set(changed.filter((file) => known.has(file)));
  const queue = [...reached];
  while (queue.length > 0) {
    for (const importer of importers.get(/** @type {string} */ (queue.shift())) ?? []) {
      if (!reached.has(importer)) {
        reached.add(importer);
        queue.push(importer);
      }
    }
  }

  const pages = [...known].filter((file) => routeForPage(file) !== null);
  const routes = new Set();
  for (const file of reached) {
    if (!file.startsWith("src/app/")) continue;
    const name = posix.basename(file);
    if (routeForPage(file)) routes.add(routeForPage(file));
    else if (WRAPPERS.test(name)) {
      const folder = `${posix.dirname(file)}/`;
      for (const page of pages) if (page.startsWith(folder)) routes.add(routeForPage(page));
    }
  }
  return [...routes].sort((a, b) => a.localeCompare(b));
}

/**
 * What to shoot for this PR.
 * @param {{ changed: string[], body?: string | null, labels?: string[], sources: Map<string, string> }} pr
 * @returns {Plan}
 */
export function buildPlan({ changed, body, labels = [], sources }) {
  const labelled = labels.some((label) => label.toLowerCase() === UI_LABEL);
  const uiFiles = changed.some(isUiFile);
  const tooling = changed.some((file) => TOOLING_FILES.some((prefix) => file === prefix || file.startsWith(prefix)));
  const list = parseScreenshotsList(body);

  if (!labelled && !uiFiles && !tooling) {
    return { capture: false, reason: "No screen changes.", source: "none", entries: [], omitted: [], problems: [] };
  }

  /** @type {PlanEntry[]} */
  let entries;
  /** @type {Plan["source"]} */
  let source;
  let reason;
  if (list.found) {
    entries = list.entries;
    source = "description";
    reason = "Routes from the `screenshots:` list in the description.";
  } else {
    entries = detectRoutes(changed, sources).map((path) => ({ path }));
    source = "files";
    reason = "Routes found from the changed files.";
    if (entries.length === 0 && tooling) {
      entries = [{ path: "/" }];
      source = "tooling";
      reason = "The screenshot tooling changed, so the home page is shot to prove it still works.";
    }
  }

  const unique = [...new Map(entries.map((entry) => [JSON.stringify(entry), entry])).values()];
  const omitted = unique.slice(MAX_ENTRIES).map(describeEntry);
  return {
    capture: unique.length > 0,
    reason,
    source,
    entries: unique.slice(0, MAX_ENTRIES),
    omitted,
    problems: list.problems,
  };
}

/** @param {PlanEntry} entry */
export function describeEntry(entry) {
  return [entry.path, entry.role && `as ${entry.role}`, entry.status && `status=${entry.status}`]
    .filter(Boolean)
    .join(" ");
}

// ---------------------------------------------------------------------------------------------
// Starting the app

/**
 * Waits until the app answers at `url`. Gives up when the server process has stopped (it crashed: no point
 * waiting) or after `timeoutMs`.
 * @param {{ url: string, isRunning: () => boolean, timeoutMs?: number, intervalMs?: number,
 *   fetchImpl?: (url: string) => Promise<{ status: number }>, sleep?: (ms: number) => Promise<void>,
 *   now?: () => number }} options
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function waitForApp({
  url,
  isRunning,
  timeoutMs = 60_000,
  intervalMs = 500,
  fetchImpl = (target) => fetch(target, { redirect: "manual" }),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (!isRunning()) return { ok: false, reason: "The app stopped before it started answering." };
    try {
      const response = await fetchImpl(url);
      if (response.status < 500) return { ok: true };
    } catch {
      // Not listening yet.
    }
    await sleep(intervalMs);
  }
  return { ok: false, reason: `The app didn't answer at ${url} within ${Math.round(timeoutMs / 1000)} seconds.` };
}

/**
 * The end of a log, for the job output and step summary (the whole file is in the artifact).
 * @param {string} log
 * @param {number} [lines]
 */
export function logTail(log, lines = 60) {
  const all = log.replace(/\s+$/, "").split("\n");
  return (all.length > lines ? ["…", ...all.slice(-lines)] : all).join("\n");
}

// ---------------------------------------------------------------------------------------------
// The comment

/**
 * Where a published image is shown from. Blob URLs with `?raw=true` work in a private repo for anyone who can see
 * the repo: GitHub swaps them for a signed raw link when the page is opened.
 * @param {{ serverUrl: string, repo: string, pr: number | string, sha: string }} where
 * @param {string} file
 */
export function imageUrl({ serverUrl, repo, pr, sha }, file) {
  return `${serverUrl}/${repo}/blob/${IMAGES_BRANCH}/${imagesFolder(pr, sha)}/${encodeURIComponent(file)}?raw=true`;
}

/**
 * @param {number | string} pr
 * @param {string} sha
 */
export function imagesFolder(pr, sha) {
  return `pr-${pr}/${sha}`;
}

/** @param {string} text */
function cell(text) {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * The one comment the bot keeps on a PR: a table of route · 1440 · 390.
 * @param {{ plan: Plan, results: ShotResult[], skipped?: { label: string, reason: string }[],
 *   where: { serverUrl: string, repo: string, pr: number | string, sha: string }, runUrl?: string }} input
 */
export function renderComment({ plan, results, skipped = [], where, runUrl }) {
  const short = where.sha.slice(0, 7);
  const lines = [SCREENSHOTS_MARKER, screenshotsShaLine(where.sha), `### Screenshots of ${short}`, ""];
  const shots = [...results].sort((a, b) => a.label.localeCompare(b.label));
  if (shots.length > 0) {
    lines.push(`| Route | ${WIDTHS.join(" | ")} |`, `|---|${WIDTHS.map(() => "---").join("|")}|`);
    for (const shot of shots) {
      const notes = [...(shot.notes ?? []), ...(shot.error ? [`⚠️ ${shot.error}`] : [])];
      const label = `\`${cell(shot.label)}\`${notes.length > 0 ? `<br>${cell(notes.join(" · "))}` : ""}`;
      const images = WIDTHS.map((width) => {
        const file = shot.files[String(width)];
        if (!file) return "—";
        const url = imageUrl(where, file);
        return `<a href="${url}"><img src="${url}" width="${width === 1440 ? 360 : 160}" alt="${cell(shot.label)} at ${width}px"></a>`;
      });
      lines.push(`| ${label} | ${images.join(" | ")} |`);
    }
    lines.push("");
  } else {
    lines.push("No screenshots were taken.", "");
  }

  const extra = [
    ...skipped.map((skip) => `\`${skip.label}\`: ${skip.reason}`),
    ...plan.omitted.map((entry) => `\`${entry}\`: not shot, over the limit of ${MAX_ENTRIES} routes per run.`),
    ...plan.problems,
  ];
  if (extra.length > 0) {
    lines.push("<details><summary>Not shot</summary>", "", ...extra.map((text) => `- ${text}`), "", "</details>", "");
  }
  lines.push(
    `_${plan.reason} Seed data from \`prisma/seed\`, reduced motion on, full page. Pick routes, roles and states with a \`screenshots:\` list in the description ([docs/TESTING.md](${where.serverUrl}/${where.repo}/blob/main/docs/TESTING.md#screenshots-on-ui-prs)). Images are kept ${RETENTION_DAYS} days${runUrl ? `; the [run's artifacts](${runUrl}) have the same files` : ""}._`,
  );
  return lines.join("\n");
}

/**
 * The comment when there was nothing to shoot, or the capture failed. Has no images, so it never satisfies the
 * PR gate.
 * @param {{ sha: string, title: string, text: string, runUrl?: string }} input
 */
export function renderNoticeComment({ sha, title, text, runUrl }) {
  return [
    SCREENSHOTS_MARKER,
    screenshotsShaLine(sha),
    `### Screenshots of ${sha.slice(0, 7)}: ${title}`,
    "",
    text,
    ...(runUrl ? ["", `[Open the run](${runUrl}) for the log and artifacts.`] : []),
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------
// Publishing

/**
 * Which PR folders stay on the images branch: this run replaces its own PR's folder, and anything not updated in
 * the last RETENTION_DAYS days goes.
 * @param {Record<string, string>} index folder (`pr-12`) → ISO time it was last updated
 * @param {string} folder this PR's folder
 * @param {Date} now
 * @returns {{ keep: string[], index: Record<string, string> }}
 */
export function pruneIndex(index, folder, now) {
  const cutoff = now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  /** @type {Record<string, string>} */
  const next = {};
  for (const [name, updated] of Object.entries(index)) {
    const time = Date.parse(updated);
    if (name !== folder && /^pr-\d+$/.test(name) && Number.isFinite(time) && time >= cutoff) next[name] = updated;
  }
  const keep = Object.keys(next).sort();
  next[folder] = now.toISOString();
  return { keep, index: next };
}

/**
 * The PR gate run to re-run once the comment is up: the latest one for this commit, if it failed. A gate run that
 * passed doesn't need it.
 * @param {{ id: number, status: string, conclusion: string | null, created_at: string }[]} runs
 * @returns {{ action: "rerun", id: number } | { action: "wait" } | { action: "none" }}
 */
export function gateRunToRerun(runs) {
  const latest = [...runs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (!latest) return { action: "none" };
  if (latest.status !== "completed") return { action: "wait" };
  return latest.conclusion === "failure" ? { action: "rerun", id: latest.id } : { action: "none" };
}

/**
 * Creates or updates the one screenshot comment (a bot comment starting with the marker).
 * @param {{ gh: GitHub, repo: string, pr: number | string, body: string }} options
 * @returns {Promise<"created" | "updated" | "unchanged">}
 */
export async function upsertComment({ gh, repo, pr, body }) {
  const comments = await paginate(gh, `/repos/${repo}/issues/${pr}/comments`);
  const existing = comments.find(
    (/** @type {{ body?: string, user?: { type?: string } }} */ c) =>
      c.user?.type === "Bot" && c.body?.startsWith(SCREENSHOTS_MARKER),
  );
  if (existing?.body === body) return "unchanged";
  if (existing) {
    await gh(`/repos/${repo}/issues/comments/${existing.id}`, { method: "PATCH", body: { body } });
    return "updated";
  }
  await gh(`/repos/${repo}/issues/${pr}/comments`, { method: "POST", body: { body } });
  return "created";
}

/**
 * @typedef {(path: string, init?: { method?: string, body?: unknown }) => Promise<any>} GitHub
 */

/**
 * @param {string} token
 * @returns {GitHub}
 */
function githubClient(token) {
  const api = process.env.GITHUB_API_URL ?? "https://api.github.com";
  return async (path, init = {}) => {
    const response = await fetch(path.startsWith("http") ? path : `${api}${path}`, {
      method: init.method ?? "GET",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    if (!response.ok)
      throw new Error(`${init.method ?? "GET"} ${path} failed: ${response.status} ${await response.text()}`);
    const text = await response.text(); // re-running a workflow answers with no body
    return text ? JSON.parse(text) : {};
  };
}

/**
 * @param {GitHub} gh
 * @param {string} path
 */
async function paginate(gh, path) {
  const all = [];
  for (let page = 1; page <= 30; page++) {
    const items = await gh(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    all.push(...items);
    if (items.length < 100) break;
  }
  return all;
}

/**
 * Commits the images as the only content of the images branch, next to the other PRs' folders that are still
 * within RETENTION_DAYS. History isn't kept (each commit has no parent), so the branch never grows. Pushes with
 * --force-with-lease so two PRs publishing at once can't wipe each other's folders: the loser starts again.
 * Uses the credentials actions/checkout left in the local repo; the token never appears on a command line.
 * @param {{ dir: string, folder: string, files: string[], cwd?: string, now?: () => Date,
 *   log?: (message: string) => void, beforePush?: (attempt: number) => void }} options
 *   `dir`: the folder holding the images; `folder`: `pr-<n>/<sha>`; `cwd`: the git checkout to push from;
 *   `beforePush`: lets tests move the branch between reading and pushing.
 */
export function pushImages({
  dir,
  folder,
  files,
  cwd = process.cwd(),
  now = () => new Date(),
  log = console.log,
  beforePush = () => {},
}) {
  const git = (/** @type {string[]} */ args, /** @type {Record<string, string>} */ env = {}, input = undefined) =>
    execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...env }, input, stdio: "pipe" }).trim();
  const prFolder = folder.split("/")[0];
  // A separate index, so the checkout's own files and index are never touched.
  const indexFile = resolve(process.env.RUNNER_TEMP ?? dir, "screenshots-index");

  for (let attempt = 1; attempt <= 5; attempt++) {
    let old = "";
    try {
      git([
        "fetch",
        "--quiet",
        "--depth=1",
        "origin",
        `+refs/heads/${IMAGES_BRANCH}:refs/remotes/origin/${IMAGES_BRANCH}`,
      ]);
      old = git(["rev-parse", `refs/remotes/origin/${IMAGES_BRANCH}`]);
    } catch {
      log(`The ${IMAGES_BRANCH} branch doesn't exist yet; creating it.`);
    }
    /** @type {Record<string, string>} */
    let index = {};
    if (old) {
      try {
        index = JSON.parse(git(["show", `${old}:index.json`]));
      } catch {
        index = {};
      }
    }
    const pruned = pruneIndex(index, prFolder, now());
    const env = { GIT_INDEX_FILE: indexFile };
    git(["read-tree", "--empty"], env);
    for (const keep of pruned.keep) {
      if (!old) break;
      try {
        git(["read-tree", `--prefix=${keep}/`, `${old}:${keep}`], env);
      } catch {
        // Listed in the index but missing from the tree: nothing to keep.
      }
    }
    for (const file of files) {
      const blob = git(["hash-object", "-w", resolve(dir, file)]);
      git(["update-index", "--add", "--cacheinfo", `100644,${blob},${folder}/${file}`], env);
    }
    const indexBlob = git(["hash-object", "-w", "--stdin"], {}, `${JSON.stringify(pruned.index, null, 2)}\n`);
    git(["update-index", "--add", "--cacheinfo", `100644,${indexBlob},index.json`], env);
    const readme = git(
      ["hash-object", "-w", "--stdin"],
      {},
      `PR screenshots (#90), pushed only by .github/workflows/screenshots.yml. Never merge this branch.\n` +
        `Each PR's folder is replaced on every run and removed after ${RETENTION_DAYS} days.\n`,
    );
    git(["update-index", "--add", "--cacheinfo", `100644,${readme},README.md`], env);
    const tree = git(["write-tree"], env);
    const commit = git(["commit-tree", tree, "-m", `Screenshots for ${folder}`], {
      GIT_AUTHOR_NAME: "github-actions[bot]",
      GIT_AUTHOR_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
      GIT_COMMITTER_NAME: "github-actions[bot]",
      GIT_COMMITTER_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
    });
    beforePush(attempt);
    try {
      git([
        "push",
        "--quiet",
        `--force-with-lease=refs/heads/${IMAGES_BRANCH}:${old}`,
        "origin",
        `${commit}:refs/heads/${IMAGES_BRANCH}`,
      ]);
      log(`Pushed ${files.length} images to ${IMAGES_BRANCH}/${folder}.`);
      return;
    } catch (error) {
      if (attempt === 5) throw error;
      log(`The ${IMAGES_BRANCH} branch moved while publishing (attempt ${attempt}); trying again.`);
    }
  }
}

/**
 * Re-runs the PR gate for this commit if it failed, so the new comment counts straight away. Waits up to two
 * minutes for a gate run that's still going.
 * @param {{ gh: GitHub, repo: string, sha: string, log?: (message: string) => void, sleep?: (ms: number) => Promise<void> }} options
 */
export async function rerunGate({
  gh,
  repo,
  sha,
  log = console.log,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  for (let tries = 0; tries < 12; tries++) {
    const { workflow_runs: runs = [] } = await gh(
      `/repos/${repo}/actions/workflows/pr-gate.yml/runs?head_sha=${sha}&event=pull_request&per_page=20`,
    );
    const decision = gateRunToRerun(runs);
    if (decision.action === "none") return "not-needed";
    if (decision.action === "rerun") {
      await gh(`/repos/${repo}/actions/runs/${decision.id}/rerun`, { method: "POST" });
      log(`Re-ran the PR gate (run ${decision.id}) so it sees the screenshots.`);
      return "rerun";
    }
    await sleep(10_000);
  }
  log("The PR gate is still running; it will see the screenshots on its next run.");
  return "timed-out";
}

// ---------------------------------------------------------------------------------------------
// Command line

const OUT = process.env.SCREENSHOTS_DIR ?? "screenshots";

/** @param {string} dir */
function listSources(dir) {
  /** @type {Map<string, string>} */
  const sources = new Map();
  /** @param {string} folder */
  const walk = (folder) => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (SOURCE_EXT.some((ext) => name.endsWith(ext)))
        sources.set(path.split("\\").join("/"), readFileSync(path, "utf8"));
    }
  };
  if (existsSync(dir)) walk(dir);
  return sources;
}

/**
 * @param {string} name
 * @param {string} value
 */
function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

/** @param {string} path */
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function where() {
  const {
    GITHUB_SERVER_URL = "https://github.com",
    GITHUB_REPOSITORY = "owner/repo",
    PR_NUMBER = "0",
    HEAD_SHA = "0000000",
  } = process.env;
  return { serverUrl: GITHUB_SERVER_URL, repo: GITHUB_REPOSITORY, pr: PR_NUMBER, sha: HEAD_SHA };
}

function commandPlan() {
  const changed = readFileSync(0, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const plan = buildPlan({
    changed,
    body: process.env.PR_BODY,
    labels: JSON.parse(process.env.PR_LABELS || "[]"),
    sources: listSources("src"),
  });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  console.log(plan.reason);
  for (const entry of plan.entries) console.log(`  ${describeEntry(entry)}`);
  for (const problem of plan.problems) console.log(`::warning title=screenshots: list::${problem}`);
  // `run`: this PR gets a screenshot comment at all. `capture`: there's something to shoot.
  setOutput("run", String(plan.source !== "none"));
  setOutput("capture", String(plan.capture));
}

async function commandStart() {
  const port = process.env.APP_PORT ?? "3100";
  mkdirSync(OUT, { recursive: true });
  const logFile = join(OUT, "server.log");
  // Something else answering on the port would be shot instead of this build.
  const taken = await fetch(`http://127.0.0.1:${port}/`, { redirect: "manual" }).then(
    () => true,
    () => false,
  );
  if (taken) {
    console.log(
      `::error title=The app didn't start::Something is already listening on port ${port}. Stop it, or set APP_PORT.`,
    );
    process.exitCode = 1;
    return;
  }
  const log = openSync(logFile, "w");
  const server = spawn("npm", ["run", "start", "--", "--port", port], { detached: true, stdio: ["ignore", log, log] });
  let running = true;
  server.on("exit", () => (running = false));
  const result = await waitForApp({ url: `http://127.0.0.1:${port}/`, isRunning: () => running });
  if (result.ok) {
    server.unref(); // keep it running for the next steps
    console.log(`The app is up on port ${port}. Log: ${logFile}`);
    return;
  }
  if (running) server.kill();
  const tail = logTail(readFileSync(logFile, "utf8"));
  console.log(`::error title=The app didn't start::${result.reason} The server log is attached to the run.`);
  console.log(tail);
  const fence = "````";
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### The app didn't start\n\n${result.reason}\n\n${fence}\n${tail}\n${fence}\n`,
    );
  }
  process.exitCode = 1;
}

function commandComment() {
  const plan = /** @type {Plan} */ (readJson(join(OUT, "plan.json")));
  const resultsDir = join(OUT, "results");
  const results = existsSync(resultsDir)
    ? readdirSync(resultsDir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => readJson(join(resultsDir, name)))
    : [];
  const skipped = existsSync(join(OUT, "skipped.json")) ? readJson(join(OUT, "skipped.json")) : [];
  const body = renderComment({ plan, results, skipped, where: where(), runUrl: process.env.RUN_URL });
  writeFileSync(join(OUT, "comment.md"), `${body}\n`);
  console.log(body);
}

async function commandPublish() {
  const {
    GITHUB_TOKEN: token,
    GITHUB_REPOSITORY: repo,
    PR_NUMBER: pr,
    HEAD_SHA: sha,
    CAPTURE_RESULT,
    RUN_URL,
  } = process.env;
  if (!token || !repo || !pr || !sha)
    throw new Error("GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER and HEAD_SHA must be set.");
  const gh = githubClient(token);
  const commentFile = join(OUT, "comment.md");

  let body;
  if (CAPTURE_RESULT === "success" && existsSync(commentFile)) {
    const files = readdirSync(OUT).filter((name) => name.endsWith(".png"));
    if (files.length > 0) pushImages({ dir: OUT, folder: imagesFolder(pr, sha), files });
    body = readFileSync(commentFile, "utf8").trim();
  } else if (CAPTURE_RESULT === "skipped" && existsSync(join(OUT, "plan.json"))) {
    const plan = /** @type {Plan} */ (readJson(join(OUT, "plan.json")));
    body = renderNoticeComment({
      sha,
      title: "no routes found",
      text: [
        "This PR changes screens, but no page route could be worked out from the changed files. List the routes under",
        "`screenshots:` in the description (see docs/TESTING.md), e.g.",
        "",
        "    screenshots:",
        "    - /jobs?state=empty as tradie",
        ...(plan.problems.length > 0 ? ["", ...plan.problems.map((problem) => `- ${problem}`)] : []),
      ].join("\n"),
      runUrl: RUN_URL,
    });
  } else {
    body = renderNoticeComment({
      sha,
      title: "failed",
      text: "The screenshots couldn't be taken (the app didn't start, or a capture failed). The run's `screenshots-server-log` artifact has the server log.",
      runUrl: RUN_URL,
    });
  }

  console.log(`Screenshot comment ${await upsertComment({ gh, repo, pr, body })}.`);
  try {
    await rerunGate({ gh, repo, sha });
  } catch (error) {
    console.log(
      `::warning::Couldn't re-run the PR gate; re-run it by hand: ${error instanceof Error ? error.message : error}`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2];
  const run = { plan: commandPlan, start: commandStart, comment: commandComment, publish: commandPublish }[
    command ?? ""
  ];
  if (!run) {
    console.error("Usage: node scripts/ci/screenshots.mjs plan|start|comment|publish");
    process.exitCode = 2;
  } else {
    Promise.resolve()
      .then(run)
      .catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
  }
}
