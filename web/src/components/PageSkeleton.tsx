// Placeholder while a page's queries load, so a slow fetch never reads as
// "zero clients". `rows` is the number of lines per card; pass an array when
// cards differ in height, so the page doesn't jump when the data arrives.
export default function PageSkeleton({ kpis = 0, cards = 2, rows = 3, fullWidth = false }: { kpis?: number; cards?: number; rows?: number | number[]; fullWidth?: boolean }) {
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
      <div className={fullWidth ? "grid" : "grid two"}>
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
