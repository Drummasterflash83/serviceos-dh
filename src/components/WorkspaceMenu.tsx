import { ChevronDown, Home, Headphones, Layers, Receipt } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
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
          <Link
            to="/client"
            search={{ tenant, section: "home" }}
            aria-current={active === "home" ? "page" : undefined}
          >
            <Home size={17} /> Workspace home
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link
            to="/client"
            search={{ tenant, section: "receptionist", view: "today" }}
            aria-current={active === "receptionist" ? "page" : undefined}
          >
            <Headphones size={17} /> AI Receptionist
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/client" search={{ tenant, section: "overview" }}>
            <Layers size={17} /> Your programme
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/client" search={{ tenant, section: "investment" }}>
            <Receipt size={17} /> Invoices & delivery
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
