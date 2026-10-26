# PR gate

Every pull request runs the **PR gate** (`.github/workflows/pr-gate.yml`, logic in `scripts/ci/pr-gate.mjs`, tests in
`tests/unit/pr-gate.test.ts`). It makes "done" visible: a PR that skips the rules in AGENTS.md fails the check and gets
one comment saying exactly what's missing. Fix the description and the gate re-runs by itself.

## The rules

| Rule | Passes when | Doesn't count |
|---|---|---|
| **Linked issue** | The description has `Closes #<n>`, `Fixes #<n>` or `Resolves #<n>` (any case, colon optional, also `owner/repo#<n>` or a full issue link). Closing several issues is fine: one keyword per issue, e.g. `Closes #12, closes #13`. | `Closes #` with no number, `Closes #<issue>`, `#0`, a bare `#12`, anything in a comment or code |
| **Every box ticked** | No unticked task-list box (`- [ ]`, `* [ ]`, `1. [ ]`, nested or in a quote). `[x]` and `[X]` are ticked. | Boxes inside fenced code blocks (```` ``` ```` or `~~~`) or `<!-- HTML comments -->` |
| **Screenshots** (screen changes only) | The **Screenshots** workflow's comment (#90) has images of the PR's latest commit, **or** the description has an image: Markdown `![](…)`, `<img src>`, a link to an image file (`.png`, `.jpg`, `.gif`, `.webp`, `.avif`, `.svg`) or a GitHub drag-and-drop upload. | Images inside comments or code; the empty table in the PR template; the bot's comment for an older commit, or one with no images (no routes found, or the app failed to start); a copy of that comment posted by a person or another bot |

A PR counts as a **screen change** when it has the `ui` label or changes any file in `src/app/`, `src/components/` or
any `*.css` file.

**How the screenshot bot's comment counts.** `.github/workflows/screenshots.yml` keeps one comment on a UI PR that
starts `<!-- pr-screenshots -->` and names the commit it shot (`<!-- pr-screenshots-sha: … -->`). The gate accepts it
only when it was posted by `github-actions[bot]` (a person can't post as that account), names the PR's current head
commit (new commits need new pictures) and has at least one image. Because a comment from the workflow's token doesn't
start a new gate run, the Screenshots workflow re-runs the gate itself once the comment is up. How agents get
screenshots: docs/TESTING.md ("Screenshots on UI PRs").

## Escape hatches

- **Unfinished on purpose?** An unticked box still fails, even with an explanation next to it. Move that item to a new
  follow-up issue, link it in the description (`Follow-up: #123`) and delete the box. Delete boxes that don't apply
  to this PR (e.g. "Clicked through it in the browser" on a CI-only change).
- **`no-screens` label:** satisfies the screenshots rule when a PR touches UI files but nothing visible changes
  (e.g. a refactor). A founder adds it; the other rules still apply.
- **`skip-gate` label:** bypasses the gate completely, for a founder who needs to merge anyway. Agents never add it.

## How it runs

- Triggers on `pull_request` `opened`, `edited` (description or title changed), `synchronize` (new commits),
  `reopened`, `labeled` and `unlabeled`, and is re-run by the Screenshots workflow after it posts. It reads the PR
  and its comments fresh from the API, so a re-run sees the latest text and screenshots.
- Keeps **one** comment per PR, marked `<!-- pr-gate -->`. It's created the first time something is missing and edited
  on every later run (it says "passed" once everything is fixed). A PR that passes first time gets no comment.
- Permissions: `contents: read`, `pull-requests: write`. No npm install; the script only uses Node built-ins.
- A PR from a fork gets a read-only token, so it can't comment. The check still passes or fails, and the step summary
  shows what's missing.
- Runs the PR's own copy of the script, so a PR could weaken the gate. Changes to `scripts/` and `.github/` need a
  founder's review (CODEOWNERS).

To check a description locally: `node -e 'import("./scripts/ci/pr-gate.mjs").then(g => console.log(g.evaluate({ body: require("fs").readFileSync("pr.md", "utf8"), files: [] })))'`.

## Future work

- Not detected: indented (4-space) code blocks, since nested task lists use the same indent.
