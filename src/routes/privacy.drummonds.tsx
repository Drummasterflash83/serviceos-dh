import { createFileRoute } from "@tanstack/react-router";
import { DrummondsPolicy } from "@/components/legal/DrummondsPolicy";
import document from "@/content/legal/drummonds-privacy.json";

export const Route = createFileRoute("/privacy/drummonds")({
  head: () => ({
    meta: [
      { title: "Drummonds ServiceOS · Privacy notice" },
      {
        name: "description",
        content: "Privacy notice for Drummonds’ authorised use of OpenFolk ServiceOS.",
      },
    ],
  }),
  component: () => <DrummondsPolicy document={document} />,
});
