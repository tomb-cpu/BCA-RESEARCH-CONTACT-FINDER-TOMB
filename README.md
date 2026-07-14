# BCA Contact Finder

Internal sales tool: type a company name, get up to 20 investment
decision-makers at that firm — portfolio managers, CIOs, allocators, and
related titles — with title, LinkedIn profile, and email, sourced live from
Apollo.io.

Built with Next.js (App Router) + TypeScript + Tailwind CSS.

## How it works

1. Sales rep types a firm name (asset manager, hedge fund, PE firm, family
   office, etc.) into the search box.
2. `app/api/search-contacts/route.ts` calls Apollo.io:
   - resolves the company name to an Apollo organization (`mixed_companies/search`)
   - searches people at that organization matching the target titles in
     `lib/targetTitles.ts` (`mixed_people/search`)
   - bulk-enriches the top candidates to unlock work emails (`people/bulk_match`)
3. Results are ranked (contacts with LinkedIn + email first) and the top 20
   are returned to the UI as cards, with a CSV export button.

Phone numbers are **not** included: Apollo only reveals phone numbers
asynchronously via a webhook (and at a higher credit cost), which doesn't fit
a synchronous "search and get results" flow. Each card links out to reveal
phone in Apollo directly if needed.

## Setup

```bash
npm install
cp .env.example .env.local
# then put your Apollo API key in .env.local
npm run dev
```

Get an Apollo API key from **Apollo → Settings → Integrations → API**. A
plan with API access and enough email-reveal credits is required for emails
to unlock (LinkedIn/title/company data works on any plan with API access).

## Deploying to Vercel

1. Import this repo into Vercel (or redeploy the existing project connected
   to it).
2. In **Project Settings → Environment Variables**, add:
   - `APOLLO_API_KEY` = your Apollo API key
3. Redeploy. No other configuration is required.

## Tuning who shows up

Edit `lib/targetTitles.ts` — `TARGET_TITLES` is the list of job titles Apollo
matches against (Apollo does substring/keyword matching, so thematic entries
like `"Fixed Income"` or `"Geo-Macro"` will match titles containing that
phrase). `MAX_CONTACTS` controls how many contacts are returned per search
(default 20).
