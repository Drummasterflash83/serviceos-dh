import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/lib/auth";
import { ReceptionistWorkspace } from "@/components/receptionist/ReceptionistWorkspace";
export const Route = createFileRoute("/receptionist")({
  validateSearch: (s: Record<string, unknown>) => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
    demo: s.demo === "1" || s.demo === 1 ? "1" : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Your receptionist · OpenFolk" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Page,
});
function Page() {
  const { tenant, demo } = Route.useSearch();
  if (import.meta.env.DEV && demo === "1") return <ReceptionistWorkspace demo tenantId={tenant} />;
  return (
    <RequireAuth>
      <ReceptionistWorkspace tenantId={tenant} />
    </RequireAuth>
  );
}
