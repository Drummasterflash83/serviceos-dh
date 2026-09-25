import { ChevronDown, Home, Headphones, Layers, Receipt } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { clientWorkspaceHref, receptionistHref } from "@/lib/client-workspace-nav";
import "@/styles/workspace-navigation.css";

/** Navigation only: no tenant switching or impersonation is performed here. */
export function WorkspaceMenu({
  company,
  tenant,
  active,
}: {
  company: string;
  tenant?: string;
  active: "home" | "receptionist" | "programme";
}) {
  const isDrummonds = company === "Drummond Heating";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="of-workspace-switch" aria-label={`${company} workspace menu`}>
          <span
            className={`of-workspace-initial${isDrummonds ? " is-drummonds" : ""}`}
            aria-hidden="true"
          >
            {isDrummonds ? <span className="of-drummonds-emblem" /> : company.slice(0, 1)}
          </span>
          <span>
            <strong>{company}</strong>
            <small>Your workspace</small>
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="of-workspace-menu">
        <DropdownMenuItem asChild>
          <a
            href={clientWorkspaceHref(tenant)}
            aria-current={active === "home" ? "page" : undefined}
          >
            <Home size={17} /> Workspace home
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a
            href={receptionistHref(tenant)}
            aria-current={active === "receptionist" ? "page" : undefined}
          >
            <Headphones size={17} /> AI Receptionist
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={clientWorkspaceHref(tenant, "overview")}>
            <Layers size={17} /> Your programme
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={clientWorkspaceHref(tenant, "investment")}>
            <Receipt size={17} /> Invoices & delivery
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
