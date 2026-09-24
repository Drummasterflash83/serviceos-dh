import { createFileRoute } from "@tanstack/react-router";
import "@/styles/openfolk-home.css";

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

function OpenFolkHome() {
  return (
    <main className="of-minimal-home">
      <div className="of-minimal-content">
        <h1>
          <span className="of-minimal-brand">
            OpenFolk<span className="of-minimal-colon">:</span>
          </span>
          <span className="of-minimal-promise">Your business working better.</span>
        </h1>
        <a className="of-glass-login" href="https://app.openfolk.ai/login?redirect=%2Fclient">
          Client Login
        </a>
      </div>
    </main>
  );
}
