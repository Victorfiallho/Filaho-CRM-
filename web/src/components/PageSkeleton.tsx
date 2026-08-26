// Loading placeholder for pages whose content is entirely derived from one or
// more react-query hooks. Shown while those queries are still in flight so a
// slow first fetch (or a company switch) never reads as "you have zero
// leads/jobs/clients" — the .skeleton* shimmer classes already existed in
// styles.css for exactly this, just weren't wired to any page yet.
//
// `rows` controls how many skeleton lines each card gets. Pass an array (one
// count per card) when the page's cards are meaningfully different heights —
// e.g. Dashboard's 7-stage "Pipeline by stage" next to its 5-row "Recent
// activity" — so the skeleton's height roughly matches the real content's.
// A flat number (or the default) repeats the same count for every card.
// Getting this close matters: a skeleton much shorter than what replaces it
// makes the whole page jump/reflow the instant the fetch resolves, which
// reads as an abrupt cut no matter how the swap itself is eased.
export default function PageSkeleton({ kpis = 0, cards = 2, rows = 3 }: { kpis?: number; cards?: number; rows?: number | number[] }) {
  const rowCounts = Array.isArray(rows) ? rows : Array.from({ length: cards }, () => rows);
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
        {rowCounts.map((n, i) => (
          <section key={i} className="card">
            <div className="card-h"><span className="skeleton skeleton-text short" /></div>
            <div className="card-b skeleton-stack">
              {Array.from({ length: n }).map((_, j) => (
                <span key={j} className="skeleton skeleton-text" />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
