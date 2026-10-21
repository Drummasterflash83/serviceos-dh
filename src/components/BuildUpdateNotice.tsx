import { useEffect, useState } from "react";
import { newerBuildAvailable, publishedBuildSha } from "@/lib/build-update";

const CHECK_INTERVAL_MS = 2 * 60 * 1000;

/** Keep an open tab from silently using an old frontend against new job APIs. */
export function BuildUpdateNotice() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (typeof __BUILD_SHA__ !== "string" || !/^[0-9a-f]{40}$/i.test(__BUILD_SHA__) ||
      !["production", "preview"].includes(__BUILD_ENV__)) return;
    let active = true;
    let checking = false;
    async function check() {
      if (document.hidden || checking || !active) return;
      checking = true;
      try {
        // This public document carries no tenant data and does not audit a
        // second read of whichever private screen happens to be open.
        const response = await fetch("/", { cache: "no-store", credentials: "same-origin" });
        if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) return;
        const latest = publishedBuildSha(await response.text());
        if (active && newerBuildAvailable(__BUILD_SHA__, latest)) setAvailable(true);
      } catch {
        // A connection failure must not interrupt the current job view.
      } finally {
        checking = false;
      }
    }
    const onVisible = () => { if (!document.hidden) void check(); };
    const timer = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    void check();
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!available) return null;
  return <aside role="status" aria-label="OpenFolk update available"
    className="fixed bottom-4 left-4 right-4 z-[100] mx-auto max-w-md rounded-2xl border border-[#dfd8e5] bg-[#faf9f6] p-4 text-[#25253a] shadow-xl sm:left-auto sm:right-6">
    <strong className="block text-base">A newer OpenFolk version is ready</strong>
    <p className="mt-1 text-sm text-[#706b7e]">Refresh to see the latest job information. Save any work on this page first.</p>
    <button type="button" className="mt-3 rounded-lg bg-[#514669] px-4 py-2 text-sm font-medium text-white"
      onClick={() => window.location.reload()}>Refresh now</button>
  </aside>;
}
