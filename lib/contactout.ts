import type { RawPerson } from "./apollo";
import { TARGET_TITLES } from "./targetTitles";

const CONTACTOUT_BASE_URL = "https://api.contactout.com/v1";
// ContactOut people search returns ~25 profiles per page; one page is plenty
// alongside Apollo, and revealing contact info is credit-metered per profile.
const CONTACTOUT_PAGE = 1;

/** ContactOut profiles come back with loosely-typed, sometimes-nested fields
 * that vary by plan and endpoint version, so everything here is optional and
 * parsed defensively. */
interface ContactOutProfile {
  id?: string | number;
  full_name?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  headline?: string;
  company?: string | { name?: string };
  current_company?: string | { name?: string };
  company_name?: string;
  linkedin_url?: string;
  url?: string;
  li_vanity?: string;
  email?: string[] | string;
  emails?: string[] | string;
  work_email?: string[] | string;
  work_emails?: string[] | string;
  personal_email?: string[] | string;
  personal_emails?: string[] | string;
  phone?: string[] | string;
  phones?: string[] | string;
  experience?: Array<{ title?: string; company?: string | { name?: string } }>;
}

function firstString(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return undefined;
  }
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function companyName(value: string | { name?: string } | undefined): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  return value.name?.trim() || undefined;
}

function linkedinFromProfile(p: ContactOutProfile): string | undefined {
  const direct = firstString(p.linkedin_url) ?? firstString(p.url);
  if (direct) return direct;
  const vanity = firstString(p.li_vanity);
  return vanity ? `https://www.linkedin.com/in/${vanity}` : undefined;
}

function bestEmail(p: ContactOutProfile): string | undefined {
  // Prefer a work email; fall back to personal/general.
  return (
    firstString(p.work_email) ??
    firstString(p.work_emails) ??
    firstString(p.email) ??
    firstString(p.emails) ??
    firstString(p.personal_email) ??
    firstString(p.personal_emails)
  );
}

function toRawPerson(p: ContactOutProfile): RawPerson | null {
  const name =
    firstString(p.full_name) ??
    firstString(p.name) ??
    `${firstString(p.first_name) ?? ""} ${firstString(p.last_name) ?? ""}`.trim();
  const linkedin = linkedinFromProfile(p);
  if (!name && !linkedin) return null;

  const title = firstString(p.title) ?? firstString(p.headline) ?? p.experience?.[0]?.title;
  const company =
    companyName(p.company) ??
    companyName(p.current_company) ??
    firstString(p.company_name) ??
    companyName(p.experience?.[0]?.company);

  const id = p.id != null ? String(p.id) : linkedin ?? `co-${name}`;

  return {
    id: `contactout:${id}`,
    name: name || undefined,
    title,
    linkedin_url: linkedin,
    email: bestEmail(p),
    phone: firstString(p.phone) ?? firstString(p.phones),
    organization_name: company,
    sources: ["ContactOut"],
  };
}

/**
 * Best-effort ContactOut people search. Returns [] (never throws) when the
 * key is unset or ContactOut errors, so it can be added to the Apollo
 * pipeline without any risk of breaking existing results. Only runs when
 * CONTACTOUT_API_KEY is configured.
 */
export async function searchContactOut(companyNames: string[]): Promise<RawPerson[]> {
  const token = process.env.CONTACTOUT_API_KEY;
  if (!token) return [];

  const companies = [...new Set(companyNames.map((c) => c.trim()).filter(Boolean))].slice(0, 5);
  if (!companies.length) return [];

  try {
    const res = await fetch(`${CONTACTOUT_BASE_URL}/people/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        token,
      },
      body: JSON.stringify({
        page: CONTACTOUT_PAGE,
        job_title: [...TARGET_TITLES],
        company: companies,
        reveal_info: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`ContactOut search failed (${res.status}): ${text.slice(0, 300)}`);
      return [];
    }

    const data = await res.json();
    const profilesRaw = data.profiles ?? data.data ?? [];
    const list: ContactOutProfile[] = Array.isArray(profilesRaw)
      ? profilesRaw
      : (Object.values(profilesRaw) as ContactOutProfile[]);

    return list.map(toRawPerson).filter((p): p is RawPerson => p !== null);
  } catch (err) {
    console.error("ContactOut search threw:", err);
    return [];
  }
}
