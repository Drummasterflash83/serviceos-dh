/**
 * AppChrome — the shared ServiceOS application shell frame (sidebar + header +
 * responsive mobile drawer + brand + logout footer + live-call surface).
 *
 * Extracted from the inlined `/app` shell so `/app` and `/marketing` share ONE
 * chrome implementation instead of duplicating the sidebar/header markup into a
 * second route (see docs/product/marketing-crm/IMPLEMENTATION_LEDGER.md, decision
 * 1). Callers supply their own navigation via the `nav` render-prop (so `/app`
 * passes its hash-view buttons and `/marketing` passes its section links) and the
 * main content as `children`. Everything else — the frame, the mobile drawer
 * state, auth-bound logout, the tenant footer — lives here, once.
 *
 * Purely presentational + auth chrome; it performs no data reads of its own.
 */
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Menu, LogOut } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { LiveCallCard } from "@/components/app/LiveCallCard";
import dhIcon from "@/assets/dh-icon-blackwhite.png.asset.json";

export interface AppChromeProps {
  /** Header title (the current surface/section name). */
  title: string;
  /** Sidebar navigation. `closeNav` closes the mobile drawer after a selection. */
  nav: (opts: { closeNav: () => void }) => ReactNode;
  /** Main content. */
  children: ReactNode;
  /** Tenant label shown in the footer + avatar initials. Defaults preserve /app. */
  tenantLabel?: string;
  tenantInitials?: string;
}

export function AppChrome({
  title,
  nav,
  children,
  tenantLabel = "Drummond Heating",
  tenantInitials = "DH",
}: AppChromeProps) {
  const [navOpen, setNavOpen] = useState(false);
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const closeNav = () => setNavOpen(false);

  return (
    <div className="flex min-h-screen bg-surface-alt text-foreground">
      {/* Real-time live call surface — floats for the assigned logged-in user only */}
      <LiveCallCard />
      {/* Mobile nav overlay */}
      {navOpen && <div className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={closeNav} />}
      {/* Sidebar — static on desktop, slide-over drawer on mobile */}
      <aside
        className={cn(
          "z-50 h-screen w-64 shrink-0 flex-col border-r border-hairline bg-white md:sticky md:top-0 md:flex",
          navOpen ? "fixed inset-y-0 left-0 flex" : "hidden md:flex",
        )}
      >
        <Link
          to="/"
          className="flex items-center gap-2 border-b border-hairline px-5 py-4 text-display text-[15px] font-bold"
        >
          <img src={dhIcon.url} alt="Drummonds" className="h-6 w-6 rounded-md object-contain" />
          ServiceOS
        </Link>

        <nav className="flex-1 overflow-y-auto p-3">{nav({ closeNav })}</nav>

        <div className="border-t border-hairline p-4">
          <div className="rounded-xl bg-surface-alt p-3">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
              Secure workspace
            </div>
            <div className="mt-2 text-xs text-muted-foreground">{tenantLabel}</div>
          </div>
          <button
            onClick={async () => {
              await signOut();
              navigate({ to: "/login" });
            }}
            className="mt-3 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-surface-alt hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-hairline bg-white/80 px-6 py-3 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setNavOpen(true)}
              className="grid h-9 w-9 place-items-center rounded-full border border-hairline md:hidden"
              aria-label="Open navigation"
            >
              <Menu className="h-4 w-4 text-muted-foreground" />
            </button>
            <div className="text-display text-lg font-semibold capitalize">{title}</div>
            <span className="hidden text-xs text-muted-foreground md:inline">·</span>
            <span className="hidden font-mono text-xs text-muted-foreground md:inline">
              {new Date().toLocaleString([], {
                weekday: "long",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-foreground text-xs font-semibold text-background">
              {tenantInitials}
            </div>
          </div>
        </header>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
