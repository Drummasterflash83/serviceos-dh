import { createFileRoute } from "@tanstack/react-router";
import "@/styles/openfolk-home.css";
import { OpenFolkHome } from "@/components/OpenFolkHome";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "OpenFolk: Your business working better." },
      { name: "description", content: "OpenFolk: Your business working better." },
      { property: "og:title", content: "OpenFolk: Your business working better." },
      { property: "og:description", content: "OpenFolk: Your business working better." },
    ],
  }),
  component: OpenFolkHome,
});
