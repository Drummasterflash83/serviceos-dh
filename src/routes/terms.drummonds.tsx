import { createFileRoute } from "@tanstack/react-router";
import { DrummondsPolicy } from "@/components/legal/DrummondsPolicy";
import document from "@/content/legal/drummonds-terms.json";

export const Route = createFileRoute("/terms/drummonds")({
  head: () => ({
    meta: [
      { title: "Drummonds ServiceOS · Authorised-user terms" },
      {
        name: "description",
        content: "Authorised-user terms for Drummonds’ authorised use of OpenFolk ServiceOS.",
      },
    ],
  }),
  component: () => <DrummondsPolicy document={document} />,
});
