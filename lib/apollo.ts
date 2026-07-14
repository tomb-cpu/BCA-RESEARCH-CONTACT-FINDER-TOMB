import { MAX_CONTACTS, TARGET_TITLES } from "./targetTitles";

const APOLLO_BASE_URL = "https://api.apollo.io/api/v1";
const ENRICH_BATCH_SIZE = 10;
// Cast a wider net than MAX_CONTACTS so we still land on 20 good contacts
// even if a few candidates fail enrichment or lack a LinkedIn/email.
const SEARCH_CANDIDATE_POOL = 40;

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
    throw new Error(`Apollo request to ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

function isRevealedEmail(email: string | undefined | null): email is string {
  if (!email) return false;
  return !email.includes("email_not_unlocked") && !email.includes("not_unlocked@");
}

async function resolveOrganization(companyName: string): Promise<Organization | null> {
  const data = await apolloPost("/mixed_companies/search", {
    q_organization_name: companyName,
    page: 1,
    per_page: 10,
  });

  const orgs: Array<{
    id: string;
    name: string;
    website_url?: string;
    linkedin_url?: string;
  }> = data.organizations ?? data.accounts ?? [];

  if (!orgs.length) return null;

  const exact = orgs.find((o) => o.name?.toLowerCase() === companyName.trim().toLowerCase());
  const org = exact ?? orgs[0];

  return {
    id: org.id,
    name: org.name,
    websiteUrl: org.website_url ?? null,
    linkedinUrl: org.linkedin_url ?? null,
  };
}

async function searchPeopleAtOrganization(organizationId: string): Promise<RawPerson[]> {
  const data = await apolloPost("/mixed_people/search", {
    organization_ids: [organizationId],
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
  const organization = await resolveOrganization(companyName);
  if (!organization) {
    throw new ApolloUserError(
      `No company matching "${companyName}" was found in Apollo's database. Try the exact legal name, or the company's website domain.`
    );
  }

  const rawPeople = await searchPeopleAtOrganization(organization.id);
  const enriched = await enrichEmails(rawPeople);

  const contacts: Contact[] = rawPeople.map((p) => {
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

  // Prioritize contacts that actually have a LinkedIn URL and/or email —
  // those are the ones a sales rep can act on immediately.
  contacts.sort((a, b) => {
    const score = (c: Contact) => (c.linkedinUrl ? 2 : 0) + (c.email ? 1 : 0);
    return score(b) - score(a);
  });

  return {
    organization,
    contacts: contacts.slice(0, MAX_CONTACTS),
    candidatesFound: rawPeople.length,
  };
}
