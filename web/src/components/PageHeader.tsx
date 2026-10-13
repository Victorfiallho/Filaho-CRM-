import type { ReactNode } from "react";

// The one page title per screen (cards below it don't repeat it): large
// medium-weight title, a short gray subtitle, and the page's main action on
// the right.
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
