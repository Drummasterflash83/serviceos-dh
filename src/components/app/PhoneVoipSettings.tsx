/**
 * Settings → Phone / VoIP — tenant telephony calibration. Shows the connected provider
 * and its real capabilities, the discovered endpoint inventory with evidence-based
 * staff suggestions, and lets an admin confirm / reject / mark-shared each mapping.
 * Suggestions are never auto-applied; unmapped endpoints stay honestly unresolved.
 */

import { useCallback, useEffect, useState } from "react";
import { Phone, Loader2, Check, X, Users, AlertTriangle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getTelephonyInventory,
  confirmEndpointMapping,
  rejectEndpoint,
  setEndpointUnknown,
  type TelephonyInventory,
  type TelephonyEndpoint,
  type TenantPerson,
  type CapabilityState,
} from "@/lib/telephony";
import type { ApiResult } from "@/lib/types";

/** Search + select ANY active tenant person to assign/replace a mapping. */
function PersonPicker({
  people,
  disabled,
  onSelect,
}: {
  people: TenantPerson[];
  disabled: boolean;
  onSelect: (personId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const matches = q
    ? people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 6)
    : [];
  return (
    <div className="relative mt-1.5">
      <input
        value={q}
        disabled={disabled}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Assign another person…"
        className="w-full rounded-lg border border-hairline bg-white px-2.5 py-1 text-[11px] outline-none focus:border-accent disabled:opacity-50"
      />
      {open && matches.length > 0 && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-hairline bg-white shadow-sm">
          {matches.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setQ("");
                setOpen(false);
                onSelect(p.id);
              }}
              className="block w-full px-2.5 py-1 text-left text-[11px] hover:bg-surface-alt"
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const CAP_TONE: Record<CapabilityState, string> = {
  supported: "bg-success/10 text-success border-success/20",
  manual: "bg-warning/10 text-warning border-warning/20",
  planned: "bg-accent/10 text-accent border-accent/20",
  unavailable: "bg-surface-alt text-muted-foreground border-hairline",
};

function StatusChip({ endpoint }: { endpoint: TelephonyEndpoint }) {
  const m = endpoint.mapping;
  if (m?.status === "confirmed" && m.active)
    return (
      <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
        Confirmed
      </span>
    );
  if (m?.is_shared_device)
    return (
      <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
        Shared
      </span>
    );
  const s = endpoint.suggestion.status;
  const tone =
    s === "suggested"
      ? "bg-accent/10 text-accent"
      : s === "conflicted" || s === "shared"
        ? "bg-warning/10 text-warning"
        : "bg-surface-alt text-muted-foreground";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium capitalize", tone)}>
      {s}
    </span>
  );
}

export function PhoneVoipSettings() {
  const [inv, setInv] = useState<ApiResult<TelephonyInventory> | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setInv(await getTelephonyInventory());
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<ApiResult<unknown>>, ref: string) {
    setBusy(ref);
    await fn();
    setBusy(null);
    await load();
  }

  const data = inv && inv.ok ? inv.data : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Phone className="h-4 w-4 text-accent" />
        <div className="text-display text-xl font-semibold">Phone / VoIP</div>
        <button
          onClick={load}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface-alt disabled:opacity-50"
        >
          <RotateCcw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
        </button>
      </div>

      {inv && !inv.ok && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" /> {inv.error.message}
        </div>
      )}
      {loading && !data && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading telephony inventory…
        </div>
      )}

      {data && (
        <>
          {/* Connection + capabilities */}
          <div className="rounded-2xl border border-hairline bg-white p-5">
            <div className="text-sm font-semibold">{data.capabilities.label}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {data.counts.endpoints} endpoints · {data.counts.confirmed} confirmed ·{" "}
              {data.counts.suggested} suggested · {data.counts.conflicts} conflicts
            </div>
            <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {Object.entries(data.capabilities.capabilities).map(([k, v]) => (
                <span
                  key={k}
                  className={cn(
                    "flex items-center justify-between gap-1 rounded-lg border px-2 py-1 text-[10px]",
                    CAP_TONE[v],
                  )}
                >
                  <span className="capitalize">{k.replace(/_/g, " ")}</span>
                  <span className="font-medium capitalize">{v}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Endpoint inventory */}
          <div className="rounded-2xl border border-hairline bg-white p-5">
            <div className="text-sm font-semibold">Endpoints &amp; staff mapping</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Suggestions come from call metadata and spoken introductions. Nothing is confirmed
              automatically — an unmapped endpoint stays “Unknown team member”.
            </p>
            <div className="mt-3 space-y-2">
              {data.endpoints.length === 0 && (
                <div className="text-xs text-muted-foreground">No endpoints discovered yet.</div>
              )}
              {data.endpoints.map((e) => {
                const sug = e.suggestion;
                const confirmedName = e.mapping?.person_name;
                return (
                  <div
                    key={e.endpoint_ref}
                    className="rounded-xl border border-hairline bg-surface-alt/40 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs">{e.endpoint_masked}</span>
                      <StatusChip endpoint={e} />
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {e.inbound} inbound · {e.outbound} outbound
                      {e.last_seen ? ` · last ${new Date(e.last_seen).toLocaleDateString()}` : ""}
                    </div>

                    {confirmedName ? (
                      <div className="mt-2 text-xs font-medium">
                        → {confirmedName}
                        {e.mapping?.role ? ` (${e.mapping.role})` : ""}
                      </div>
                    ) : sug.status === "suggested" && sug.suggestedName ? (
                      <div className="mt-2">
                        <div className="text-xs">
                          Suggested: <span className="font-medium">{sug.suggestedName}</span>{" "}
                          <span className="text-muted-foreground">
                            ({Math.round(sug.confidence * 100)}%)
                          </span>
                        </div>
                        <ul className="mt-1 list-disc pl-4 text-[10px] text-muted-foreground">
                          {sug.evidence.map((ev, i) => (
                            <li key={i}>{ev}</li>
                          ))}
                        </ul>
                      </div>
                    ) : sug.status === "conflicted" || sug.status === "shared" ? (
                      <div className="mt-2 flex items-start gap-1.5 text-[11px] text-warning">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>
                          {sug.status === "shared"
                            ? "Likely shared handset"
                            : "Conflicting introductions"}
                          {sug.conflicts.length ? `: ${sug.conflicts.join(", ")}` : ""}
                        </span>
                      </div>
                    ) : (
                      <div className="mt-2 text-[11px] text-muted-foreground">
                        No confident suggestion — leave as unknown.
                      </div>
                    )}

                    {/* Actions */}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {sug.status === "suggested" && sug.suggestedPersonId && !confirmedName && (
                        <button
                          disabled={busy === e.endpoint_ref}
                          onClick={() =>
                            act(
                              () =>
                                confirmEndpointMapping({
                                  endpointRef: e.endpoint_ref,
                                  personNodeId: sug.suggestedPersonId,
                                }),
                              e.endpoint_ref,
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-[11px] font-medium text-success hover:bg-success/20 disabled:opacity-50"
                        >
                          <Check className="h-3 w-3" /> Confirm {sug.suggestedName}
                        </button>
                      )}
                      <button
                        disabled={busy === e.endpoint_ref}
                        onClick={() =>
                          act(
                            () =>
                              confirmEndpointMapping({
                                endpointRef: e.endpoint_ref,
                                personNodeId: null,
                                isSharedDevice: true,
                              }),
                            e.endpoint_ref,
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-full border border-hairline px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-white disabled:opacity-50"
                      >
                        <Users className="h-3 w-3" /> Shared
                      </button>
                      <button
                        disabled={busy === e.endpoint_ref}
                        onClick={() => act(() => rejectEndpoint(e.endpoint_ref), e.endpoint_ref)}
                        className="inline-flex items-center gap-1 rounded-full border border-hairline px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-white disabled:opacity-50"
                      >
                        <X className="h-3 w-3" /> Reject
                      </button>
                      <button
                        disabled={busy === e.endpoint_ref}
                        onClick={() =>
                          act(() => setEndpointUnknown(e.endpoint_ref), e.endpoint_ref)
                        }
                        className="inline-flex items-center gap-1 rounded-full border border-hairline px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-white disabled:opacity-50"
                      >
                        Unknown
                      </button>
                      {busy === e.endpoint_ref && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      )}
                    </div>

                    {/* Assign / replace with any active tenant person */}
                    <PersonPicker
                      people={data.people}
                      disabled={busy === e.endpoint_ref}
                      onSelect={(personId) =>
                        act(
                          () =>
                            confirmEndpointMapping({
                              endpointRef: e.endpoint_ref,
                              personNodeId: personId,
                            }),
                          e.endpoint_ref,
                        )
                      }
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Pickup / transfer metadata is not exposed by this provider (see capabilities). Manual{" "}
            <code>*21#</code> pickup can distort attribution — configured pickup/BLF keys are
            recommended for cleaner metadata. Phone numbers are masked here by design.
          </p>
        </>
      )}
    </div>
  );
}
