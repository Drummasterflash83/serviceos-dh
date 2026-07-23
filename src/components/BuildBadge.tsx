import { supabaseConfig } from "@/lib/supabase";

/**
 * Build / version indicator for OpenFolk operators.
 *
 * Surfaces the deployed frontend commit, build time, environment and the Supabase
 * project the client is wired to — so a stale-deployment (old frontend against a newer
 * backend) is diagnosable at a glance. Rendered only on operator surfaces (`/openfolk`),
 * which are auth-gated and never appear in tenant navigation, so ordinary tenant users
 * do not see it. The values are non-secret build metadata; the Supabase project ref is
 * already present in the client bundle.
 */
function projectRef(url: string): string {
  const hosted = url.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  if (hosted) return hosted[1];
  if (/127\.0\.0\.1|localhost/i.test(url)) return "local";
  return url ? "custom" : "unset";
}

export function BuildBadge({ className = "" }: { className?: string }) {
  const sha = (typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : "unknown").slice(0, 7);
  const builtAt = typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : "unknown";
  const env = typeof __BUILD_ENV__ === "string" ? __BUILD_ENV__ : "unknown";
  const ref = projectRef(supabaseConfig.url);

  return (
    <div
      data-testid="build-badge"
      title="OpenFolk build / version indicator"
      className={`mt-8 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hairline pt-3 font-mono text-[10px] leading-none text-muted-foreground/70 ${className}`}
    >
      <span>build {sha}</span>
      <span aria-hidden>·</span>
      <span>{builtAt}</span>
      <span aria-hidden>·</span>
      <span>env {env}</span>
      <span aria-hidden>·</span>
      <span>supabase {ref}</span>
    </div>
  );
}
