/**
 * LiveCallCard — the first real-time operational surface. It floats over the app
 * for the logged-in user and shows the live call assigned to THEM (via their VoIP
 * extension mapping). It never shows another user's calls: the reader filters
 * `assigned_user_id = current user` and RLS enforces tenant isolation.
 *
 * v1 is evidence-only: it shows the caller number, match status/confidence and the
 * evidence used — no fake customer match. Confirm/Reject/Dismiss are real; Create/
 * Link are honest placeholders until the customer-card builder lands. The layout is
 * provider-agnostic so future Commusoft job/site/context can slot in.
 */

import { useCallback, useEffect, useState } from "react";
import { PhoneIncoming, PhoneCall, X, Check, Ban, UserPlus, Link2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import {
  listMyLiveCallSessions,
  subscribeMyLiveCallSessions,
  updateLiveCallSessionMatch,
  dismissLiveCallSession,
  type LiveCallSession,
} from "@/lib/live-calls";

function matchTone(status: string): string {
  switch (status) {
    case "confirmed":
    case "likely":
      return "border-success/20 bg-success/10 text-success";
    case "possible":
      return "border-warning/20 bg-warning/10 text-warning";
    case "rejected":
      return "border-destructive/20 bg-destructive/10 text-destructive";
    default:
      return "border-hairline bg-surface-alt text-muted-foreground";
  }
}

export function LiveCallCard() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<LiveCallSession[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await listMyLiveCallSessions();
    if (res.ok) setSessions(res.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime push + a visibility-gated poll fallback (in case realtime is off).
  useEffect(() => {
    if (!user?.id) return;
    const unsub = subscribeMyLiveCallSessions(user.id, () => void load());
    const poll = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void load();
    }, 6000);
    return () => {
      unsub();
      clearInterval(poll);
    };
  }, [user?.id, load]);

  const session = sessions[0];
  if (!session) return null;

  async function act(action: "confirm" | "reject" | "dismiss") {
    if (!session) return;
    setBusy(action);
    if (action === "dismiss") await dismissLiveCallSession(session.id);
    else await updateLiveCallSessionMatch(session.id, { action });
    setBusy(null);
    await load();
  }

  const ringing = session.status === "ringing";
  const known = session.match_status !== "unmatched" && session.match_status !== "rejected";
  const evidence = Array.isArray(session.evidence) ? session.evidence : [];

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[22rem] max-w-[calc(100vw-2rem)]">
      <div className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-hairline bg-surface-alt/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "grid h-8 w-8 place-items-center rounded-lg",
                ringing ? "bg-accent/10 text-accent" : "bg-success/10 text-success",
              )}
            >
              {ringing ? (
                <PhoneIncoming className="h-4 w-4 animate-pulse" />
              ) : (
                <PhoneCall className="h-4 w-4" />
              )}
            </span>
            <div>
              <div className="text-xs font-semibold text-foreground">
                {ringing ? "Incoming call" : "Live call"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Ext {session.extension ?? "—"} · {session.status}
              </div>
            </div>
          </div>
          <button
            onClick={() => void act("dismiss")}
            disabled={busy !== null}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-surface-alt hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Caller + match */}
        <div className="px-4 py-3">
          <div className="text-display text-lg font-bold">
            {session.caller_number ?? "Unknown number"}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize",
                matchTone(session.match_status),
              )}
            >
              {session.match_status}
            </span>
            {session.confidence != null && (
              <span className="text-[11px] text-muted-foreground">
                {Math.round(session.confidence)}% confidence
              </span>
            )}
          </div>

          {/* Likely customer / company — placeholders until the card builder lands */}
          <div className="mt-3 rounded-lg border border-hairline bg-surface-alt/40 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Customer
            </div>
            <div className="text-xs text-foreground">
              {session.matched_person_id
                ? "Linked customer"
                : known
                  ? "Known number — not yet linked to a customer"
                  : "Unknown caller"}
            </div>
          </div>

          {/* Evidence */}
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Evidence
            </div>
            {evidence.length === 0 ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                No prior history for this number.
              </p>
            ) : (
              <ul className="mt-1 space-y-1">
                {evidence.map((e, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-foreground">
                    <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-accent" />
                    <span>{e.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-2 border-t border-hairline p-3">
          <button
            onClick={() => void act("confirm")}
            disabled={busy !== null || !known}
            title={known ? "Confirm this match" : "Nothing to confirm yet"}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-success/30 bg-success/10 px-2 py-1.5 text-xs font-medium text-success transition hover:bg-success/20 disabled:opacity-40"
          >
            <Check className="h-3.5 w-3.5" />
            Confirm
          </button>
          <button
            onClick={() => void act("reject")}
            disabled={busy !== null || !known}
            title={known ? "Reject this match" : "Nothing to reject yet"}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs font-medium text-destructive transition hover:bg-destructive/20 disabled:opacity-40"
          >
            <Ban className="h-3.5 w-3.5" />
            Reject
          </button>
          <button
            disabled
            title="Create a customer card — coming soon"
            className="inline-flex cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border border-hairline px-2 py-1.5 text-xs font-medium text-muted-foreground/70"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Create card
          </button>
          <button
            disabled
            title="Link to an existing customer — coming soon"
            className="inline-flex cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border border-hairline px-2 py-1.5 text-xs font-medium text-muted-foreground/70"
          >
            <Link2 className="h-3.5 w-3.5" />
            Link existing
          </button>
        </div>
      </div>
    </div>
  );
}
