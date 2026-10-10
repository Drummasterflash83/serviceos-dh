import * as React from "react";
import { OpenFolkWordmark } from "./OpenFolkWordmark";
import { publicHomeLoginHref } from "../lib/public-home-login";

// Shared by the app route and the zero-JavaScript public landing page.
export function OpenFolkHome({
  environment = typeof __BUILD_ENV__ === "undefined" ? undefined : __BUILD_ENV__,
}: { environment?: string }) {
  return (
    <main className="of-minimal-home">
      <div className="of-minimal-content">
        <h1>
          <span className="of-minimal-brand">
            <OpenFolkWordmark size="inherit" />
          </span>
          <span className="of-minimal-promise">Your business working better.</span>
        </h1>
        <a className="of-glass-login" href={publicHomeLoginHref(environment)}>
          Client Login
          <span className="of-login-arrow" aria-hidden="true">
            ↗
          </span>
        </a>
      </div>
    </main>
  );
}
