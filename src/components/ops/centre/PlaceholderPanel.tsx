/**
 * PlaceholderPanel — a consistent "planned, not built yet" panel for sections
 * without an implementation. Keeps the architecture visible without faking data.
 */

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function PlaceholderPanel({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-hairline bg-white p-8 text-center">
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-surface-alt">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </span>
      <div className="text-display mt-4 text-lg font-semibold">{title}</div>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      <span className="mt-4 inline-flex rounded-full border border-hairline bg-surface-alt px-3 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Planned
      </span>
      {children && <div className="mt-6 text-left">{children}</div>}
    </div>
  );
}
