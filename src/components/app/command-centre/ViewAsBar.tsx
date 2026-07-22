/**
 * ViewAsBar — Tenant-Superadmin View-As entry + the persistent read-only banner.
 *
 * Entry is offered only to effective Tenant Superadmins (authority resolved server-side and
 * reflected in projection.user.authority). The subject list is read RLS-scoped from
 * team_members (tenant-local). Opening/exiting a context goes through the view-as Edge
 * Function; this component never fabricates a subject or bypasses the server. While a
 * context is active the banner is persistent and the app is read-only (the server also
 * rejects mutations — see useCommandCentre.transition and work-transition).
 */
import { useEffect, useState } from "react";
import { Eye, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import type { WorkProjection } from "@/lib/command-work";
import type { ViewAsState } from "./useCommandCentre";

interface Member {
  profile_id: string;
  display_name: string;
  formal_role: string | null;
}
interface Props {
  projection: WorkProjection | null;
  viewAs: ViewAsState | null;
  onEnter: (subjectProfileId: string, label: string) => Promise<string | null>;
  onExit: () => void;
}

export function ViewAsBar({ projection, viewAs, onEnter, onExit }: Props) {
  const { profile } = useAuth();
  const actorName = profile?.full_name ?? "you";
  const isSuperadmin = !!projection?.user.authority.includes("tenant.superadmin");
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isSuperadmin || viewAs) return;
    void (async () => {
      try {
        const { data } = await getSupabaseClient()
          .from("team_members")
          .select("profile_id, display_name, formal_role")
          .not("profile_id", "is", null)
          .is("effective_to", null);
        setMembers((data as Member[] | null) ?? []);
      } catch {
        setMembers([]);
      }
    })();
  }, [isSuperadmin, viewAs]);

  // Active read-only banner — persistent, immediate exit.
  if (viewAs) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px]">
        <Eye className="h-3.5 w-3.5 text-amber-600" />
        <span className="font-medium text-amber-800">Viewing as {viewAs.subjectLabel}.</span>
        <span className="text-amber-700/90">
          You remain signed in as {actorName}, Tenant Superadmin. This view is read-only.
        </span>
        <span className="text-amber-700/70">
          · expires {new Date(viewAs.expiresAt).toLocaleTimeString()}
        </span>
        <button
          onClick={onExit}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-amber-600/40 bg-white px-2 py-1 font-medium text-amber-800 hover:bg-amber-50"
        >
          <X className="h-3 w-3" /> Exit View-As
        </button>
      </div>
    );
  }

  if (!isSuperadmin) return null;

  // Entry control (Superadmin only).
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-white px-3 py-2 text-[12px]">
      <Eye className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="font-medium text-muted-foreground">View as</span>
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="rounded-md border border-hairline bg-surface-alt/40 px-2 py-1 text-[12px]"
        aria-label="Select a user to view as"
      >
        <option value="">Select a user…</option>
        {members.map((m) => (
          <option
            key={m.profile_id}
            value={`${m.profile_id}|${m.display_name}${m.formal_role ? " — " + m.formal_role : ""}`}
          >
            {m.display_name}
            {m.formal_role ? ` — ${m.formal_role}` : ""}
          </option>
        ))}
      </select>
      <button
        disabled={!selected}
        onClick={async () => {
          const [id, label] = selected.split("|");
          const e = await onEnter(id, label ?? "user");
          setErr(e);
        }}
        className="rounded-md border border-accent bg-accent/10 px-2 py-1 font-medium text-accent disabled:opacity-40"
      >
        Enter (read-only)
      </button>
      {err && <span className="text-destructive">{err}</span>}
      <span className="text-[11px] text-muted-foreground">Supervised test mode — Preview</span>
    </div>
  );
}
