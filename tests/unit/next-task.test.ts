import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  areaLabel,
  claimedIssues,
  fetchAllPages,
  findNextTasks,
  formatTasks,
  isClaimComment,
  issuesClosedBy,
  milestoneRank,
  openBlockerCount,
  parseArgs,
  REPO,
  selectTasks,
} from "../../scripts/next-task.mjs";

type Issue = Parameters<typeof selectTasks>[0][number];

const root = new URL("../../", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), "utf8");
const fixture = (): Issue[] => JSON.parse(read("tests/fixtures/next-task/issues.json"));
const numbers = (tasks: { number: number }[]) => tasks.map((t) => t.number);

/**
 * A fake `gh api`: answers from a map of paths (without per_page/page) to items, serving them 100 per page like
 * GitHub does, and records every call.
 */
function fakeGh(routes: Record<string, unknown[]>) {
  const calls: string[] = [];
  const gh = (args: string[]) => {
    expect(args).toHaveLength(1);
    const url = new URL(args[0], "https://api.invalid/");
    calls.push(args[0]);
    const page = Number(url.searchParams.get("page") ?? 1);
    const perPage = Number(url.searchParams.get("per_page") ?? 30);
    url.searchParams.delete("page");
    url.searchParams.delete("per_page");
    const key = `${url.pathname.slice(1)}${url.search}`;
    if (!(key in routes)) throw new Error(`unexpected gh api call: ${args[0]}`);
    return routes[key].slice((page - 1) * perPage, page * perPage);
  };
  return { gh, calls };
}

describe("selectTasks: which open issues can be picked up", () => {
  it("lists unassigned, unblocked tasks by milestone, then P1 → P3, then oldest first", () => {
    expect(numbers(selectTasks(fixture()))).toEqual([104, 103, 102, 105, 101, 107, 106]);
  });

  it("shows number, title, milestone, priority and size", () => {
    expect(selectTasks(fixture())[0]).toEqual({
      number: 104,
      title: "Tokens in the app",
      milestone: "0 · Foundations",
      priority: "P1",
      size: "M",
    });
  });

  it("leaves out epics, features, decisions, ideas and human-only issues", () => {
    const shown = numbers(selectTasks(fixture()));
    for (const n of [203, 204, 205, 206, 207]) expect(shown).not.toContain(n);
  });

  it("leaves out pull requests (the issues API returns them too)", () => {
    expect(numbers(selectTasks(fixture()))).not.toContain(208);
  });

  it("leaves out assigned issues", () => {
    expect(numbers(selectTasks(fixture()))).not.toContain(202);
    const assigneeOnly = { ...fixture()[1], assignees: undefined, assignee: { login: "someone" } };
    expect(selectTasks([assigneeOnly])).toEqual([]);
  });

  it("leaves out issues with an open blocker, but keeps ones whose blockers are all closed", () => {
    const shown = numbers(selectTasks(fixture()));
    expect(shown).not.toContain(201); // blocked_by: 1
    expect(shown).toContain(101); // blocked_by: 0 although total_blocked_by: 2
  });

  it("leaves out issues already taken by a 'Taking this' comment or an open PR", () => {
    expect(numbers(selectTasks(fixture(), { claimed: new Set([104, 102]) }))).toEqual([103, 105, 101, 107, 106]);
  });

  it("can use another source for blocker counts", () => {
    const blockedBy = (i: Issue) => (i.number === 104 ? 1 : 0);
    const shown = numbers(selectTasks(fixture(), { blockedBy }));
    expect(shown).not.toContain(104);
    expect(shown).toContain(201); // its summary says blocked, but the given source says not
  });

  it("sorts by the build-order number in the milestone title, not the milestone's id", () => {
    expect(milestoneRank({ number: 9, title: "1 · Core job flow" })).toBe(1);
    expect(milestoneRank({ number: 7, title: "Someday" })).toBe(7);
    expect(milestoneRank(null)).toBe(Number.POSITIVE_INFINITY);
  });

  it("puts issues without a priority after P3, and without a milestone last", () => {
    const tasks = selectTasks(fixture());
    expect(tasks.at(-2)).toMatchObject({ number: 107, priority: "", milestone: "3 · Launch: Invercargill" });
    expect(tasks.at(-1)).toMatchObject({ number: 106, priority: "", size: "", milestone: "" });
  });

  it("--limit keeps only the first N", () => {
    expect(numbers(selectTasks(fixture(), { limit: 2 }))).toEqual([104, 103]);
  });

  it("--area keeps only that area, written either way", () => {
    expect(numbers(selectTasks(fixture(), { area: "customer" }))).toEqual([102, 101]);
    expect(numbers(selectTasks(fixture(), { area: "area:customer" }))).toEqual([102, 101]);
    expect(numbers(selectTasks(fixture(), { area: "Design-System" }))).toEqual([104]);
    expect(selectTasks(fixture(), { area: "nowhere" })).toEqual([]);
  });

  it("combines --area and --limit", () => {
    expect(numbers(selectTasks(fixture(), { area: "customer", limit: 1 }))).toEqual([102]);
  });

  it("accepts labels as plain strings too", () => {
    const issue = { ...fixture()[1], labels: ["P1", "size:S", "area:customer"] };
    expect(selectTasks([issue])[0]).toMatchObject({ priority: "P1", size: "S" });
  });
});

describe("formatTasks", () => {
  it("prints an aligned table with a header", () => {
    const lines = formatTasks(selectTasks(fixture(), { limit: 2 }));
    expect(lines).toEqual([
      "Issue  Pri  Size  Milestone        Title",
      "#104   P1   M     0 · Foundations  Tokens in the app",
      "#103   P3   S     0 · Foundations  Scaffold follow-up",
    ]);
  });

  it("shows a dash for a missing priority, size or milestone", () => {
    const [, row] = formatTasks(selectTasks(fixture()).filter((t) => t.number === 106));
    expect(row).toBe("#106   -    -     -          Untriaged task with no labels or milestone");
  });

  it("says so when there is nothing to pick up", () => {
    expect(formatTasks([])).toEqual([
      "Nothing to pick up right now: every open task is taken, blocked or excluded.",
    ]);
  });
});

describe("parseArgs", () => {
  it("defaults to every task in this repo", () => {
    expect(parseArgs([])).toEqual({ repo: REPO, help: false });
  });

  it("reads --limit and --area in both spellings", () => {
    expect(parseArgs(["--limit", "5", "--area", "tradie"])).toMatchObject({ limit: 5, area: "tradie" });
    expect(parseArgs(["--limit=3", "--area=area:office"])).toMatchObject({ limit: 3, area: "area:office" });
    expect(parseArgs(["-n", "2"])).toMatchObject({ limit: 2 });
    expect(parseArgs(["--repo", "someone/else"])).toMatchObject({ repo: "someone/else" });
    expect(parseArgs(["--help"]).help).toBe(true);
  });

  it("rejects a limit that isn't a whole number above 0", () => {
    for (const bad of ["0", "-1", "2.5", "five"]) expect(() => parseArgs(["--limit", bad])).toThrow(/--limit/);
  });

  it("rejects a flag with no value, and unknown flags", () => {
    expect(() => parseArgs(["--area"])).toThrow("--area needs a value");
    expect(() => parseArgs(["--limit="])).toThrow("--limit needs a value");
    expect(() => parseArgs(["--milestone", "1"])).toThrow(/Unknown option "--milestone"/);
  });

  it("normalises area names to their label", () => {
    expect(areaLabel(" Customer ")).toBe("area:customer");
    expect(areaLabel("area:setup")).toBe("area:setup");
  });
});

describe("claims", () => {
  it("recognises the AGENTS.md claim comment", () => {
    expect(isClaimComment("Taking this — Claude Code agent (Claude Opus 5.5)")).toBe(true);
    expect(isClaimComment("  taking this - Codex")).toBe(true);
    expect(isClaimComment("Is anyone taking this?")).toBe(false);
    expect(isClaimComment("**Update:** write this as a Prisma migration")).toBe(false);
  });

  it("finds the issues a PR closes", () => {
    expect(issuesClosedBy("Closes #71\n\nAlso fixes #12 and resolves: #9. See #5.")).toEqual([71, 12, 9]);
    expect(issuesClosedBy("Related to #3")).toEqual([]);
    expect(issuesClosedBy("")).toEqual([]);
  });
});

describe("talking to GitHub (fake gh)", () => {
  it("fetches every page with page=N, stopping at the first short page", () => {
    const items = Array.from({ length: 230 }, (_, i) => ({ number: i + 1 }));
    const { gh, calls } = fakeGh({ "repos/o/r/issues?state=open": items });
    expect(fetchAllPages(gh, "repos/o/r/issues?state=open")).toHaveLength(230);
    expect(calls).toEqual([
      "repos/o/r/issues?state=open&per_page=100&page=1",
      "repos/o/r/issues?state=open&per_page=100&page=2",
      "repos/o/r/issues?state=open&per_page=100&page=3",
    ]);
  });

  it("asks for one more page when a page is exactly full", () => {
    const { gh, calls } = fakeGh({ "repos/o/r/pulls?state=open": Array.from({ length: 100 }, () => ({})) });
    expect(fetchAllPages(gh, "repos/o/r/pulls?state=open")).toHaveLength(100);
    expect(calls).toHaveLength(2);
  });

  it("uses issue_dependencies_summary.blocked_by when the API includes it", () => {
    const { gh, calls } = fakeGh({});
    expect(openBlockerCount(gh, "o/r", fixture()[0])).toBe(0);
    expect(openBlockerCount(gh, "o/r", fixture()[7])).toBe(1);
    expect(calls).toEqual([]);
  });

  it("falls back to the blocked_by endpoint when the summary is missing, counting only open blockers", () => {
    const { gh, calls } = fakeGh({
      "repos/o/r/issues/5/dependencies/blocked_by": [
        { number: 1, state: "closed" },
        { number: 2, state: "open" },
      ],
      "repos/o/r/issues/6/dependencies/blocked_by": [{ number: 1, state: "closed" }],
    });
    const base = { ...fixture()[1], issue_dependencies_summary: undefined };
    expect(openBlockerCount(gh, "o/r", { ...base, number: 5 })).toBe(1);
    expect(openBlockerCount(gh, "o/r", { ...base, number: 6 })).toBe(0);
    expect(calls[0]).toBe("repos/o/r/issues/5/dependencies/blocked_by?per_page=100&page=1");
  });

  it("only reads comments on ready issues that have comments", () => {
    const issues = fixture();
    const { gh, calls } = fakeGh({
      "repos/o/r/pulls?state=open": [{ body: "Closes #102" }, { body: null }],
      "repos/o/r/issues/104/comments": [{ body: "Taking this — Codex (GPT-5)" }],
    });
    const claimed = claimedIssues(gh, "o/r", issues.filter((i) => [102, 103, 104].includes(i.number)));
    expect([...claimed].sort()).toEqual([102, 104]);
    expect(calls.filter((c) => c.includes("/comments"))).toEqual(["repos/o/r/issues/104/comments?per_page=100&page=1"]);
  });

  it("puts it all together", () => {
    const { gh } = fakeGh({
      "repos/o/r/issues?state=open": fixture(),
      "repos/o/r/pulls?state=open": [{ body: "Closes #103" }],
      "repos/o/r/issues/104/comments": [{ body: "Looks good" }],
    });
    const tasks = findNextTasks(gh, { repo: "o/r", help: false, limit: 3 });
    expect(numbers(tasks)).toEqual([104, 102, 105]);
  });
});

describe("docs point at it", () => {
  it("is an npm script", () => {
    expect(JSON.parse(read("package.json")).scripts["next-task"]).toBe("node scripts/next-task.mjs");
  });

  it("is linked from AGENTS.md section 1 and docs/PLANNING.md", () => {
    const section1 = read("AGENTS.md").split("## 2.")[0];
    expect(section1).toContain("npm run next-task");
    expect(read("docs/PLANNING.md")).toContain("npm run next-task");
  });
});
