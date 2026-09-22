import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/lib/auth";
import { ClientPortal } from "@/components/client-portal/ClientPortal";

export const Route = createFileRoute("/client")({
  head: () => ({
    meta: [
      { title: "Your programme · OpenFolk" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <ClientPortal />
    </RequireAuth>
  ),
});
