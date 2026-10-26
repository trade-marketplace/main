import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  COMMENT_MARKER,
  evaluate,
  findClosedIssues,
  findUntickedBoxes,
  hasImage,
  isUiFile,
  renderComment,
  runGate,
  visibleText,
} from "../../scripts/ci/pr-gate.mjs";

const fence = "```";
const goodBody = ["Closes #69", "", "## Acceptance criteria", "- [x] Fails with a clear comment", "- [X] Passes"].join(
  "\n",
);

describe("findClosedIssues", () => {
  it("finds Closes/Fixes/Resolves in any case, with or without a colon", () => {
    expect(findClosedIssues("Closes #1\nfixes #2\nRESOLVED #3\nClose: #4\nfixed #5\nresolve #6")).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });

  it("accepts several issues and ignores duplicates", () => {
    expect(findClosedIssues("Closes #12, closes #13 and fixes #12")).toEqual([12, 13]);
  });

  it("accepts owner/repo#n and full issue URLs", () => {
    expect(findClosedIssues("Closes trade-marketplace/main#7")).toEqual([7]);
    expect(findClosedIssues("Fixes https://github.com/trade-marketplace/main/issues/8")).toEqual([8]);
  });

  it('fails "Closes #" with no number, a placeholder or #0', () => {
    expect(findClosedIssues("Closes #")).toEqual([]);
    expect(findClosedIssues("Closes #\n\n## What changed")).toEqual([]);
    expect(findClosedIssues("Closes #<issue>")).toEqual([]);
    expect(findClosedIssues("Closes #0")).toEqual([]);
    expect(findClosedIssues("Closes #12abc")).toEqual([]);
  });

  it("needs a closing keyword, not just an issue number", () => {
    expect(findClosedIssues("Related to #5, see #6")).toEqual([]);
    expect(findClosedIssues("prefixes #5 and unfixed #6")).toEqual([]);
    expect(findClosedIssues("Closes#5")).toEqual([]);
  });

  it("ignores references in HTML comments and code", () => {
    expect(findClosedIssues("<!-- Closes #5 -->")).toEqual([]);
    expect(findClosedIssues(`${fence}\nCloses #5\n${fence}`)).toEqual([]);
    expect(findClosedIssues("Write `Closes #5` in the description")).toEqual([]);
  });

  it("handles a missing description", () => {
    expect(findClosedIssues(null)).toEqual([]);
    expect(findClosedIssues(undefined)).toEqual([]);
  });
});

describe("findUntickedBoxes", () => {
  it("finds unticked boxes with every list marker", () => {
    expect(findUntickedBoxes("- [ ] a\n* [ ] b\n+ [ ] c\n1. [ ] d\n2) [ ] e")).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("treats [x] and [X] as ticked", () => {
    expect(findUntickedBoxes("- [x] done\n- [X] also done")).toEqual([]);
  });

  it("finds nested boxes and boxes inside quotes", () => {
    expect(findUntickedBoxes("- [x] parent\n  - [ ] child\n> - [ ] quoted")).toEqual(["child", "quoted"]);
  });

  it("counts an empty unticked box", () => {
    expect(findUntickedBoxes("- [ ]")).toEqual([""]);
  });

  it("ignores boxes inside fenced code blocks (``` and ~~~, indented, unclosed)", () => {
    expect(findUntickedBoxes(`${fence}md\n- [ ] example\n${fence}\n- [x] real`)).toEqual([]);
    expect(findUntickedBoxes("~~~\n- [ ] example\n~~~")).toEqual([]);
    expect(findUntickedBoxes(`- [x] item\n  ${fence}\n  - [ ] example\n  ${fence}`)).toEqual([]);
    expect(findUntickedBoxes(`${fence}\n- [ ] never closed`)).toEqual([]);
    // A shorter fence doesn't close a longer one.
    expect(findUntickedBoxes("````\n```\n- [ ] still code\n````\n- [ ] real")).toEqual(["real"]);
  });

  it("ignores boxes inside HTML comments, including multi-line and unclosed ones", () => {
    expect(findUntickedBoxes("<!-- - [ ] hidden -->")).toEqual([]);
    expect(findUntickedBoxes("<!--\n- [ ] hidden\n-->\n- [ ] shown")).toEqual(["shown"]);
    expect(findUntickedBoxes("- [x] ok\n<!-- left open\n- [ ] hidden")).toEqual([]);
  });

  it("ignores box-like text that isn't a task list item", () => {
    expect(findUntickedBoxes("Use `- [ ]` for a box\nsome [ ] text\n-[ ] no space\n- [] no box")).toEqual([]);
  });

  it("handles Windows line endings from the GitHub editor", () => {
    expect(findUntickedBoxes("- [x] a\r\n- [ ] b\r\n")).toEqual(["b"]);
    expect(findClosedIssues("Closes #3\r\n")).toEqual([3]);
  });
});

describe("hasImage", () => {
  it("accepts Markdown and HTML images", () => {
    expect(hasImage("![desktop](https://example.com/shot)")).toBe(true);
    expect(hasImage("![phone][1]\n\n[1]: https://example.com/a")).toBe(true);
    expect(hasImage('<img width="390" alt="phone" src="https://example.com/a.png">')).toBe(true);
  });

  it("accepts a link to an image file or a GitHub upload", () => {
    expect(hasImage("[desktop](https://example.com/shots/home-1440.PNG)")).toBe(true);
    expect(hasImage("See https://example.com/a.webp?raw=1")).toBe(true);
    expect(hasImage("https://github.com/user-attachments/assets/0b6c2f6e-1a2b-4c3d-9e8f-123456789abc")).toBe(true);
  });

  it("rejects descriptions without images", () => {
    expect(hasImage("No screenshots here. See https://example.com/page")).toBe(false);
    expect(hasImage("![missing]()")).toBe(false);
    expect(hasImage("<img alt='no src'>")).toBe(false);
    expect(hasImage("| Mockup | Built |\n|---|---|\n|  |  |")).toBe(false);
    expect(hasImage(null)).toBe(false);
  });

  it("ignores images in HTML comments and code", () => {
    expect(hasImage("<!-- ![shot](https://example.com/a.png) -->")).toBe(false);
    expect(hasImage(`${fence}\n<img src="a.png">\n${fence}`)).toBe(false);
  });
});

describe("isUiFile", () => {
  it.each(["src/app/page.tsx", "src/app/(customer)/jobs/page.tsx", "src/components/Button.tsx", "src/styles/brand.css", "docs/design/tokens.css"])(
    "%s is a UI file",
    (path) => expect(isUiFile(path)).toBe(true),
  );

  it.each(["src/server/db.ts", "src/lib/format.ts", "README.md", "src/appendix.ts", "tests/unit/a.test.ts"])(
    "%s is not a UI file",
    (path) => expect(isUiFile(path)).toBe(false),
  );
});

describe("evaluate", () => {
  it("passes when the issue is linked and every box is ticked", () => {
    const result = evaluate({ body: goodBody, labels: [], files: ["scripts/ci/pr-gate.mjs"] });
    expect(result).toMatchObject({ ok: true, skipped: false, failures: [], closes: [69], needsScreens: false });
  });

  it("reports every missing item at once", () => {
    const result = evaluate({ body: "Closes #\n\n- [ ] Tests\n- [x] Lint", labels: ["ui"], files: [] });
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.rule)).toEqual(["closes", "checkboxes", "screenshots"]);
    expect(result.failures[1].details).toEqual(["Tests"]);
  });

  it("fails an empty description", () => {
    expect(evaluate({ body: null }).failures.map((f) => f.rule)).toEqual(["closes"]);
  });

  it("fails the unchanged PR template", () => {
    const template = readFileSync(new URL("../../.github/pull_request_template.md", import.meta.url), "utf8");
    const rules = evaluate({ body: template, files: ["src/app/page.tsx"] }).failures.map((f) => f.rule);
    expect(rules).toEqual(["closes", "checkboxes", "screenshots"]);
  });

  it("still fails boxes left unticked on purpose, even with an explanation", () => {
    const body = `${goodBody}\n- [ ] Screenshots (not done: no browser available, see below)`;
    expect(evaluate({ body }).failures.map((f) => f.rule)).toEqual(["checkboxes"]);
  });

  it("passes once the unfinished item moves to a follow-up issue", () => {
    const body = `${goodBody}\n\nFollow-up: #120 (screenshots)`;
    expect(evaluate({ body }).ok).toBe(true);
  });

  it("needs screenshots when the PR is labelled ui", () => {
    expect(evaluate({ body: goodBody, labels: ["ui"] }).failures.map((f) => f.rule)).toEqual(["screenshots"]);
    expect(evaluate({ body: goodBody, labels: ["UI"] }).needsScreens).toBe(true);
  });

  it("needs screenshots when the PR touches src/app, src/components or CSS", () => {
    for (const file of ["src/app/layout.tsx", "src/components/Card.tsx", "src/styles/brand.css"]) {
      expect(evaluate({ body: goodBody, files: ["README.md", file] }).failures.map((f) => f.rule)).toEqual([
        "screenshots",
      ]);
    }
  });

  it("passes a UI PR with an image in the description", () => {
    const body = `${goodBody}\n\n| Mockup | Built |\n|---|---|\n| ![m](https://example.com/m.png) | <img src="https://example.com/b.png"> |`;
    expect(evaluate({ body, labels: ["ui"], files: ["src/app/page.tsx"] }).ok).toBe(true);
  });

  it("lets the no-screens label stand in for screenshots, but nothing else", () => {
    expect(evaluate({ body: goodBody, labels: ["no-screens"], files: ["src/app/page.tsx"] }).ok).toBe(true);
    const result = evaluate({ body: "- [ ] x", labels: ["no-screens", "ui"] });
    expect(result.failures.map((f) => f.rule)).toEqual(["closes", "checkboxes"]);
  });

  it("is bypassed by the skip-gate label (founders merging anyway)", () => {
    const result = evaluate({ body: "", labels: ["skip-gate"], files: ["src/app/page.tsx"] });
    expect(result).toMatchObject({ ok: true, skipped: true, failures: [] });
  });
});

describe("renderComment", () => {
  it("starts with the marker so the same comment is found and updated on re-runs", () => {
    for (const result of [evaluate({ body: goodBody }), evaluate({ body: "" }), evaluate({ body: "", labels: ["skip-gate"] })]) {
      expect(renderComment(result).startsWith(COMMENT_MARKER)).toBe(true);
    }
  });

  it("lists each missing item and the unticked boxes", () => {
    const comment = renderComment(evaluate({ body: "- [ ] Tests for `x`\n- [ ] Lint", labels: ["ui"] }), "https://x/docs");
    expect(comment).toContain("not ready to merge");
    expect(comment).toContain("No linked issue");
    expect(comment).toContain("2 unticked checkboxes");
    expect(comment).toContain("Tests for 'x'");
    expect(comment).toContain("- `[ ]` Lint");
    expect(comment).toContain("no screenshots");
    expect(comment).toContain("(https://x/docs)");
  });

  it("caps a long list of unticked boxes", () => {
    const body = Array.from({ length: 20 }, (_, i) => `- [ ] item ${i}`).join("\n");
    const comment = renderComment(evaluate({ body }));
    expect(comment).toContain("item 14");
    expect(comment).not.toContain("item 15");
    expect(comment).toContain("…and 5 more");
  });

  it("says when the gate passed or was skipped", () => {
    expect(renderComment(evaluate({ body: goodBody }))).toContain("PR gate: passed");
    expect(renderComment(evaluate({ body: "", labels: ["skip-gate"] }))).toContain("PR gate: skipped");
  });
});

describe("runGate (GitHub API glue)", () => {
  type Call = { path: string; method: string; body?: { body: string } };
  type Comment = { id: number; body: string; user: { type: string } };

  function fakeGitHub(pr: { body: string | null; labels?: string[]; files?: string[] }, comments: Comment[] = []) {
    const calls: Call[] = [];
    const gh = async (path: string, init: { method?: string; body?: unknown } = {}) => {
      const method = init.method ?? "GET";
      calls.push({ path, method, body: init.body as Call["body"] });
      if (method !== "GET") return {};
      if (/\/pulls\/\d+$/.test(path)) {
        return { body: pr.body, labels: (pr.labels ?? []).map((name) => ({ name })), base: { ref: "main" } };
      }
      if (path.includes("/files?")) {
        return path.endsWith("page=1") ? (pr.files ?? []).map((filename) => ({ filename })) : [];
      }
      if (path.includes("/comments?")) return path.endsWith("page=1") ? comments : [];
      throw new Error(`unexpected ${path}`);
    };
    const writes = () => calls.filter((call) => call.method !== "GET");
    return { gh, calls, writes };
  }
  const opts = { repo: "o/r", number: 7, log: () => {} };

  it("posts one comment when something is missing", async () => {
    const github = fakeGitHub({ body: "no link" });
    const { result, action } = await runGate({ ...opts, gh: github.gh });
    expect(result.ok).toBe(false);
    expect(action).toBe("created");
    expect(github.writes()).toEqual([
      { path: "/repos/o/r/issues/7/comments", method: "POST", body: { body: expect.stringContaining(COMMENT_MARKER) } },
    ]);
    expect(github.writes()[0].body?.body).toContain("https://github.com/o/r/blob/main/docs/PR_GATE.md");
  });

  it("updates its existing comment on a re-run instead of adding another", async () => {
    const mine = { id: 55, body: `${COMMENT_MARKER}\nold`, user: { type: "Bot" } };
    const someoneElses = { id: 56, body: `${COMMENT_MARKER}\nquoted by a person`, user: { type: "User" } };
    const github = fakeGitHub({ body: goodBody }, [someoneElses, mine]);
    const { result, action } = await runGate({ ...opts, gh: github.gh });
    expect(result.ok).toBe(true);
    expect(action).toBe("updated");
    expect(github.writes()).toEqual([
      { path: "/repos/o/r/issues/comments/55", method: "PATCH", body: { body: expect.stringContaining("passed") } },
    ]);
  });

  it("leaves an identical comment alone", async () => {
    const first = await runGate({ ...opts, gh: fakeGitHub({ body: "" }).gh });
    const github = fakeGitHub({ body: "" }, [{ id: 1, body: first.comment, user: { type: "Bot" } }]);
    expect((await runGate({ ...opts, gh: github.gh })).action).toBe("unchanged");
    expect(github.writes()).toEqual([]);
  });

  it("doesn't comment on a PR that passes first time", async () => {
    const github = fakeGitHub({ body: goodBody });
    expect((await runGate({ ...opts, gh: github.gh })).action).toBe("none");
    expect(github.writes()).toEqual([]);
  });

  it("checks changed files (including renamed-from paths) and the latest labels", async () => {
    const github = fakeGitHub({ body: goodBody, files: ["src/components/Card.tsx"] });
    expect((await runGate({ ...opts, gh: github.gh })).result.failures.map((f) => f.rule)).toEqual(["screenshots"]);
    const labelled = fakeGitHub({ body: goodBody, labels: ["no-screens"], files: ["src/app/page.tsx"] });
    expect((await runGate({ ...opts, gh: labelled.gh })).result.ok).toBe(true);
  });

  it("still returns the result when the comment can't be posted (read-only token)", async () => {
    const github = fakeGitHub({ body: "" });
    const gh = async (path: string, init: { method?: string; body?: unknown } = {}) => {
      if (init.method === "POST") throw new Error("403");
      return github.gh(path, init);
    };
    const warnings: string[] = [];
    const { result, action } = await runGate({ ...opts, gh, log: (m) => warnings.push(m) });
    expect(result.ok).toBe(false);
    expect(action).toBe("failed");
    expect(warnings[0]).toContain("403");
  });
});

describe("visibleText", () => {
  it("keeps normal text and drops code and comments", () => {
    expect(visibleText("a <!-- b --> c `d` e\n```\nf\n```\ng").replace(/\s+/g, " ").trim()).toBe("a c e g");
  });
});

describe("pr-gate workflow", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/pr-gate.yml", import.meta.url), "utf8");

  it("re-runs when the description or labels change", () => {
    for (const type of ["opened", "edited", "synchronize", "reopened", "labeled", "unlabeled"]) {
      expect(workflow).toMatch(new RegExp(`types:.*\\b${type}\\b`));
    }
  });

  it("asks for the smallest permissions it needs", () => {
    expect(workflow).toMatch(/permissions:\n\s+contents: read\n\s+pull-requests: write\n/);
    expect(workflow).not.toMatch(/pull_request_target/);
  });
});
