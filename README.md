# Trade Marketplace

**Sorted in a flash.** Post any job free, accept one fair fixed price, and someone local sorts it.
Tradies and workers pick up priced jobs, estimate from photos, or quote in person, and get paid without the paperwork.

Launching in Invercargill.

## Start here

1. **[AGENTS.md](AGENTS.md)**: how we work. Every person and every AI agent reads it first.
2. **[DECISIONS.md](DECISIONS.md)**: the business rules the founders have locked in.
3. **[BUSINESS_PLAN.md](BUSINESS_PLAN.md)**: how the business and the money work.
4. **[docs/design/](docs/design/)**: the full design spec: every page, every state, tokens, components, motion.
5. **[docs/PLANNING.md](docs/PLANNING.md)**: how the work is broken into issues and how to pick one up.

The visual PDF guides (Brand Guidelines, Front-End Build Guide, Web App Design Spec) live on the
[`design-pdfs`](../../tree/design-pdfs) branch, so code clones stay small.

## Run it locally

1. Use Node 22: `nvm use` (reads `.nvmrc`). npm refuses to install on another version.
2. Install: `npm install`.
3. Optional, to connect Supabase: `cp .env.example .env.local` and fill in the values it describes.
   Without them the app runs with the database and Supabase off.
4. Start it: `npm run dev`, then open http://localhost:3000.

Before a PR: `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`. How the code is laid out:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Who's who

| | |
|---|---|
| Matt Larsen (@mlarsen084) | Co-founder · design, brand, product, reviews screens |
| William Larsen (@willimobro) | Co-founder · engineering, reviews code, schema, payments |
