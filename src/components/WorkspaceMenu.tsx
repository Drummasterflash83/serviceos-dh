import { ChevronDown, Home, Headphones, Layers, Receipt } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { clientWorkspaceHref, receptionistHref } from "@/lib/client-workspace-nav";
import { clientDisplayName, hasDrummondsBrand } from "@/lib/client-brand";
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
  const isDrummonds = hasDrummondsBrand(company);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={`of-workspace-switch${isDrummonds ? " is-drummonds" : ""}`}
          aria-label={`${clientDisplayName(company)} workspace menu`}
        >
          <Home size={19} aria-hidden="true" />
          <span className="of-workspace-label">Your Workspace</span>
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
