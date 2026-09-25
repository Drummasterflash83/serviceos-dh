import { clientDisplayName, hasDrummondsBrand } from "@/lib/client-brand";
import "@/styles/workspace-navigation.css";

export function ClientHeaderBrand({ company }: { company: string }) {
  return (
    <span className="of-client-brand">
      {hasDrummondsBrand(company) && <span className="of-drummonds-emblem" aria-hidden="true" />}
      <span>{clientDisplayName(company)}</span>
    </span>
  );
}
