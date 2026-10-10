import React from "react";
import { createRoot } from "react-dom/client";
import { LearnCommusoftCustomers } from "../../src/components/client-portal/learn/LearnCommusoftCustomers";
import "../../src/styles/client-workspace.css";
import "../../src/styles/learn-launch.css";
import { tenant, actor } from "./fixture";
import { LearnCommusoftWork } from "../../src/components/client-portal/learn/LearnCommusoftWork";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <main
      className="cp-root op-embedded"
      style={{ display: "block", maxWidth: 1000, margin: "2rem auto", padding: "1rem" }}
    >
      <h1>LEARN business input review</h1>
      <p role="status">Synthetic UI only · network access disabled · no hosted data changed</p>
      {new URLSearchParams(location.search).get("view") === "work" ? (
        <LearnCommusoftWork
          tenantId={tenant}
          actorId={actor}
          canEdit={new URLSearchParams(location.search).get("role") !== "viewer"}
        />
      ) : (
        <LearnCommusoftCustomers
          tenantId={tenant}
          canEdit={new URLSearchParams(location.search).get("role") !== "viewer"}
        />
      )}
    </main>
  </React.StrictMode>,
);
