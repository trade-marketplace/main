#!/usr/bin/env node
// PR gate (#69): fails a pull request that skips the rules in AGENTS.md section 3 and 7.
// Rules and escape hatches are documented in docs/PR_GATE.md.
//
// The checking functions are pure and exported for tests (tests/unit/pr-gate.test.ts).
// Run as a script (from .github/workflows/pr-gate.yml) it reads the PR from the GitHub API,
// posts or updates ONE comment, and exits 1 when something is missing.

import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const COMMENT_MARKER = "<!-- pr-gate -->";
export const SKIP_LABEL = "skip-gate";
export const NO_SCREENS_LABEL = "no-screens";
export const UI_LABEL = "ui";
// The screenshot bot's comment (#90, scripts/ci/screenshots.mjs). Kept here so the gate needs no other file.
export const SCREENSHOTS_MARKER = "<!-- pr-screenshots -->";
export const SCREENSHOTS_BOT = "github-actions[bot]";

/**
 * The hidden line in the screenshot comment that says which commit the pictures are of.
 * @param {string} sha
 */
export function screenshotsShaLine(sha) {
  return `<!-- pr-screenshots-sha: ${sha} -->`;
}

/**
 * Remove everything that GitHub does not show as text: fenced code blocks, HTML comments and
 * inline code spans. A checkbox, `Closes #1` or image inside those must not count.
 * @param {string | null | undefined} body
 * @param {{ keepInlineCode?: boolean }} [options]
 * @returns {string}
 */
export function visibleText(body, { keepInlineCode = false } = {}) {
  const lines = String(body ?? "").replace(/\r\n?/g, "\n").split("\n");

  // 1. Fenced code blocks (``` or ~~~, 3+ chars, may sit inside a list or quote).
  const kept = [];
  /** @type {{ char: string, len: number } | null} */
  let fence = null;
  for (const line of lines) {
    const match = /^[ \t]*(?:>[ \t]*)*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (match && match[1][0] === fence.char && match[1].length >= fence.len) fence = null;
      continue;
    }
    if (match) {
      fence = { char: match[1][0], len: match[1].length };
      continue;
    }
    kept.push(line);
  }

  // 2. HTML comments. An unclosed `<!--` hides the rest of the description on GitHub too.
  const text = kept.join("\n").replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  // 3. Inline code spans (`like this` or ``like this``) on one line.
  return keepInlineCode ? text : text.replace(/(?<!`)(`+)(?!`)[^\n]*?(?<!`)\1(?!`)/g, "");
}

const CLOSING_KEYWORD = String.raw`(?<![\w-])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)`;
const ISSUE_REF = String.raw`(?:(?:[\w.-]+\/[\w.-]+)?#([1-9]\d*)|https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/([1-9]\d*))`;

/**
 * Issue numbers this PR closes (Closes/Fixes/Resolves, any case, optional colon).
 * Each issue needs its own keyword, as on GitHub: `Closes #1, closes #2`.
 * @param {string | null | undefined} body
 * @returns {number[]}
 */
export function findClosedIssues(body) {
  const re = new RegExp(String.raw`${CLOSING_KEYWORD}:?[ \t]+${ISSUE_REF}(?![\w-])`, "gi");
  const found = new Set();
  for (const match of visibleText(body).matchAll(re)) found.add(Number(match[1] ?? match[2]));
  return [...found];
}

/**
 * Text of every unticked task-list box (`- [ ]`, `* [ ]`, `+ [ ]`, `1. [ ]`, inside quotes too).
 * `[x]` and `[X]` are ticked.
 * @param {string | null | undefined} body
 * @returns {string[]}
 */
export function findUntickedBoxes(body) {
  const re = /^[ \t]*(?:>[ \t]*)*(?:[-*+]|\d{1,9}[.)])[ \t]+\[ \](?:[ \t]+(.*))?$/gm;
  // A box only counts at the start of a list item, so inline code can't fake one; keep it for the item text.
  return [...visibleText(body, { keepInlineCode: true }).matchAll(re)].map((match) => (match[1] ?? "").trim());
}

const IMAGE_EXT = String.raw`\.(?:png|jpe?g|gif|webp|avif|svg)(?:\?[^\s)"'<>\]]*)?`;

/**
 * Whether the description shows or links to at least one image: Markdown `![](url)`,
 * HTML `<img src>`, a link to an image file, or a GitHub upload (drag-and-drop) URL.
 * @param {string | null | undefined} body
 * @returns {boolean}
 */
export function hasImage(body) {
  const text = visibleText(body);
  return [
    /!\[[^\]]*\]\(\s*<?[^\s)>]+/, // Markdown image with a URL
    /!\[[^\]]*\]\[[^\]]*\]/, // Markdown reference-style image
    /<img\b[^>]*\bsrc\s*=\s*["']?[^\s"'>]+/i, // HTML image with a src
    new RegExp(String.raw`https?:\/\/[^\s)"'<>\]]+${IMAGE_EXT}(?=$|[\s)"'<>\]])`, "im"), // link to an image file
    /https:\/\/github\.com\/user-attachments\/assets\/[\w-]+/i, // GitHub drag-and-drop upload
    /https:\/\/(?:private-)?user-images\.githubusercontent\.com\/\S+/i, // older GitHub uploads
  ].some((re) => re.test(text));
}

/**
 * The screenshot bot's comment for this exact commit, if it has at least one image. A person can't post as
 * `github-actions[bot]`, and pictures of an older commit don't count: new commits need new screenshots.
 * @param {{ body?: string | null, user?: { login?: string, type?: string } }[]} comments
 * @param {string | null | undefined} headSha
 */
export function findScreenshotsComment(comments, headSha) {
  if (!headSha) return undefined;
  return comments.find(
    (comment) =>
      comment.user?.type === "Bot" &&
      comment.user.login === SCREENSHOTS_BOT &&
      typeof comment.body === "string" &&
      comment.body.startsWith(SCREENSHOTS_MARKER) &&
      comment.body.includes(screenshotsShaLine(headSha)) &&
      hasImage(comment.body),
  );
}

/**
 * Whether a changed file counts as a UI change.
 * @param {string} path
 */
export function isUiFile(path) {
  return path.startsWith("src/app/") || path.startsWith("src/components/") || path.endsWith(".css");
}

/**
 * @typedef {{ rule: "closes" | "checkboxes" | "screenshots", message: string, details?: string[] }} Failure
 * @typedef {{ skipped: boolean, ok: boolean, failures: Failure[], closes: number[], needsScreens: boolean }} GateResult
 */

/**
 * Check a PR against every rule.
 * `botScreenshots`: the screenshot bot has posted pictures of the PR's latest commit (findScreenshotsComment).
 * @param {{ body?: string | null, labels?: string[], files?: string[], botScreenshots?: boolean }} pr
 * @returns {GateResult}
 */
export function evaluate({ body, labels = [], files = [], botScreenshots = false }) {
  const labelSet = new Set(labels.map((label) => label.toLowerCase()));
  const closes = findClosedIssues(body);
  const needsScreens = labelSet.has(UI_LABEL) || files.some(isUiFile);

  if (labelSet.has(SKIP_LABEL)) return { skipped: true, ok: true, failures: [], closes, needsScreens };

  /** @type {Failure[]} */
  const failures = [];

  if (closes.length === 0) {
    failures.push({
      rule: "closes",
      message:
        "No linked issue. Add `Closes #<issue number>` to the description (one line per issue if it closes several).",
    });
  }

  const unticked = findUntickedBoxes(body);
  if (unticked.length > 0) {
    failures.push({
      rule: "checkboxes",
      message: `${unticked.length} unticked checkbox${unticked.length === 1 ? "" : "es"}. Finish them, delete ones that don't apply, or move unfinished work to a follow-up issue and link it.`,
      details: unticked.map((text) => text || "(empty item)"),
    });
  }

  if (needsScreens && !labelSet.has(NO_SCREENS_LABEL) && !botScreenshots && !hasImage(body)) {
    failures.push({
      rule: "screenshots",
      message:
        "This PR changes screens (`ui` label, or files in `src/app/`, `src/components/` or `*.css`) but has no screenshots of its latest commit. The Screenshots workflow posts them as a comment and re-runs this gate; if it found no routes, list them under `screenshots:` in the description. Or add desktop 1440 and phone 390 screenshots to the description, or ask a founder for the `no-screens` label if nothing visible changed.",
    });
  }

  return { skipped: false, ok: failures.length === 0, failures, closes, needsScreens };
}

const MAX_DETAILS = 15;

/**
 * @param {string} text
 */
function shorten(text) {
  const oneLine = text.replace(/\s+/g, " ");
  return oneLine.length > 90 ? `${oneLine.slice(0, 89)}…` : oneLine;
}

/**
 * The single comment the gate keeps on a PR.
 * @param {GateResult} result
 * @param {string} [docsUrl] link to docs/PR_GATE.md
 * @returns {string}
 */
export function renderComment(result, docsUrl = "docs/PR_GATE.md") {
  const footer = `_Rules: [docs/PR_GATE.md](${docsUrl}). This comment updates itself when you edit the description._`;
  if (result.skipped) {
    return `${COMMENT_MARKER}\n### PR gate: skipped\n\nThe \`${SKIP_LABEL}\` label is on, so the gate is bypassed.\n\n${footer}`;
  }
  if (result.ok) {
    return `${COMMENT_MARKER}\n### PR gate: passed\n\nLinked issue, every box ticked${result.needsScreens ? ", screenshots included" : ""}.\n\n${footer}`;
  }
  const lines = [COMMENT_MARKER, "### PR gate: not ready to merge", ""];
  for (const failure of result.failures) {
    lines.push(`- **${failure.message}**`);
    const details = failure.details ?? [];
    for (const detail of details.slice(0, MAX_DETAILS)) lines.push(`  - \`[ ]\` ${shorten(detail).replace(/`/g, "'")}`);
    if (details.length > MAX_DETAILS) lines.push(`  - …and ${details.length - MAX_DETAILS} more`);
  }
  lines.push("", footer);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------
// GitHub glue (only runs as a script)

/**
 * @param {string} token
 * @returns {(path: string, init?: { method?: string, body?: unknown }) => Promise<any>}
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
    if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} failed: ${response.status} ${await response.text()}`);
    return response.json();
  };
}

/**
 * @param {(path: string) => Promise<any>} gh
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
 * Check one PR through the GitHub API and keep its single gate comment up to date.
 * @param {{ gh: (path: string, init?: { method?: string, body?: unknown }) => Promise<any>, repo: string, number: string | number, serverUrl?: string, log?: (message: string) => void }} options
 * @returns {Promise<{ result: GateResult, comment: string, action: "created" | "updated" | "unchanged" | "none" | "failed" }>}
 */
export async function runGate({ gh, repo, number, serverUrl = "https://github.com", log = console.warn }) {
  // Read the PR fresh, so a re-run sees the latest description and labels, not the event's copy.
  const pr = await gh(`/repos/${repo}/pulls/${number}`);
  const files = (await paginate(gh, `/repos/${repo}/pulls/${number}/files`)).flatMap(
    (/** @type {{ filename: string, previous_filename?: string }} */ file) =>
      file.previous_filename ? [file.filename, file.previous_filename] : [file.filename],
  );
  // Read comments before deciding: the screenshot bot's comment satisfies the screenshots rule. If they can't be
  // read, carry on without them (the rule then needs an image in the description).
  /** @type {{ id: number, body?: string, user?: { login?: string, type?: string } }[] | null} */
  let comments = null;
  try {
    comments = await paginate(gh, `/repos/${repo}/issues/${number}/comments`);
  } catch (error) {
    log(`::warning::Could not read the PR's comments: ${error instanceof Error ? error.message : error}`);
  }
  const result = evaluate({
    body: pr.body,
    labels: (pr.labels ?? []).map((/** @type {{ name: string }} */ label) => label.name),
    files,
    botScreenshots: Boolean(comments && findScreenshotsComment(comments, pr.head?.sha)),
  });
  const comment = renderComment(result, `${serverUrl}/${repo}/blob/${pr.base?.ref ?? "main"}/docs/PR_GATE.md`);

  /** @type {"created" | "updated" | "unchanged" | "none" | "failed"} */
  let action = "none";
  try {
    if (!comments) throw new Error("the PR's comments couldn't be read");
    const existing = comments.find((c) => c.user?.type === "Bot" && c.body?.startsWith(COMMENT_MARKER));
    if (existing) {
      if (existing.body === comment) {
        action = "unchanged";
      } else {
        await gh(`/repos/${repo}/issues/comments/${existing.id}`, { method: "PATCH", body: { body: comment } });
        action = "updated";
      }
    } else if (!result.ok) {
      // Only start a comment when something is missing; after that, keep updating the same one.
      await gh(`/repos/${repo}/issues/${number}/comments`, { method: "POST", body: { body: comment } });
      action = "created";
    }
  } catch (error) {
    // e.g. a PR from a fork gets a read-only token. The check result still counts.
    log(`::warning::Could not post the PR gate comment: ${error instanceof Error ? error.message : error}`);
    action = "failed";
  }
  return { result, comment, action };
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const number = process.env.PR_NUMBER;
  if (!token || !repo || !number) throw new Error("GITHUB_TOKEN, GITHUB_REPOSITORY and PR_NUMBER must be set.");

  const { result, comment } = await runGate({
    gh: githubClient(token),
    repo,
    number,
    serverUrl: process.env.GITHUB_SERVER_URL,
  });

  console.log(comment.replace(COMMENT_MARKER, "").trim());
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${comment}\n`);
  if (!result.ok) {
    for (const failure of result.failures) console.log(`::error title=PR gate (${failure.rule})::${failure.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
