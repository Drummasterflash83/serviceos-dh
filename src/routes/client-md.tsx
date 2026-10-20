import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/lib/auth";
import { MdClientPreview } from "@/components/client-portal/MdClientPreview";

export const Route = createFileRoute("/client-md")({
  head: () => ({ meta: [
    { title: "Drummonds MD view · OpenFolk" },
    { name: "robots", content: "noindex, nofollow" },
    { name: "theme-color", content: "#242337" },
  ] }),
  component: () => <RequireAuth><MdClientPreview /></RequireAuth>,
});
