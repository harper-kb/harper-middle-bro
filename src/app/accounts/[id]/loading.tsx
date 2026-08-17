export default function CompanyDetailLoading() {
  return (
    <main
      className="mx-auto max-w-6xl animate-pulse px-4 py-7 sm:px-6 sm:py-10"
      aria-label="Loading company details"
      aria-busy="true"
    >
      <div className="h-5 w-32 rounded bg-[var(--sand)]" />
      <div className="mt-7 border-b border-[var(--rule)] pb-6">
        <div className="h-3 w-24 rounded bg-[var(--sand)]" />
        <div className="mt-3 h-9 w-80 max-w-full rounded bg-[var(--sand)]" />
        <div className="mt-3 h-5 w-52 rounded bg-[var(--sand)]" />
      </div>
      <div className="mt-6">
        <div className="mb-3 h-4 w-36 rounded bg-[var(--sand)]" />
        <div className="surface-card h-24" />
      </div>
      <div className="mt-6 grid items-start gap-4 md:grid-cols-2 lg:grid-cols-[0.72fr_1fr_1.25fr]">
        {["h-24", "h-32", "h-40"].map((height) => (
          <div key={height} className={`surface-card ${height} p-4`}>
            <div className="h-3 w-20 rounded bg-[var(--sand)]" />
            <div className="mt-4 h-5 w-40 rounded bg-[var(--sand)]" />
            <div className="mt-3 h-3 w-56 max-w-full rounded bg-[var(--sand)]" />
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {[0, 1].map((item) => (
          <div key={item} className="surface-card h-32 p-5">
            <div className="h-3 w-28 rounded bg-[var(--sand)]" />
            <div className="mt-5 h-8 w-40 rounded bg-[var(--sand)]" />
          </div>
        ))}
      </div>
      <div className="mt-10 h-44 rounded-xl border border-[var(--rule)] bg-[var(--surface-raised)]" />
      <span className="sr-only">Loading company details…</span>
    </main>
  );
}
