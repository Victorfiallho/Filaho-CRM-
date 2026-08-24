import type { LucideIcon } from "lucide-react";

export default function KpiCard({ label, value, hint, icon: Icon }: { label: string; value: string | number; hint: string; icon?: LucideIcon }) {
  return (
    <section className="card kpi">
      {Icon && <div className="kpi-icon"><Icon /></div>}
      <div>
        <div className="label">{label}</div>
        <div className="value">{value}</div>
        <div className="hint">{hint}</div>
      </div>
    </section>
  );
}
