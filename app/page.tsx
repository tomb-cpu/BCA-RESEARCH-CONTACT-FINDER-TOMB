import ContactSearch from "@/app/components/ContactSearch";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-slate-950">
      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-1 px-6 py-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400">
            BCA Sourcing
          </p>
          <h1 className="text-2xl font-semibold text-slate-50 sm:text-3xl">
            BCA Contact Finder
          </h1>
          <p className="max-w-2xl text-sm text-slate-400">
            Enter a firm name to pull up to 20 investment decision-makers —
            portfolio managers, CIOs, and allocators — at asset managers,
            hedge funds, private equity firms, and family offices, complete
            with title, LinkedIn, and email.
          </p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <ContactSearch />
      </main>
      <footer className="border-t border-slate-800/80 py-6">
        <p className="mx-auto max-w-5xl px-6 text-xs text-slate-500">
          Contact data sourced live from Apollo.io. Phone numbers require
          manual reveal in Apollo (async, credit-metered) and are not
          returned via this tool.
        </p>
      </footer>
    </div>
  );
}
