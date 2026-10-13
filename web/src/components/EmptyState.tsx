import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// Compact empty state: one line with an icon and an optional action, instead
// of a tall centered box that makes an empty card look broken.
export default function EmptyState({ icon: Icon, children, action }: { icon?: LucideIcon; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      {Icon && <Icon aria-hidden="true" />}
      <span>{children}</span>
      {action && <span className="empty-state-action">{action}</span>}
    </div>
  );
}
