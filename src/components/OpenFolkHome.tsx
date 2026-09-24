import * as React from "react";

// Shared by the app route and the zero-JavaScript public landing page.
export function OpenFolkHome() {
  return (
    <main className="of-minimal-home">
      <div className="of-minimal-content">
        <h1>
          <span className="of-minimal-brand">
            open<span className="of-minimal-colon">folk</span>
          </span>
          <span className="of-minimal-promise">Your business working better.</span>
        </h1>
        <a className="of-glass-login" href="https://app.openfolk.ai/login?redirect=%2Fclient">
          Client Login
          <span className="of-login-arrow" aria-hidden="true">
            ↗
          </span>
        </a>
      </div>
    </main>
  );
}
