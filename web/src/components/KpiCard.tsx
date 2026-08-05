export default function KpiCard({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <section className="card kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="hint">{hint}</div>
    </section>
  );
}
