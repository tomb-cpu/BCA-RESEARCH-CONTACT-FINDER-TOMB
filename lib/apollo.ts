import { EXCLUDED_TITLE_KEYWORDS, MAX_CONTACTS, TARGET_TITLES } from "./targetTitles";
import { searchContactOut } from "./contactout";

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
  sources: string[];
}

export interface RawPerson {
  id: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  linkedin_url?: string;
  email?: string;
  email_status?: string;
  organization?: { name?: string };
  organization_name?: string;
  phone?: string;
  sources?: string[];
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
  names: string[];
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
  const related = scored.filter((s) => s.score >= 2).slice(0, MAX_RELATED_ORGS);

  return {
    primary: {
      id: primary.id,
      name: primary.name,
      websiteUrl: primary.website_url ?? null,
      linkedinUrl: primary.linkedin_url ?? null,
    },
    ids: related.length ? related.map((s) => s.org.id) : [primary.id],
    names: related.length ? related.map((s) => s.org.name) : [primary.name],
  };
}

// Regexes matching each target title as a phrase (word-bounded, tolerant of
// spacing/hyphen differences), used to filter saved contacts client-side.
const TITLE_PATTERNS = TARGET_TITLES.map((t) => {
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[\s-]+/g, "[\\s-]*");
  return new RegExp(`\\b${escaped}\\b`, "i");
});

function matchesTargetTitle(title: string | undefined): boolean {
  if (!title) return false;
  return TITLE_PATTERNS.some((re) => re.test(title));
}

function isExcludedTitle(title: string | undefined): boolean {
  if (!title) return false;
  const lower = title.toLowerCase();
  return EXCLUDED_TITLE_KEYWORDS.some((kw) => lower.includes(kw));
}

/** A title is relevant when it matches one of the target titles AND isn't on
 * the exclusion list. Applied to every source so junk titles (research
 * assistants, data analysts, IT roles) can't reach the results regardless of
 * where they came from. */
function isRelevantTitle(title: string | undefined): boolean {
  return matchesTargetTitle(title) && !isExcludedTitle(title);
}

/** True when a person's employer name matches one of the wanted (normalized)
 * company names. Guards against sources returning people from the wrong
 * company (e.g. ContactOut occasionally returns unrelated/sample records). */
function personAtCompany(person: RawPerson, wantedNormalized: string[]): boolean {
  const org = normalizeName(person.organization?.name ?? person.organization_name ?? "");
  if (!org) return false;
  return wantedNormalized.some((w) => w && (org.includes(w) || w.includes(org)));
}

/** Apollo's people api_search only returns "net-new" people — anyone your
 * team already saved as a contact (e.g. via a previous tool or the Apollo
 * UI) is excluded. This searches those saved contacts so they still show
 * up in results. Best-effort: failures just mean fewer sources. */
async function searchSavedContacts(
  companyName: string,
  orgNames: string[]
): Promise<RawPerson[]> {
  try {
    const data = await apolloPost("/contacts/search", {
      q_keywords: companyName,
      page: 1,
      per_page: SEARCH_CANDIDATE_POOL,
    });
    const contacts: RawPerson[] = data.contacts ?? [];
    const wanted = [normalizeName(companyName), ...orgNames.map(normalizeName)];
    return contacts.filter(
      (c) => c.id && isRelevantTitle(c.title) && personAtCompany(c, wanted)
    );
  } catch (err) {
    console.error("Apollo saved-contacts search failed:", err);
    return [];
  }
}

async function searchPeopleAtOrganizations(organizationIds: string[]): Promise<RawPerson[]> {
  const data = await apolloPost("/mixed_people/api_search", {
    organization_ids: organizationIds,
    person_titles: TARGET_TITLES,
    // Expand to closely-related job titles (e.g. "Portfolio Manager,
    // Equities") instead of only exact matches — meaningfully widens
    // coverage, especially at non-US firms with varied title formats.
    include_similar_titles: true,
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

export interface SearchDiagnostics {
  /** Raw candidate counts per source, before dedupe/merge. */
  apolloNetNew: number;
  apolloSaved: number;
  contactOut: number;
  contactOutEnabled: boolean;
  /** Names of the Apollo org entities the company resolved to. */
  orgsMatched: string[];
}

export interface SearchResult {
  organization: Organization;
  contacts: Contact[];
  candidatesFound: number;
  diagnostics: SearchDiagnostics;
}

export async function searchContacts(companyName: string): Promise<SearchResult> {
  const resolved = await resolveOrganizations(companyName);
  if (!resolved) {
    throw new ApolloUserError(
      `No company matching "${companyName}" was found in Apollo's database. Try the exact legal name, or the company's website domain.`
    );
  }
  const organization = resolved.primary;

  // Three complementary sources, queried in parallel:
  //  - Apollo net-new people (strong on LinkedIn + work email)
  //  - Apollo already-saved contacts (excluded from net-new search)
  //  - ContactOut (strong on personal email + phone; no-op without a key)
  const [rawNetNew, saved, rawContactOut] = await Promise.all([
    searchPeopleAtOrganizations(resolved.ids),
    searchSavedContacts(companyName, resolved.names),
    searchContactOut([companyName, ...resolved.names]),
  ]);

  const wanted = [normalizeName(companyName), ...resolved.names.map(normalizeName)];

  // Net-new people are already scoped to the right org IDs by Apollo, but
  // similar-title expansion can pull off-target roles — keep only relevant
  // titles. ContactOut needs both a title AND a company check, since it can
  // return unrelated/sample records.
  const netNew = rawNetNew.filter((p) => isRelevantTitle(p.title));
  const contactOut = rawContactOut.filter(
    (p) => isRelevantTitle(p.title) && personAtCompany(p, wanted)
  );

  const diagnostics: SearchDiagnostics = {
    apolloNetNew: netNew.length,
    apolloSaved: saved.length,
    contactOut: contactOut.length,
    contactOutEnabled: Boolean(process.env.CONTACTOUT_API_KEY),
    orgsMatched: resolved.names,
  };

  const tag = (people: RawPerson[], source: string) =>
    people.map((p) => ({ ...p, sources: p.sources ?? [source] }));

  // Merge across sources, combining fields so a contact keeps the best data
  // from each (e.g. LinkedIn+email from Apollo, phone from ContactOut).
  // Dedupe on LinkedIn URL when present, else normalized name+company.
  const merged = new Map<string, RawPerson>();
  for (const p of [
    ...tag(netNew, "Apollo"),
    ...tag(saved, "Apollo"),
    ...tag(contactOut, "ContactOut"),
  ]) {
    const key = p.linkedin_url
      ? p.linkedin_url.toLowerCase().replace(/\/+$/, "")
      : `${normalizeName(p.name ?? `${p.first_name ?? ""}${p.last_name ?? ""}`)}@${normalizeName(
          p.organization?.name ?? p.organization_name ?? ""
        )}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, p);
      continue;
    }
    merged.set(key, {
      ...existing,
      // Fill any gaps from the newer record; prefer a revealed email.
      name: existing.name ?? p.name,
      title: existing.title ?? p.title,
      linkedin_url: existing.linkedin_url ?? p.linkedin_url,
      email: isRevealedEmail(existing.email) ? existing.email : p.email ?? existing.email,
      email_status: existing.email_status ?? p.email_status,
      organization_name: existing.organization_name ?? p.organization_name,
      phone: existing.phone ?? p.phone,
      sources: [...new Set([...(existing.sources ?? []), ...(p.sources ?? [])])],
    });
  }
  const rawPeople = [...merged.values()];

  // Rank candidates and cut to 20 BEFORE Apollo email enrichment, so email
  // credits are only spent on contacts we return.
  const ranked = [...rawPeople].sort((a, b) => {
    const score = (p: RawPerson) =>
      (p.linkedin_url ? 2 : 0) + (isRevealedEmail(p.email) ? 1 : 0) + (p.phone ? 1 : 0);
    return score(b) - score(a);
  });
  const selected = ranked.slice(0, MAX_CONTACTS);

  // Only Apollo-sourced records can be enriched via Apollo's IDs.
  const enriched = await enrichEmails(selected.filter((p) => !p.id.startsWith("contactout:")));

  const contacts: Contact[] = selected.map((p) => {
    const unlocked = enriched.get(p.id);
    const email = unlocked?.email ?? (isRevealedEmail(p.email) ? (p.email as string) : null);
    return {
      id: p.id,
      name: p.name?.trim() || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Unknown",
      title: p.title ?? "—",
      company: p.organization?.name ?? p.organization_name ?? organization.name,
      linkedinUrl: p.linkedin_url ?? null,
      email,
      emailStatus: unlocked?.status ?? p.email_status ?? null,
      phone: p.phone ?? null,
      sources: p.sources ?? [],
    };
  });

  // Final order: most actionable contacts (LinkedIn + email + phone) first.
  contacts.sort((a, b) => {
    const score = (c: Contact) => (c.linkedinUrl ? 2 : 0) + (c.email ? 1 : 0) + (c.phone ? 1 : 0);
    return score(b) - score(a);
  });

  return {
    organization,
    contacts,
    candidatesFound: rawPeople.length,
    diagnostics,
  };
}
