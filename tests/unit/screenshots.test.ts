import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { evaluate, findScreenshotsComment, SCREENSHOTS_MARKER } from "../../scripts/ci/pr-gate.mjs";
import {
  buildPlan,
  detectRoutes,
  gateRunToRerun,
  imageUrl,
  importsOf,
  logTail,
  MAX_ENTRIES,
  parseScreenshotsList,
  pruneIndex,
  pushImages,
  renderComment,
  renderNoticeComment,
  rerunGate,
  routeForPage,
  upsertComment,
  waitForApp,
} from "../../scripts/ci/screenshots.mjs";

const fence = "```";

describe("parseScreenshotsList", () => {
  it("reads a `screenshots:` list with roles, job statuses and state flags", () => {
    const body = [
      "Closes #12",
      "",
      "screenshots:",
      "- /jobs?state=empty as tradie",
      "- `/jobs/[id]` status=assigned",
      "* /admin as office",
      "1. /",
      "",
      "## How I tested it",
      "- [x] npm test",
    ].join("\n");
    expect(parseScreenshotsList(body)).toEqual({
      found: true,
      entries: [
        { path: "/jobs?state=empty", role: "tradie" },
        { path: "/jobs/[id]", status: "ASSIGNED" },
        { path: "/admin", role: "office" },
        { path: "/" },
      ],
      problems: [],
    });
  });

  it("reads a one-line list and a bold or heading label", () => {
    expect(parseScreenshotsList("Screenshots: /, /jobs?state=error\n- /not-this").entries).toEqual([
      { path: "/" },
      { path: "/jobs?state=error" },
    ]);
    expect(parseScreenshotsList("**Screenshots:**\n- /a").entries).toEqual([{ path: "/a" }]);
    expect(parseScreenshotsList("### screenshots:\n\n- /b as guest").entries).toEqual([{ path: "/b", role: "guest" }]);
  });

  it("isn't fooled by the template's heading, comments or code", () => {
    expect(parseScreenshotsList("## Screenshots\n\n| Mockup | Built |").found).toBe(false);
    expect(parseScreenshotsList("<!-- screenshots:\n- /x -->").found).toBe(false);
    expect(parseScreenshotsList(`${fence}\nscreenshots:\n- /x\n${fence}`).found).toBe(false);
    expect(parseScreenshotsList(null).found).toBe(false);
  });

  it("reports items it can't use and keeps the rest", () => {
    const result = parseScreenshotsList(
      "screenshots:\n- jobs\n- /a as boss\n- /b status=LOST\n- /c please\n- //evil.example\n- /ok",
    );
    expect(result.entries).toEqual([{ path: "/ok" }]);
    expect(result.problems).toHaveLength(5);
    expect(result.problems[0]).toContain("isn't a path");
    expect(result.problems[1]).toContain('unknown role "boss"');
    expect(result.problems[2]).toContain('unknown job status "LOST"');
    expect(result.problems[3]).toContain('"please"');
  });
});

describe("routeForPage", () => {
  it.each([
    ["src/app/page.tsx", "/"],
    ["src/app/jobs/page.tsx", "/jobs"],
    ["src/app/jobs/[id]/book/page.tsx", "/jobs/[id]/book"],
    ["src/app/(marketing)/how-it-works/page.tsx", "/how-it-works"],
    ["src/app/admin/@modal/jobs/page.tsx", "/admin/jobs"],
  ])("%s → %s", (file, route) => expect(routeForPage(file)).toBe(route));

  it.each([
    "src/app/jobs/JobCard.tsx",
    "src/app/_parts/page.tsx",
    "src/app/(.)photo/page.tsx",
    "src/app/api/x/route.ts",
  ])("%s isn't a route", (file) => expect(routeForPage(file)).toBeNull());
});

describe("importsOf", () => {
  it("finds static, side-effect, dynamic and CSS imports", () => {
    const source = [
      'import { a } from "@/components/A";',
      'import type { B } from "./b";',
      'export { c } from "../c";',
      'import "@/styles/base.css";',
      'const d = await import("./d");',
      '@import url("./e.css");',
    ].join("\n");
    expect(importsOf(source).sort()).toEqual(
      ["../c", "./b", "./d", "./e.css", "@/components/A", "@/styles/base.css"].sort(),
    );
  });
});

describe("detectRoutes", () => {
  const sources = new Map([
    ["src/app/layout.tsx", 'import "@/styles/base.css";\nexport default function L() {}'],
    ["src/app/page.tsx", 'import { Hero } from "./Hero";'],
    ["src/app/Hero.tsx", 'import { Icon } from "@/components/Icon";\nimport styles from "./page.module.css";'],
    ["src/app/page.module.css", ".x {}"],
    ["src/app/jobs/page.tsx", 'import { JobCard } from "@/components/jobs/JobCard";'],
    ["src/app/jobs/[id]/page.tsx", 'import { JobCard } from "@/components/jobs";'],
    ["src/app/jobs/[id]/loading.tsx", "export default function Loading() {}"],
    ["src/app/jobs/[id]/book/page.tsx", "export default function Book() {}"],
    ["src/app/admin/page.tsx", "export default function Admin() {}"],
    ["src/components/Icon.tsx", "export function Icon() {}"],
    ["src/components/jobs/index.ts", 'export { JobCard } from "./JobCard";'],
    ["src/components/jobs/JobCard.tsx", 'import { Icon } from "../Icon";\nimport { money } from "@/lib/money";'],
    ["src/lib/money.ts", "export const money = 1;"],
    ["src/styles/base.css", "body {}"],
  ]);

  it("finds a changed page", () => {
    expect(detectRoutes(["src/app/admin/page.tsx"], sources)).toEqual(["/admin"]);
  });

  it("follows a changed component to every page that uses it, directly or through other files", () => {
    expect(detectRoutes(["src/components/jobs/JobCard.tsx"], sources)).toEqual(["/jobs", "/jobs/[id]"]);
    expect(detectRoutes(["src/components/Icon.tsx"], sources)).toEqual(["/", "/jobs", "/jobs/[id]"]);
    expect(detectRoutes(["src/lib/money.ts"], sources)).toEqual(["/jobs", "/jobs/[id]"]);
  });

  it("follows a colocated file or CSS module to its page", () => {
    expect(detectRoutes(["src/app/page.module.css"], sources)).toEqual(["/"]);
  });

  it("counts a layout or loading file for every page under it", () => {
    expect(detectRoutes(["src/app/jobs/[id]/loading.tsx"], sources)).toEqual(["/jobs/[id]", "/jobs/[id]/book"]);
    expect(detectRoutes(["src/styles/base.css"], sources)).toEqual([
      "/",
      "/admin",
      "/jobs",
      "/jobs/[id]",
      "/jobs/[id]/book",
    ]);
  });

  it("finds nothing for deleted or non-UI files", () => {
    expect(detectRoutes(["src/app/old/page.tsx", "README.md", "src/server/db.ts"], sources)).toEqual([]);
  });
});

describe("buildPlan", () => {
  const sources = new Map([["src/app/page.tsx", "export default function Home() {}"]]);

  it("skips a PR with no screen changes", () => {
    expect(buildPlan({ changed: ["README.md", "src/server/db.ts"], sources })).toMatchObject({
      capture: false,
      source: "none",
    });
  });

  it("uses the changed files' routes", () => {
    expect(buildPlan({ changed: ["src/app/page.tsx"], sources })).toMatchObject({
      capture: true,
      source: "files",
      entries: [{ path: "/" }],
    });
  });

  it("prefers the description's `screenshots:` list", () => {
    const plan = buildPlan({ changed: ["src/app/page.tsx"], body: "screenshots:\n- /jobs as tradie", sources });
    expect(plan).toMatchObject({ source: "description", entries: [{ path: "/jobs", role: "tradie" }] });
  });

  it("runs for a `ui` label, but captures nothing when no route can be found", () => {
    expect(buildPlan({ changed: ["README.md"], labels: ["UI"], sources })).toMatchObject({
      capture: false,
      source: "files",
      entries: [],
    });
  });

  it("shoots the home page when only the screenshot tooling changed, so it proves itself", () => {
    expect(buildPlan({ changed: [".github/workflows/screenshots.yml"], sources })).toMatchObject({
      capture: true,
      source: "tooling",
      entries: [{ path: "/" }],
    });
  });

  it(`stops at ${MAX_ENTRIES} routes and lists the rest`, () => {
    const body = `screenshots:\n${Array.from({ length: MAX_ENTRIES + 3 }, (_, i) => `- /p${i}`).join("\n")}\n- /p0`;
    const plan = buildPlan({ changed: ["src/app/page.tsx"], body, sources });
    expect(plan.entries).toHaveLength(MAX_ENTRIES);
    expect(plan.omitted).toEqual([`/p${MAX_ENTRIES}`, `/p${MAX_ENTRIES + 1}`, `/p${MAX_ENTRIES + 2}`]);
  });
});

describe("renderComment", () => {
  const where = { serverUrl: "https://github.com", repo: "o/r", pr: 7, sha: "abc1234def" };
  const plan = buildPlan({ changed: ["src/app/page.tsx"], sources: new Map([["src/app/page.tsx", ""]]) });
  const results = [
    {
      id: "jobs-tradie",
      label: "/jobs · tradie",
      url: "/jobs",
      files: { "1440": "jobs-tradie-1440.png", "390": "jobs-tradie-390.png" },
      notes: ["HTTP 404"],
    },
    { id: "home", label: "/ · signed out", url: "/", files: { "1440": "home-1440.png", "390": "home-390.png" } },
  ];

  it("posts one table: route · 1440 · 390, sorted, with the commit's marker", () => {
    const comment = renderComment({ plan, results, where, runUrl: "https://run" });
    const lines = comment.split("\n");
    expect(lines[0]).toBe(SCREENSHOTS_MARKER);
    expect(lines[1]).toBe("<!-- pr-screenshots-sha: abc1234def -->");
    expect(comment).toContain("| Route | 1440 | 390 |");
    const rows = lines.filter((line) => line.startsWith("| `"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(
      /^\| `\/ · signed out` \| <a href="https:\/\/github\.com\/o\/r\/blob\/pr-screenshots\/pr-7\/abc1234def\/home-1440\.png\?raw=true">/,
    );
    expect(rows[1]).toContain("<br>HTTP 404");
    expect(comment).toContain("[run's artifacts](https://run)");
    expect(comment).toContain("kept 7 days");
  });

  it("lists skipped, over-the-limit and badly written routes", () => {
    const comment = renderComment({
      plan: { ...plan, omitted: ["/p12"], problems: ["`jobs` isn't a path"] },
      results,
      skipped: [{ label: "/help/[slug] · signed out", reason: "needs a real value" }],
      where,
    });
    expect(comment).toContain("<summary>Not shot</summary>");
    expect(comment).toContain("- `/help/[slug] · signed out`: needs a real value");
    expect(comment).toContain("- `/p12`: not shot, over the limit");
    expect(comment).toContain("- `jobs` isn't a path");
  });

  it("satisfies the PR gate for that commit only", () => {
    const comment = {
      body: renderComment({ plan, results, where }),
      user: { login: "github-actions[bot]", type: "Bot" },
    };
    expect(findScreenshotsComment([comment], "abc1234def")).toBe(comment);
    expect(findScreenshotsComment([comment], "newer-commit")).toBeUndefined();
    expect(evaluate({ body: "Closes #1", labels: ["ui"], botScreenshots: true }).ok).toBe(true);
  });

  it("makes blob ?raw=true image links (they render in a private repo)", () => {
    expect(imageUrl(where, "a b.png")).toBe(
      "https://github.com/o/r/blob/pr-screenshots/pr-7/abc1234def/a%20b.png?raw=true",
    );
  });
});

describe("renderNoticeComment", () => {
  it("has the marker but no images, so a failure never passes the gate", () => {
    const body = renderNoticeComment({
      sha: "abc1234",
      title: "failed",
      text: "The app didn't start.",
      runUrl: "https://run",
    });
    expect(body.startsWith(SCREENSHOTS_MARKER)).toBe(true);
    expect(body).toContain("[Open the run](https://run)");
    expect(
      findScreenshotsComment([{ body, user: { login: "github-actions[bot]", type: "Bot" } }], "abc1234"),
    ).toBeUndefined();
  });
});

describe("what if the app fails to start?", () => {
  const clock = () => {
    let time = 0;
    return { now: () => time, sleep: async (ms: number) => void (time += ms) };
  };

  it("waits until the app answers", async () => {
    let calls = 0;
    const result = await waitForApp({
      url: "http://x/",
      isRunning: () => true,
      fetchImpl: async () => {
        calls++;
        if (calls < 3) throw new Error("ECONNREFUSED");
        return { status: 200 };
      },
      ...clock(),
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it("fails straight away when the server process stops", async () => {
    const result = await waitForApp({
      url: "http://x/",
      isRunning: () => false,
      fetchImpl: async () => ({ status: 200 }),
      ...clock(),
    });
    expect(result).toEqual({ ok: false, reason: "The app stopped before it started answering." });
  });

  it("fails after the timeout when it never answers, or only answers with server errors", async () => {
    const result = await waitForApp({
      url: "http://x/",
      isRunning: () => true,
      timeoutMs: 5000,
      fetchImpl: async () => ({ status: 500 }),
      ...clock(),
    });
    expect(result).toEqual({ ok: false, reason: "The app didn't answer at http://x/ within 5 seconds." });
  });

  it("shows the end of the server log", () => {
    const log = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const tail = logTail(log, 3).split("\n");
    expect(tail).toEqual(["…", "line 97", "line 98", "line 99"]);
    expect(logTail("short\n")).toBe("short");
  });
});

describe("publishing", () => {
  it("replaces this PR's folder and drops folders older than 7 days", () => {
    const now = new Date("2026-10-26T00:00:00Z");
    const { keep, index } = pruneIndex(
      { "pr-1": "2026-10-25T00:00:00Z", "pr-2": "2026-10-10T00:00:00Z", "pr-7": "2026-10-25T00:00:00Z", junk: "x" },
      "pr-7",
      now,
    );
    expect(keep).toEqual(["pr-1"]);
    expect(index).toEqual({ "pr-1": "2026-10-25T00:00:00Z", "pr-7": now.toISOString() });
  });

  it("re-runs the PR gate only when its latest run for the commit failed", () => {
    const run = (id: number, status: string, conclusion: string | null, created: string) => ({
      id,
      status,
      conclusion,
      created_at: created,
    });
    expect(gateRunToRerun([])).toEqual({ action: "none" });
    expect(gateRunToRerun([run(1, "completed", "success", "2026-10-26T01:00:00Z")])).toEqual({ action: "none" });
    expect(
      gateRunToRerun([
        run(1, "completed", "success", "2026-10-26T01:00:00Z"),
        run(2, "completed", "failure", "2026-10-26T02:00:00Z"),
      ]),
    ).toEqual({ action: "rerun", id: 2 });
    expect(gateRunToRerun([run(3, "in_progress", null, "2026-10-26T03:00:00Z")])).toEqual({ action: "wait" });
  });

  it("waits for a gate run in progress, then re-runs it", async () => {
    const responses = [
      { workflow_runs: [{ id: 9, status: "in_progress", conclusion: null, created_at: "2026-10-26T00:00:00Z" }] },
      { workflow_runs: [{ id: 9, status: "completed", conclusion: "failure", created_at: "2026-10-26T00:00:00Z" }] },
    ];
    const calls: string[] = [];
    const gh = async (path: string, init: { method?: string } = {}) => {
      calls.push(`${init.method ?? "GET"} ${path}`);
      return init.method === "POST" ? {} : responses.shift();
    };
    expect(await rerunGate({ gh, repo: "o/r", sha: "abc", log: () => {}, sleep: async () => {} })).toBe("rerun");
    expect(calls.at(-1)).toBe("POST /repos/o/r/actions/runs/9/rerun");
    expect(calls[0]).toContain("/actions/workflows/pr-gate.yml/runs?head_sha=abc");
  });

  it("keeps ONE comment: creates it, then edits the bot's own", async () => {
    const writes: { method: string; path: string }[] = [];
    const fake =
      (comments: unknown[]) =>
      async (path: string, init: { method?: string } = {}) => {
        if (init.method) {
          writes.push({ method: init.method, path });
          return {};
        }
        return path.endsWith("page=1") ? comments : [];
      };
    expect(await upsertComment({ gh: fake([]), repo: "o/r", pr: 7, body: `${SCREENSHOTS_MARKER}\nnew` })).toBe(
      "created",
    );
    const comments = [
      { id: 1, body: `${SCREENSHOTS_MARKER}\nquoted by a person`, user: { type: "User" } },
      { id: 2, body: `${SCREENSHOTS_MARKER}\nold`, user: { type: "Bot" } },
    ];
    expect(await upsertComment({ gh: fake(comments), repo: "o/r", pr: 7, body: `${SCREENSHOTS_MARKER}\nnew` })).toBe(
      "updated",
    );
    expect(await upsertComment({ gh: fake(comments), repo: "o/r", pr: 7, body: `${SCREENSHOTS_MARKER}\nold` })).toBe(
      "unchanged",
    );
    expect(writes).toEqual([
      { method: "POST", path: "/repos/o/r/issues/7/comments" },
      { method: "PATCH", path: "/repos/o/r/issues/comments/2" },
    ]);
  });
});

describe("screenshots workflow", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/screenshots.yml", import.meta.url), "utf8");

  it("keeps images 7 days and shoots with a time limit", () => {
    expect(workflow.match(/retention-days: 7/g)).toHaveLength(2);
    expect(workflow).toMatch(/timeout-minutes: 10/);
  });

  it("only gives the publish job a token that can write, and never uses pull_request_target", () => {
    expect(workflow).toMatch(/^permissions: \{\}$/m);
    expect(workflow).toMatch(/capture:[\s\S]*?permissions:\n\s+contents: read\n\s+outputs:/);
    expect(workflow).not.toMatch(/pull_request_target/);
    expect(workflow).toMatch(/persist-credentials: false/);
  });

  it("never points the app at a real Supabase project", () => {
    expect(workflow).toContain("NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321");
    expect(workflow).not.toMatch(/secrets\./);
    expect(workflow).not.toMatch(/supabase\.co/);
  });
});

describe("pushImages (against a throwaway git remote)", () => {
  // Real git, no network: a bare repo stands in for GitHub.
  const sh = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();

  function setup() {
    const root = mkdtempSync(join(tmpdir(), "screenshots-push-"));
    const origin = join(root, "origin.git");
    const work = join(root, "work");
    sh(root, "init", "--quiet", "--bare", origin);
    sh(root, "init", "--quiet", work);
    sh(work, "remote", "add", "origin", origin);
    const images = join(root, "images");
    mkdirSync(images);
    writeFileSync(join(images, "home-1440.png"), "fake png 1440");
    writeFileSync(join(images, "home-390.png"), "fake png 390");
    const files = ["home-1440.png", "home-390.png"];
    const tree = () => sh(origin, "ls-tree", "-r", "--name-only", "pr-screenshots").split("\n");
    return { root, origin, work, images, files, tree };
  }

  it("creates the branch, keeps other PRs' folders, replaces this PR's, and keeps no history", () => {
    const { work, images, files, tree, origin, root } = setup();
    const at = (day: string) => () => new Date(`2026-10-${day}T00:00:00Z`);
    const quiet = () => {};
    pushImages({ dir: images, folder: "pr-1/aaa", files, cwd: work, now: at("20"), log: quiet });
    pushImages({ dir: images, folder: "pr-2/bbb", files, cwd: work, now: at("21"), log: quiet });
    pushImages({ dir: images, folder: "pr-1/ccc", files, cwd: work, now: at("22"), log: quiet });
    expect(tree()).toEqual([
      "README.md",
      "index.json",
      "pr-1/ccc/home-1440.png",
      "pr-1/ccc/home-390.png",
      "pr-2/bbb/home-1440.png",
      "pr-2/bbb/home-390.png",
    ]);
    expect(sh(origin, "rev-list", "--count", "pr-screenshots")).toBe("1");
    expect(sh(origin, "log", "-1", "--format=%an", "pr-screenshots")).toBe("github-actions[bot]");

    // A week after PR 2's last run, its folder goes.
    pushImages({ dir: images, folder: "pr-3/ddd", files, cwd: work, now: at("29"), log: quiet });
    expect(tree().filter((path) => path.startsWith("pr-"))).toEqual([
      "pr-1/ccc/home-1440.png",
      "pr-1/ccc/home-390.png",
      "pr-3/ddd/home-1440.png",
      "pr-3/ddd/home-390.png",
    ]);
    expect(JSON.parse(sh(origin, "show", "pr-screenshots:index.json"))).toEqual({
      "pr-1": "2026-10-22T00:00:00.000Z",
      "pr-3": "2026-10-29T00:00:00.000Z",
    });
    rmSync(root, { recursive: true, force: true });
  });

  it("starts again when another run moved the branch meanwhile, so neither PR's folder is lost", () => {
    const { work, images, files, tree, root } = setup();
    const quiet = () => {};
    pushImages({ dir: images, folder: "pr-1/aaa", files, cwd: work, log: quiet });
    const other = join(root, "other");
    sh(root, "clone", "--quiet", join(root, "origin.git"), other);
    const logs: string[] = [];
    pushImages({
      dir: images,
      folder: "pr-3/ccc",
      files,
      cwd: work,
      log: (m) => logs.push(m),
      // Another runner publishes PR 2 after this one read the branch but before it pushed.
      beforePush: (attempt) => {
        if (attempt === 1) pushImages({ dir: images, folder: "pr-2/bbb", files, cwd: other, log: quiet });
      },
    });
    expect(logs.some((m) => m.includes("moved while publishing (attempt 1)"))).toBe(true);
    expect(tree().filter((path) => path.endsWith("1440.png"))).toEqual([
      "pr-1/aaa/home-1440.png",
      "pr-2/bbb/home-1440.png",
      "pr-3/ccc/home-1440.png",
    ]);
    rmSync(root, { recursive: true, force: true });
  });
});
