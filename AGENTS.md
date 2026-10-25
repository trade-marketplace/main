# Rules for everyone working on this repo (humans and AI agents)

Trade Marketplace is built by two founders, Matt (design, product) and William (engineering), plus several AI agents
(Claude, ChatGPT/Codex and others) working at the same time. These rules let everyone work independently without
overwriting each other. **Every agent reads this whole file before touching anything.**

## 1. Only work from an issue

- All work comes from a **GitHub Issue** on the project board. No issue, no work.
- Pick an issue in the **Ready** column whose `Blocked by` issues are all closed. Prefer the lowest milestone, then
  priority `P1` → `P2` → `P3`.
- **Assign yourself** (or comment `Taking this — <agent/model name>`) before you start, so nobody else picks it up.
  Move it to **In progress**.
- If an issue is already assigned or In progress, leave it alone.
- Found a bug, a gap or a good idea while working? **Open a new issue** (Bug or Idea template) and keep going with your
  own task. Never widen your task to fix it.

## 2. One issue = one branch = one pull request

- Branch from the latest `main`. Name it `<type>/<issue-number>-<short-name>`, e.g. `feat/142-post-job-photos`,
  `fix/77-claim-race`. Types: `feat`, `fix`, `chore`, `docs`, `test`.
- Open one PR that says `Closes #<issue>` in the description and uses the PR template.
- Never push to `main` directly. Never push to someone else's branch. Never force-push a shared branch.
- Keep branches short-lived. Pull `main` again before you open the PR and fix any conflicts yourself.

## 3. Finish the whole issue

AI agents have a habit of doing the easy half and stopping. Here, **a task is done only when every box is ticked**:

- Every **Acceptance criteria** checkbox in the issue is met.
- Every **"What if…"** case in the issue is handled and, where possible, has a test.
- Every state the design lists is built: loading, empty, error, success (and disabled, offline where relevant).
- It works at 320 / 390 / 768 / 1024 / 1440 px with no sideways scroll; keyboard and screen reader work.
- `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` all pass (once the app exists, CI runs them).
- **Screenshots** (desktop 1440 + phone 390) of every screen you changed are in the PR, next to the mockup it should
  match. Matt reviews screens from these.

If you can't finish (blocked, unclear, out of time): **don't open a "done" PR.** Comment on the issue with exactly what
is finished, what isn't and why, move it back to **Ready** (or **Blocked**) and unassign yourself. A half-built feature
that claims to be done is worse than none.

## 4. Stay in your lane

- Only change the files your issue needs. Don't reformat, rename or "tidy" unrelated code.
- These need **William's** review: the database schema and migrations, pricing maths, payments, auth/sessions,
  anything touching money or security.
- These need **Matt's** review: brand tokens, fonts, logo, illustrations, copy/wording on screens, anything that
  changes how a screen looks compared with the mockup.
- Never commit secrets, `.env` files, databases, uploads or real customer data.
- Two issues need the same file? Say so in your PR. Never silently rewrite someone else's work.

## 5. Where the truth lives

| Question | Source |
|---|---|
| What we decided (business rules) | `DECISIONS.md`. It overrides everything older. |
| Which services we use (Supabase project, Vercel, email) | `docs/SERVICES.md` |
| What the product is and how money works | `BUSINESS_PLAN.md` (read its "Needs work" box first) |
| What every page is, its route, states, priority | `docs/design/sitemap.json` and `docs/design/WEBAPP_SPEC.md` |
| How a desktop page looks | `docs/design/pages.html` (open it in a browser and inspect it) |
| How a phone screen looks | `docs/design/screens.html` + `docs/design/FRONTEND_SPEC.md` |
| Colours, type, spacing, motion | `docs/design/tokens.css`, `components.css`, `web.css` |
| The full visual guides (PDF) | The `design-pdfs` branch (kept off `main` so clones stay small) |

- Build **what** the spec describes; choose **how** to build it yourself.
- Colours come from tokens, never hard-coded hex. Customer screens are green (Leaf/Lime), tradie screens orange
  (Hi-Vis/Amber), office screens Forest/Mint. Quote bounties are gold. Labels on coloured buttons are Forest `#0C251D`.
- Type is self-hosted Roboto Flex (`Trade Display`, `Trade UI`); icons are Material Symbols Rounded. No SF Pro or
  SF Symbols on the web.
- Every price, name and count in the mockups is an **example**. Real values come from the server.
- Customers never see estimates, averages or margins. Tradies see what they earn, never the customer price.
- Anything listed under **"Still to decide"** in `DECISIONS.md` needs a founder. Build the screen if the issue says
  so, but don't invent the business rule; ask on the issue.
- Payments stay in **test mode** until both founders agree in writing to switch them on.

## 6. The old repo

`willimobro/Trade-Marketplace` is the earlier prototype. It is **read-only reference**. Only copy code from it when your
issue says to ("port X from the old repo"), and when you do, re-check it against the current spec and decisions.

## 7. Pull requests

- Use the PR template. Say what changed, why, how you tested it, and include screenshots for anything visible.
- Say which agent and model made the change.
- A founder approves before merge: William for code, Matt for screens. Agents never merge their own PRs.
