// Loading placeholder for pages whose content is entirely derived from one or
// more react-query hooks. Shown while those queries are still in flight so a
// slow first fetch (or a company switch) never reads as "you have zero
// leads/jobs/clients" — the .skeleton* shimmer classes already existed in
// styles.css for exactly this, just weren't wired to any page yet.
export default function PageSkeleton({ kpis = 0, cards = 2 }: { kpis?: number; cards?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {kpis > 0 && (
        <div className="grid kpis" style={{ marginBottom: 14 }}>
          {Array.from({ length: kpis }).map((_, i) => (
            <div key={i} className="card skeleton skeleton-card" />
          ))}
        </div>
      )}
      <div className="grid two">
        {Array.from({ length: cards }).map((_, i) => (
          <section key={i} className="card">
            <div className="card-h"><span className="skeleton skeleton-text short" /></div>
            <div className="card-b skeleton-stack">
              <span className="skeleton skeleton-text" />
              <span className="skeleton skeleton-text" />
              <span className="skeleton skeleton-text short" />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
