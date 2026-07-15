import { MAX_CONTACTS, TARGET_TITLES } from "./targetTitles";

const APOLLO_BASE_URL = "https://api.apollo.io/api/v1";
const ENRICH_BATCH_SIZE = 10;
// Cast a wider net than MAX_CONTACTS so ranking has real choices — 100 is
// Apollo's per-page max and costs the same single search request.
const SEARCH_CANDIDATE_POOL = 100;

export class ApolloUserError extends Error {
  status: number;
  constructor(message: string, status = 404) {
    super(message);
    this.name = "ApolloUserError";
    this.status = status;
  }
}

export class ApolloConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApolloConfigError";
  }
}

export interface Organization {
  id: string;
  name: string;
  websiteUrl: string | null;
  linkedinUrl: string | null;
}

export interface Contact {
  id: string;
  name: string;
  title: string;
  company: string;
  linkedinUrl: string | null;
  email: string | null;
  emailStatus: string | null;
  phone: string | null;
}

interface RawPerson {
  id: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  linkedin_url?: string;
  email?: string;
  email_status?: string;
  organization?: { name?: string };
}

function apolloHeaders(): Record<string, string> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    throw new ApolloConfigError(
      "APOLLO_API_KEY is not configured on the server. Add it as an environment variable and redeploy."
    );
  }
  return {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
    Accept: "application/json",
    "x-api-key": apiKey,
  };
}

type QueryValue = string | number | boolean | readonly string[] | undefined;

function buildQuery(params: Record<string, QueryValue>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        parts.push(`${encodeURIComponent(key)}[]=${encodeURIComponent(item)}`);
      }
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.join("&");
}

async function apolloPost(path: string, query: Record<string, QueryValue>, body?: unknown) {
  const qs = buildQuery(query);
  const url = `${APOLLO_BASE_URL}${path}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: apolloHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const detail = text.slice(0, 300);
    if (res.status === 401) {
      throw new ApolloUserError(
        "Apollo rejected the API key (401 Unauthorized). Double-check APOLLO_API_KEY in Vercel — it may be mistyped, revoked, or from a different Apollo workspace.",
        502
      );
    }
    if (res.status === 403) {
      throw new ApolloUserError(
        `Apollo denied access to ${path} (403 Forbidden). Your Apollo plan may not include API access for this endpoint, or the key needs to be a master API key. Apollo said: ${detail}`,
        502
      );
    }
    if (res.status === 422) {
      throw new ApolloUserError(
        `Apollo rejected the request to ${path} (422). Apollo said: ${detail}`,
        502
      );
    }
    if (res.status === 429) {
      throw new ApolloUserError(
        "Apollo rate limit hit (429). Wait a minute and try again, or check your plan's API call limits.",
        502
      );
    }
    throw new Error(`Apollo request to ${path} failed (${res.status}): ${detail}`);
  }
  return res.json();
}

function isRevealedEmail(email: string | undefined | null): email is string {
  if (!email) return false;
  return !email.includes("email_not_unlocked") && !email.includes("not_unlocked@");
}

/** Lowercase and strip punctuation/whitespace so "J.P. Morgan" and
 * "JPMorgan" compare equal. */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface ResolvedOrganizations {
  primary: Organization;
  /** Primary plus closely related entities (e.g. "J.P. Morgan Asset
   * Management" alongside "JPMorgan Chase & Co."), searched together so
   * big firms with many Apollo org records get full coverage. */
  ids: string[];
}

const MAX_RELATED_ORGS = 5;

async function resolveOrganizations(companyName: string): Promise<ResolvedOrganizations | null> {
  const data = await apolloPost("/mixed_companies/search", {
    q_organization_name: companyName,
    page: 1,
    per_page: 25,
  });

  const orgs: Array<{
    id: string;
    name: string;
    website_url?: string;
    linkedin_url?: string;
    estimated_num_employees?: number;
  }> = data.organizations ?? data.accounts ?? [];

  if (!orgs.length) return null;

  const query = normalizeName(companyName);
  // 3 = exact name match, 2 = one name contains the other (subsidiaries,
  // alternate spellings), 1 = anything else Apollo considered relevant.
  const scored = orgs
    .filter((o) => o.id && o.name)
    .map((o) => {
      const name = normalizeName(o.name);
      const score = name === query ? 3 : name.includes(query) || query.includes(name) ? 2 : 1;
      return { org: o, score };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.org.estimated_num_employees ?? 0) - (a.org.estimated_num_employees ?? 0)
    );

  const primary = scored[0].org;
  // Only widen to name-related entities; never bundle in the score-1
  // leftovers, which can be entirely different companies.
  const related = scored
    .filter((s) => s.score >= 2)
    .slice(0, MAX_RELATED_ORGS)
    .map((s) => s.org.id);

  return {
    primary: {
      id: primary.id,
      name: primary.name,
      websiteUrl: primary.website_url ?? null,
      linkedinUrl: primary.linkedin_url ?? null,
    },
    ids: related.length ? related : [primary.id],
  };
}

async function searchPeopleAtOrganizations(organizationIds: string[]): Promise<RawPerson[]> {
  const data = await apolloPost("/mixed_people/api_search", {
    organization_ids: organizationIds,
    person_titles: TARGET_TITLES,
    page: 1,
    per_page: SEARCH_CANDIDATE_POOL,
  });

  const people: RawPerson[] = data.people ?? [];
  const seen = new Set<string>();
  return people.filter((p) => {
    if (!p.id || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

/** Best-effort email enrichment. Never throws — enrichment failures just
 * leave those contacts without an unlocked email rather than breaking the
 * whole search. Phone numbers are intentionally not requested here because
 * Apollo only delivers revealed phone numbers asynchronously via webhook. */
async function enrichEmails(people: RawPerson[]): Promise<Map<string, { email: string; status: string | null }>> {
  const result = new Map<string, { email: string; status: string | null }>();
  const toEnrich = people.filter((p) => !isRevealedEmail(p.email));
  if (!toEnrich.length) return result;

  for (let i = 0; i < toEnrich.length; i += ENRICH_BATCH_SIZE) {
    const batch = toEnrich.slice(i, i + ENRICH_BATCH_SIZE);
    try {
      const data = await apolloPost(
        "/people/bulk_match",
        { reveal_personal_emails: true },
        { details: batch.map((p) => ({ id: p.id })) }
      );
      const matches: RawPerson[] = data.matches ?? [];
      for (const match of matches) {
        if (match?.id && isRevealedEmail(match.email)) {
          result.set(match.id, { email: match.email as string, status: match.email_status ?? null });
        }
      }
    } catch (err) {
      console.error("Apollo bulk email enrichment batch failed:", err);
    }
  }

  return result;
}

export interface SearchResult {
  organization: Organization;
  contacts: Contact[];
  candidatesFound: number;
}

export async function searchContacts(companyName: string): Promise<SearchResult> {
  const resolved = await resolveOrganizations(companyName);
  if (!resolved) {
    throw new ApolloUserError(
      `No company matching "${companyName}" was found in Apollo's database. Try the exact legal name, or the company's website domain.`
    );
  }
  const organization = resolved.primary;

  const rawPeople = await searchPeopleAtOrganizations(resolved.ids);

  // Rank candidates (LinkedIn presence first) and cut to 20 BEFORE
  // enrichment, so email credits are only spent on contacts we return.
  const ranked = [...rawPeople].sort((a, b) => {
    const score = (p: RawPerson) =>
      (p.linkedin_url ? 2 : 0) + (isRevealedEmail(p.email) ? 1 : 0);
    return score(b) - score(a);
  });
  const selected = ranked.slice(0, MAX_CONTACTS);

  const enriched = await enrichEmails(selected);

  const contacts: Contact[] = selected.map((p) => {
    const unlocked = enriched.get(p.id);
    const email = unlocked?.email ?? (isRevealedEmail(p.email) ? (p.email as string) : null);
    return {
      id: p.id,
      name: p.name?.trim() || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Unknown",
      title: p.title ?? "—",
      company: p.organization?.name ?? organization.name,
      linkedinUrl: p.linkedin_url ?? null,
      email,
      emailStatus: unlocked?.status ?? p.email_status ?? null,
      phone: null,
    };
  });

  // Final order: contacts with both LinkedIn and email first.
  contacts.sort((a, b) => {
    const score = (c: Contact) => (c.linkedinUrl ? 2 : 0) + (c.email ? 1 : 0);
    return score(b) - score(a);
  });

  return {
    organization,
    contacts,
    candidatesFound: rawPeople.length,
  };
}
