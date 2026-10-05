export type OperatorModule = "home" | "receptionist" | "modules" | "invoices";
export const operatorModules = ["home", "receptionist", "modules", "invoices"] as const;
export function operatorModule(value: unknown): OperatorModule {
  if (value === "programme" || value === "outcomes") return "modules";
  return operatorModules.find((item) => item === value) ?? "home";
}
export function findOperatorTenant<T extends { tenant_id: string; slug: string | null }>(
  rows: T[],
  key: string,
) {
  // Resolve only against the server-authorised directory, never guess an ID from a name.
  return rows.find((row) => row.tenant_id === key || row.slug === key);
}
export interface OperatorHealth {
  receptionist: { name: string; launch_stage: string } | null;
  programme: boolean;
  open: number;
  urgent: number;
  failed: number;
  overdue: number;
  checkedAt: string;
}
export function healthSignal(health: OperatorHealth | null | undefined) {
  if (!health) return { tone: "waiting", label: "Awaiting health data" } as const;
  if (health.urgent > 0) return { tone: "urgent", label: "Urgent attention" } as const;
  if (health.failed > 0 || health.overdue > 0)
    return { tone: "urgent", label: "Delivery needs attention" } as const;
  if (health.open > 0) return { tone: "review", label: "Feedback to review" } as const;
  if (!health.receptionist && !health.programme)
    return { tone: "waiting", label: "Ready for module setup" } as const;
  return { tone: "clear", label: "No reported issues" } as const;
}
