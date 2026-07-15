"use client";

import { useState } from "react";
import type { Contact, Organization } from "@/lib/apollo";
import { TARGET_TITLES } from "@/lib/targetTitles";

interface SearchResponse {
  organization: Organization;
  contacts: Contact[];
  candidatesFound: number;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function downloadCsv(companyName: string, contacts: Contact[]) {
  const header = ["Name", "Title", "Company", "LinkedIn", "Email", "Phone", "Sources"];
  const rows = contacts.map((c) => [
    c.name,
    c.title,
    c.company,
    c.linkedinUrl ?? "",
    c.email ?? "",
    c.phone ?? "",
    (c.sources ?? []).join(" + "),
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => csvEscape(cell)).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${companyName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-contacts.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ContactSearch() {
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const canSearch = companyName.trim().length > 0 && !loading;

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!canSearch) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/search-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: companyName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setResult(data as SearchResponse);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function copyToClipboard(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500);
    } catch {
      // Clipboard API unavailable — silently ignore.
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="e.g. Bridgewater Associates"
          className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          autoFocus
        />
        <button
          type="submit"
          disabled={!canSearch}
          className="inline-flex items-center justify-center rounded-lg bg-indigo-500 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          {loading ? "Searching…" : "Find contacts"}
        </button>
      </form>

      <TargetTitlesDisclosure />

      {loading && <LoadingSkeleton />}

      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {result && !loading && (
        <ResultsSection
          result={result}
          companyName={companyName}
          copiedId={copiedId}
          onCopy={copyToClipboard}
        />
      )}
    </div>
  );
}

function TargetTitlesDisclosure() {
  return (
    <details className="group rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-3 text-sm text-slate-400">
      <summary className="cursor-pointer select-none font-medium text-slate-300">
        Target titles ({TARGET_TITLES.length})
      </summary>
      <div className="mt-3 flex flex-wrap gap-2">
        {TARGET_TITLES.map((title) => (
          <span
            key={title}
            className="rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1 text-xs text-slate-300"
          >
            {title}
          </span>
        ))}
      </div>
    </details>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-xl border border-slate-800 bg-slate-900/50 p-4"
        >
          <div className="h-4 w-2/3 rounded bg-slate-800" />
          <div className="mt-2 h-3 w-1/2 rounded bg-slate-800" />
          <div className="mt-4 h-3 w-full rounded bg-slate-800" />
          <div className="mt-2 h-3 w-3/4 rounded bg-slate-800" />
        </div>
      ))}
    </div>
  );
}

function ResultsSection({
  result,
  companyName,
  copiedId,
  onCopy,
}: {
  result: SearchResponse;
  companyName: string;
  copiedId: string | null;
  onCopy: (text: string, id: string) => void;
}) {
  const { organization, contacts, candidatesFound } = result;

  if (contacts.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-6 text-center text-sm text-slate-400">
        Found <span className="font-medium text-slate-200">{organization.name}</span> in
        Apollo, but no one matching the target titles turned up. Try a parent
        company name or a broader entity.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">{organization.name}</h2>
          <p className="text-xs text-slate-500">
            {contacts.length} contact{contacts.length === 1 ? "" : "s"} shown
            {candidatesFound > contacts.length ? ` · ${candidatesFound} candidates found` : ""}
            {organization.websiteUrl ? (
              <>
                {" · "}
                <a
                  href={organization.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-400 hover:underline"
                >
                  {organization.websiteUrl.replace(/^https?:\/\//, "")}
                </a>
              </>
            ) : null}
          </p>
        </div>
        <button
          onClick={() => downloadCsv(companyName, contacts)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-medium text-slate-200 hover:border-indigo-500 hover:text-indigo-300"
        >
          Export CSV
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {contacts.map((contact) => (
          <ContactCard
            key={contact.id}
            contact={contact}
            copiedId={copiedId}
            onCopy={onCopy}
          />
        ))}
      </div>
    </div>
  );
}

function ContactCard({
  contact,
  copiedId,
  onCopy,
}: {
  contact: Contact;
  copiedId: string | null;
  onCopy: (text: string, id: string) => void;
}) {
  const emailCopyId = `${contact.id}-email`;
  const phoneCopyId = `${contact.id}-phone`;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4 transition-colors hover:border-slate-700">
      <div>
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-100">{contact.name}</h3>
          {contact.sources && contact.sources.length > 0 && (
            <div className="flex shrink-0 flex-wrap justify-end gap-1">
              {contact.sources.map((s) => (
                <span
                  key={s}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    s === "ContactOut"
                      ? "bg-emerald-500/10 text-emerald-300"
                      : "bg-sky-500/10 text-sky-300"
                  }`}
                >
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
        <p className="text-xs text-slate-400">{contact.title}</p>
        <p className="text-xs text-slate-500">{contact.company}</p>
      </div>

      <div className="flex flex-col gap-1.5 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500">LinkedIn</span>
          {contact.linkedinUrl ? (
            <a
              href={contact.linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-indigo-500/10 px-2 py-1 font-medium text-indigo-300 hover:bg-indigo-500/20"
            >
              View profile
            </a>
          ) : (
            <span className="text-slate-600">Not available</span>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500">Email</span>
          {contact.email ? (
            <button
              onClick={() => onCopy(contact.email as string, emailCopyId)}
              className="max-w-[160px] truncate rounded-md bg-slate-800 px-2 py-1 font-medium text-slate-200 hover:bg-slate-700"
              title={contact.email}
            >
              {copiedId === emailCopyId ? "Copied!" : contact.email}
            </button>
          ) : (
            <span className="text-slate-600">Not unlocked</span>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500">Phone</span>
          {contact.phone ? (
            <button
              onClick={() => onCopy(contact.phone as string, phoneCopyId)}
              className="max-w-[160px] truncate rounded-md bg-slate-800 px-2 py-1 font-medium text-slate-200 hover:bg-slate-700"
              title={contact.phone}
            >
              {copiedId === phoneCopyId ? "Copied!" : contact.phone}
            </button>
          ) : (
            <span className="text-slate-600">Not available</span>
          )}
        </div>
      </div>
    </div>
  );
}
