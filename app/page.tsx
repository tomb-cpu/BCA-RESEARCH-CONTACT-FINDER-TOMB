import ContactSearch from "@/app/components/ContactSearch";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-ink">
      <header className="border-b border-line/70 bg-marine/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-6 py-7">
          <div className="flex items-center gap-2">
            <span className="inline-block h-4 w-1 rounded-full bg-jade" aria-hidden />
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-jade">
              BCA Research · Sourcing
            </p>
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-bwhite sm:text-4xl">
            Contact Finder
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-aqua">
            Enter a firm name to pull up to 50 investment decision-makers —
            portfolio managers, CIOs, and allocators — at asset managers,
            hedge funds, private equity firms, and family offices, complete
            with title, LinkedIn, and email.
          </p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <ContactSearch />
      </main>
      <footer className="border-t border-line/70 py-6">
        <p className="mx-auto max-w-5xl px-6 text-xs text-seaglass">
          Contact data sourced live from Apollo.io and ContactOut. Each card
          is tagged with the source(s) it came from; phone numbers come from
          ContactOut where available.
        </p>
      </footer>
    </div>
  );
}
