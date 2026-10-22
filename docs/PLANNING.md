# How the work is planned

Every piece of work is a GitHub Issue. The issues were generated from the design spec (`docs/design/sitemap.json`),
`DECISIONS.md` and `BUSINESS_PLAN.md`, so every page, every state and every business rule has a home.

## The shape

```
Epic (e.g. "Customer: post a job")            type: Feature, label: epic
 └─ Feature (e.g. "Post-a-job wizard")         type: Feature
     └─ Task (e.g. "Wizard step 3: where & when")   type: Task   ← this is what you build
```

- **Tasks** are the unit of work: one task = one branch = one PR. Sized S (half a day) or M (about a day). Anything
  bigger was split.
- **Sub-issues** link tasks to their feature and epic. The epic shows a progress bar.
- **Blocked by** links show the order. GitHub marks blocked issues; don't start one until its blockers are closed.
- **Decisions** (label `decision`) are questions only a founder can answer. Tasks that depend on one are blocked
  by it.
- **Ideas** (label `idea`) are captured so they aren't lost. Nobody works on an idea until a founder turns it into a
  task.

## Milestones (build order)

| # | Milestone | Done means |
|---|---|---|
| 0 | Foundations | App scaffold, CI, screenshots on PRs, design system, data model, auth |
| 1 | Core job flow | A customer can post → get a price → pay (test) → a worker claims → does it → signs off → payout queued; office can run it |
| 2 | Quote bounties & AI pricing | Jobs the AI can't price become gold $30 bounties; quotes checked for fairness |
| 3 | Launch: Invercargill | Public site, legal, emails/SMS, security, monitoring; real payments only when both founders agree |
| 4 | Crews | Team jobs with a lead and splits |
| 5 | Verified quoters | Invite-only quoter role, dashboard and earnings |

Work the lowest open milestone first. Inside a milestone: `P1` → `P2` → `P3`.

## Labels

| Label | Meaning |
|---|---|
| `P1` `P2` `P3` | Priority. P1 = needed for the milestone to be done |
| `area:*` | Which part of the product |
| `mode:customer` `mode:trade` `mode:office` | Which colour mode / role the screen belongs to |
| `size:S` `size:M` | Half a day / about a day |
| `ui` | Changes something visible: screenshots required in the PR |
| `needs-william` | Touches schema, money, auth or security: William reviews |
| `needs-matt` | Touches brand, copy or look: Matt reviews |
| `human-only` | Agents don't pick this up (decisions, accounts, legal, going live) |
| `port-from-old-repo` | Start from the code in `willimobro/Trade-Marketplace`, then check it against the spec |
| `epic` `decision` `idea` `bug` | What kind of issue it is |

## Picking up work (agents and people)

Find the next task:

```bash
gh issue list --repo trade-marketplace/main --search "is:open no:assignee -is:blocked -label:epic,decision,idea,human-only sort:created-asc" --limit 20
```

Then follow `AGENTS.md`: assign yourself, branch `<type>/<issue>-<name>`, build the whole thing, tick every box, PR
with `Closes #<issue>` and screenshots.

## The board

The org project board shows every issue in columns (Todo → In progress → In review → Done). Columns move
automatically: assigned/PR opened → In progress, PR ready → In review, PR merged → Done.

## Changing the plan

Plans change. A founder can re-order, split or close issues at any time. If you think a task is wrong, comment on it.
Don't quietly build something different.
