import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Building2,
  ChevronDown,
  Headphones,
  LayoutDashboard,
  Layers,
  Receipt,
  Menu,
  X,
  LogOut,
  Settings2,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { NAV_GROUPS, type WorkspaceSection } from "@/lib/openfolk-workspace-nav";
import type { OperatorModule } from "@/lib/operator-workspace";
import { BuildBadge } from "@/components/BuildBadge";
import "@/styles/operator-workspace.css";

const modules = [
  { key: "home", label: "Client overview", Icon: LayoutDashboard },
  { key: "receptionist", label: "AI receptionist", Icon: Headphones },
  { key: "modules", label: "Modules", Icon: Layers },
  { key: "invoices", label: "Invoices", Icon: Receipt },
] as const;

export function OperatorShell({
  company,
  tenantId,
  module = "home",
  onModule,
  section,
  onSection,
  children,
  pageTitle,
}: {
  company?: string;
  tenantId?: string;
  module?: OperatorModule;
  onModule?: (module: OperatorModule) => void;
  section?: WorkspaceSection;
  onSection?: (section: WorkspaceSection) => void;
  children: ReactNode;
  pageTitle?: string;
}) {
  const { user, signOut } = useAuth();
  const [menu, setMenu] = useState(false);
  const [future, setFuture] = useState(!!section);
  useEffect(() => {
    if (section) setFuture(true);
  }, [section]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", close);
    };
  }, [menu]);
  return (
    <div className="op-root">
      <a href="#operator-main" className="op-skip">
        Skip to content
      </a>
      <aside className={`op-sidebar${menu ? " is-open" : ""}`}>
        <Link to="/openfolk" className="op-brand" aria-label="OpenFolk — all clients">
          <span>open</span>folk
        </Link>
        <button
          className="op-menu-toggle"
          aria-label={menu ? "Close menu" : "Open menu"}
          aria-expanded={menu}
          aria-controls="operator-navigation"
          onClick={() => setMenu(!menu)}
        >
          {menu ? <X /> : <Menu />}
        </button>
        <div id="operator-navigation" className="op-navigation">
          <Link to="/openfolk" className="op-all" onClick={() => setMenu(false)}>
            <Building2 size={18} /> All clients
          </Link>
          {company && (
            <>
              <p className="op-company">{company}</p>
              <nav aria-label="Client modules">
                {modules.map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    aria-current={!pageTitle && !section && module === key ? "page" : undefined}
                    onClick={() => {
                      onModule?.(key);
                      setMenu(false);
                    }}
                  >
                    <Icon size={19} />
                    {label}
                  </button>
                ))}
              </nav>
            </>
          )}
          <p className="op-company">APIs</p>
          <Link
            to="/openfolk/apis"
            search={{ tenant: tenantId }}
            className="op-all"
            onClick={() => setMenu(false)}
          >
            <Wallet size={18} /> Accounts & costs
          </Link>
          {company && (
            <div className="op-future">
              <button aria-expanded={future} onClick={() => setFuture(!future)}>
                <Settings2 size={18} /> Future tools{" "}
                <ChevronDown size={16} className={future ? "is-open" : ""} />
              </button>
              {future && (
                <nav aria-label="Future tools">
                  {NAV_GROUPS.map((group) => (
                    <div key={group.title}>
                      <p>{group.title}</p>
                      {group.items.map((item) => (
                        <button
                          key={item.key}
                          aria-current={section === item.section ? "page" : undefined}
                          onClick={() => {
                            onSection?.(item.section);
                            setMenu(false);
                          }}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </nav>
              )}
            </div>
          )}
          <footer>
            {tenantId && (
              <Link to="/client" search={{ tenant: tenantId, section: "home" }}>
                <ArrowLeft size={17} /> Client view
              </Link>
            )}
            <button onClick={() => void signOut()}>
              <LogOut size={17} /> Sign out
            </button>
            <details>
              <summary>About this build</summary>
              <BuildBadge />
            </details>
          </footer>
        </div>
      </aside>
      <div className="op-main-column">
        <header className="op-topbar">
          <span>
            OpenFolk <span aria-hidden="true">/</span> {company ?? pageTitle ?? "All clients"}
            {company && pageTitle && (
              <>
                {" "}
                <span aria-hidden="true">/</span> {pageTitle}
              </>
            )}
          </span>
          <small>{user?.email}</small>
        </header>
        <main id="operator-main" className="op-content">
          {children}
        </main>
      </div>
    </div>
  );
}
