import { useEffect, useState } from "react";
import { Mail, Phone, MessageSquare, AlertTriangle, ChevronRight } from "lucide-react";
import { listInteractions, type Interaction } from "@/lib/interactions";
import { cn } from "@/lib/utils";
import { CallDetail } from "./CallDetail";

type Channel = "phone_call" | "email_message";

const when = (value: string) =>
  new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export function Communications() {
  const [channel, setChannel] = useState<Channel>("phone_call");
  const [rows, setRows] = useState<Interaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCall, setSelectedCall] = useState<string | null>(null);

  // Deep-link: a Command Centre call story stashes the target call id, then routes
  // here. Open that call detail once on mount, then clear the hint.
  useEffect(() => {
    try {
      const pending = window.sessionStorage.getItem("serviceos:openCall");
      if (pending) {
        window.sessionStorage.removeItem("serviceos:openCall");
        setChannel("phone_call");
        setSelectedCall(pending);
      }
    } catch {
      /* ignore storage errors */
    }
  }, []);

  useEffect(() => {
    let active = true;
    setRows(null);
    setError(null);
    void listInteractions({ interactionType: channel, limit: 200 }).then((result) => {
      if (!active) return;
      if (result.ok) setRows(result.data);
      else {
        setRows([]);
        setError(result.error.message);
      }
    });
    return () => {
      active = false;
    };
  }, [channel]);

  // Selecting a phone call opens its full detail (summary, participants, transcript,
  // corrections + a persistent action). Deselect returns to the list.
  if (selectedCall) {
    return <CallDetail callId={selectedCall} onBack={() => setSelectedCall(null)} />;
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="text-display text-xl font-semibold">Communications</div>
        <p className="mt-1 text-sm text-muted-foreground">
          The real conversations entering ServiceOS and their processing state.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["phone_call", "Phone", Phone],
            ["email_message", "Email", Mail],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setChannel(key)}
            className={cn(
              "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs",
              channel === key
                ? "border-foreground bg-foreground text-background"
                : "border-hairline bg-white text-muted-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
        <span className="flex items-center gap-2 rounded-full border border-dashed border-hairline px-3 py-1.5 text-xs text-muted-foreground">
          <MessageSquare className="h-3.5 w-3.5" />
          SMS · WhatsApp · Teams · Slack — Preview
        </span>
      </div>
      {rows === null ? (
        <State text="Loading conversations…" />
      ) : error ? (
        <State text={error} danger />
      ) : rows.length === 0 ? (
        <State
          text={`No ${channel === "phone_call" ? "phone calls" : "emails"} are available yet.`}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-hairline bg-white divide-y divide-hairline">
          {rows.map((row) => {
            const identity =
              row.from_name ||
              row.from_address ||
              row.phone_from ||
              row.phone_to ||
              "Unknown identity";
            const primary =
              row.subject ||
              row.summary ||
              (channel === "phone_call" ? "Phone call" : "Email message");
            const norm = (value?: string | null) => (value ?? "").trim().toLowerCase();
            // Only show a secondary line when it adds distinct information — never
            // repeat the primary summary (phone rows set body_preview = summary).
            const secondary =
              row.body_preview &&
              norm(row.body_preview) !== norm(primary) &&
              norm(row.body_preview) !== norm(row.summary)
                ? row.body_preview
                : null;
            const openable = channel === "phone_call" && !!row.source_id;
            return (
              <article
                key={row.id}
                onClick={openable ? () => setSelectedCall(row.source_id) : undefined}
                className={cn("p-4", openable && "cursor-pointer hover:bg-surface-alt/40")}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="capitalize text-muted-foreground">
                        {row.direction ?? "unknown"}
                      </span>
                      <span>·</span>
                      <span className="truncate">{identity}</span>
                    </div>
                    <div className="mt-1 truncate text-sm">{primary}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <time className="text-xs text-muted-foreground">{when(row.occurred_at)}</time>
                    {openable && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </div>
                {secondary && (
                  <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{secondary}</p>
                )}
                <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
                  <span className="rounded-full bg-surface-alt px-2 py-1">
                    {channel === "phone_call" ? "Simwood phone" : "Gmail / Google Workspace"}
                  </span>
                  <span className="rounded-full bg-surface-alt px-2 py-1">
                    Processing: {row.processing_status || row.status}
                  </span>
                  {row.sentiment && (
                    <span className="rounded-full bg-surface-alt px-2 py-1">
                      Sentiment: {row.sentiment}
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function State({ text, danger = false }: { text: string; danger?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-2xl border bg-white p-6 text-sm text-muted-foreground",
        danger && "border-destructive/30",
      )}
    >
      {danger && <AlertTriangle className="h-4 w-4 text-destructive" />}
      {text}
    </div>
  );
}
