# BCA Contact Finder

Internal sales tool: type a company name, get up to **50** investment
decision-makers at that firm — portfolio managers, CIOs, allocators, and
related titles — with title, LinkedIn profile, email, and phone, sourced live
from **Apollo.io** and **ContactOut**.

Built with Next.js (App Router) + TypeScript + Tailwind CSS, styled to the
BCA Research brand.

---

## Project status (last updated with commit `48c4fe5`)

There are **two tracks** for this tool. Both are live in this repo.

### Track 1 — the web app (this codebase)
A deployed Next.js app. Reps enter a firm name and get a filtered, ranked
contact list. Sources: Apollo (LinkedIn + work email) and ContactOut
(personal email + phone). Runs on Vercel.

**Status:** working. Deployed on Vercel from `main`. Needs `APOLLO_API_KEY`
(and optionally `CONTACTOUT_API_KEY`) set as Vercel environment variables.

### Track 2 — a Claude Project using MCP connectors
Same filtered-search behaviour, but run conversationally inside Claude with
MCP connectors (Apollo, Dakota, ContactOut, etc.) instead of REST code. See
[`docs/claude-agent-instructions.md`](docs/claude-agent-instructions.md) for
the ready-to-paste Project instructions and setup steps.

**Status:** instructions written; connectors must be attached per Claude
account (Settings → Connectors). Preqin and FINTRX have no MCP connector, so
they stay on Track 1 / manual.

### What is NOT in git (re-add these when moving accounts/deployments)
- **Vercel env vars:** `APOLLO_API_KEY`, `CONTACTOUT_API_KEY` (see `.env.example`).
- **Claude connectors** for Track 2 — attached per Claude account, not stored here.

### Open items / next steps
- Confirm ContactOut is returning on-company results (check the in-app
  **Sources** diagnostics line after a search).
- Decide whether to keep the web app as the home for non-MCP sources
  (Preqin, FINTRX) or retire it in favour of the Claude Project.
- Optional polish: real Ivar / GT America web fonts (currently using the
  brand's Georgia/Arial substitutes) and the BCA logo in the header.
- Potential new sources discussed: FINTRX (family offices), RocketReach /
  Lusha / PDL (self-serve, easy to add), Cognism (EU phones).

---

## How the web app works

1. Rep types a firm name (asset manager, hedge fund, PE firm, family office).
2. `app/api/search-contacts/route.ts` → `lib/apollo.ts` runs the search:
   - resolves the company name to Apollo org record(s), matching exact names
     first and including closely name-related entities (e.g. "JPMorgan Chase"
     + "J.P. Morgan Asset Management")
   - searches people at those orgs matching the target titles in
     `lib/targetTitles.ts` (`mixed_people/api_search`, with
     `include_similar_titles`)
   - also pulls already-saved Apollo contacts and, if `CONTACTOUT_API_KEY` is
     set, ContactOut results (`lib/contactout.ts`)
3. Results are **merged and de-duplicated** across sources (by LinkedIn URL,
   else name+company), combining fields so each contact keeps the best data
   from every source.
4. Every contact is **filtered** to a target title (and against an exclusion
   list — no research assistants, data analysts, Chief *Information* Officers,
   etc.) and to the searched company.
5. Ranked (LinkedIn + email + phone first) and the top 50 are returned as
   cards with source tags, a copyable email/phone, and CSV export.

A collapsible **Sources** diagnostics line on the results shows how many
contacts came from each source and which company records matched — useful for
debugging thin results.

## Setup

```bash
npm install
cp .env.example .env.local
# add your keys in .env.local
npm run dev
```

- **`APOLLO_API_KEY`** (required) — Apollo → Settings → Integrations → API.
  Needs API access + email-reveal credits. The people search uses the
  `mixed_people/api_search` endpoint, which requires a **master** API key.
- **`CONTACTOUT_API_KEY`** (optional) — enables ContactOut (personal emails +
  phone). Without it, the app runs Apollo-only.

## Deploying to Vercel

1. Import this repo into Vercel; it deploys `main` to Production.
2. **Project Settings → Environment Variables**, add `APOLLO_API_KEY` (and
   optionally `CONTACTOUT_API_KEY`) for Production/Preview/Development.
3. Redeploy so the env vars take effect.

## Tuning who shows up

Edit `lib/targetTitles.ts`:
- **`TARGET_TITLES`** — job titles to include (matched as word-bounded
  phrases, so "Portfolio Manager" also catches "Senior Portfolio Manager").
- **`EXCLUDED_TITLE_KEYWORDS`** — titles to reject even if they otherwise
  match (assistant, intern, data analyst, information officer, etc.).
- **`MAX_CONTACTS`** — max contacts returned per search (default 50).
