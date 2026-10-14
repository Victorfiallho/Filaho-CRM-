import type { ReactNode } from "react";

// The page's only title (cards don't repeat it), a short subtitle and the
// page's main action on the right.
export default function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        <h2>{title}</h2>
        <p className="page-header-sub">{subtitle || " "}</p>
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}
