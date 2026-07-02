import { useState, type ReactNode } from "react";
import {
  Plug,
  Phone,
  Mail,
  MessageSquare,
  Briefcase,
  FileText,
  Brain,
  PlayCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  testSimwoodConnection,
  syncSimwoodCalls,
  syncSimwoodRecordings,
  transcribePhoneRecording,
  analysePhoneTranscript,
} from "@/lib/api";
import type {
  ApiResult,
  SimwoodConnectionResult,
  SimwoodSyncCallsResult,
  SimwoodSyncRecordingsResult,
  PhoneTranscribeRecordingResult,
  PhoneAnalyseTranscriptResult,
} from "@/lib/types";

// TODO(auth): replace this hardcoded test tenant with the authenticated user's
// profile.tenant_id (from useAuth().profile) once profiles carry a tenant.
const TENANT_ID = "00000000-0000-0000-0000-000000000001";

// TODO(integration): replace this hardcoded Simwood customer id with the
// tenant's integration config once provider connections are stored per tenant.
const PROVIDER_CUSTOMER_ID = "3950";

type ActionKey = "test" | "calls" | "recordings";

type Row = { label: string; value: string };

/** Read-only status panel for the latest run of one action. */
function StatusPanel<T>({
  running,
  result,
  renderOk,
  renderExtra,
}: {
  running: boolean;
  result: ApiResult<T> | null;
  renderOk: (data: T) => Row[];
  renderExtra?: (data: T) => ReactNode;
}) {
  let tone: "idle" | "running" | "ok" | "error" = "idle";
  if (running) tone = "running";
  else if (result) tone = result.ok ? "ok" : "error";

  const badge =
    tone === "ok"
      ? {
          cls: "bg-success/10 text-success border-success/20",
          label: "Success",
          Icon: CheckCircle2,
        }
      : tone === "error"
        ? {
            cls: "bg-destructive/10 text-destructive border-destructive/20",
            label: "Failed",
            Icon: XCircle,
          }
        : tone === "running"
          ? { cls: "bg-accent/10 text-accent border-accent/20", label: "Running", Icon: Loader2 }
          : {
              cls: "bg-surface-alt text-muted-foreground border-hairline",
              label: "Not run",
              Icon: PlayCircle,
            };

  const rows: Row[] = result && result.ok ? renderOk(result.data) : [];

  return (
    <div className="mt-3 rounded-xl border border-hairline bg-surface-alt/50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Latest result
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}
        >
          <badge.Icon className={`h-3 w-3 ${tone === "running" ? "animate-spin" : ""}`} />
          {badge.label}
        </span>
      </div>

      {tone === "idle" && (
        <p className="mt-2 text-xs text-muted-foreground">No run yet. Use the button above.</p>
      )}

      {result && result.ok && (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
          {rows.map((r) => (
            <div key={r.label} className="min-w-0">
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {r.label}
              </dt>
              <dd className="truncate font-mono text-xs text-foreground">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {result && result.ok && renderExtra && <div className="mt-2">{renderExtra(result.data)}</div>}

      {result && !result.ok && (
        <div className="mt-2 space-y-1">
          <div className="font-mono text-xs text-destructive">{result.error.code}</div>
          <div className="text-xs text-muted-foreground">{result.error.message}</div>
        </div>
      )}
    </div>
  );
}

export function AdminView() {
  const [running, setRunning] = useState<ActionKey | null>(null);
  const [test, setTest] = useState<ApiResult<SimwoodConnectionResult> | null>(null);
  const [calls, setCalls] = useState<ApiResult<SimwoodSyncCallsResult> | null>(null);
  const [recordings, setRecordings] = useState<ApiResult<SimwoodSyncRecordingsResult> | null>(null);

  async function runTest() {
    setRunning("test");
    setTest(await testSimwoodConnection(TENANT_ID, PROVIDER_CUSTOMER_ID));
    setRunning(null);
  }
  async function runCalls() {
    setRunning("calls");
    // No from/to → the function defaults to the last 24 hours.
    setCalls(
      await syncSimwoodCalls({ tenantId: TENANT_ID, providerCustomerId: PROVIDER_CUSTOMER_ID }),
    );
    setRunning(null);
  }
  async function runRecordings() {
    setRunning("recordings");
    // No from/to → the function defaults to the last 24 hours.
    setRecordings(
      await syncSimwoodRecordings({
        tenantId: TENANT_ID,
        providerCustomerId: PROVIDER_CUSTOMER_ID,
      }),
    );
    setRunning(null);
  }

  const [recordingId, setRecordingId] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState<ApiResult<PhoneTranscribeRecordingResult> | null>(
    null,
  );

  async function runTranscribe() {
    const id = recordingId.trim();
    if (!id) return;
    setTranscribing(true);
    setTranscript(await transcribePhoneRecording({ tenantId: TENANT_ID, recordingId: id }));
    setTranscribing(false);
  }

  const [transcriptId, setTranscriptId] = useState("");
  const [analysing, setAnalysing] = useState(false);
  const [insight, setInsight] = useState<ApiResult<PhoneAnalyseTranscriptResult> | null>(null);

  async function runAnalyse() {
    const id = transcriptId.trim();
    if (!id) return;
    setAnalysing(true);
    setInsight(await analysePhoneTranscript({ tenantId: TENANT_ID, transcriptId: id }));
    setAnalysing(false);
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-foreground text-background">
                <Plug className="h-3 w-3" />
              </span>
              Admin · Integrations
            </div>
            <h2 className="text-display mt-3 text-2xl font-semibold tracking-tight">
              Internal integration console.
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Trigger backend inputs and inspect the latest sync health without the terminal.
              Internal tooling — visible to signed-in staff only.
            </p>
          </div>
          <div className="rounded-full border border-hairline bg-surface-alt px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
            Tenant · <span className="font-mono">{TENANT_ID}</span>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-warning">
          Using a temporary hardcoded tenant id for testing — replace with the authenticated profile
          tenant_id.
        </p>
      </div>

      {/* Phone / VoIP — Simwood (active) */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex items-center justify-between border-b border-hairline pb-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-alt">
              <Phone className="h-4 w-4 text-foreground" />
            </span>
            <div>
              <div className="text-sm font-semibold">Phone / VoIP · Simwood</div>
              <div className="text-xs text-muted-foreground">Call history & recording metadata</div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-success/20 bg-success/10 px-2.5 py-0.5 text-[11px] font-medium text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Active
          </span>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {/* Test connection */}
          <div className="rounded-xl border border-hairline p-4">
            <div className="text-sm font-semibold">Test connection</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Verify Simwood credentials and reachable accounts.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3 w-full"
              onClick={runTest}
              disabled={running !== null}
            >
              {running === "test" ? "Testing…" : "Test connection"}
            </Button>
            <StatusPanel
              running={running === "test"}
              result={test}
              renderOk={(d) => [
                { label: "Provider", value: d.provider },
                { label: "Accounts", value: String(d.customerCount) },
              ]}
            />
          </div>

          {/* Sync calls */}
          <div className="rounded-xl border border-hairline p-4">
            <div className="text-sm font-semibold">Sync calls</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Ingest call history (default: last 24 hours).
            </p>
            <Button
              size="sm"
              className="mt-3 w-full"
              onClick={runCalls}
              disabled={running !== null}
            >
              {running === "calls" ? "Syncing…" : "Sync last 24h"}
            </Button>
            <StatusPanel
              running={running === "calls"}
              result={calls}
              renderOk={(d) => [
                { label: "Records", value: String(d.records_processed) },
                { label: "Sync run", value: d.sync_run_id ?? "—" },
                { label: "From", value: d.from },
                { label: "To", value: d.to },
              ]}
            />
          </div>

          {/* Sync recordings */}
          <div className="rounded-xl border border-hairline p-4">
            <div className="text-sm font-semibold">Sync recordings</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Ingest recording metadata (default: last 24 hours). No audio download.
            </p>
            <Button
              size="sm"
              className="mt-3 w-full"
              onClick={runRecordings}
              disabled={running !== null}
            >
              {running === "recordings" ? "Syncing…" : "Sync last 24h"}
            </Button>
            <StatusPanel
              running={running === "recordings"}
              result={recordings}
              renderOk={(d) => [
                { label: "Records", value: String(d.records_processed) },
                { label: "Sync run", value: d.sync_run_id ?? "—" },
                { label: "From", value: d.from },
                { label: "To", value: d.to },
              ]}
            />
          </div>
        </div>
      </div>

      {/* Transcription — OpenAI (Phase-4A) */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex items-center justify-between border-b border-hairline pb-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-alt">
              <FileText className="h-4 w-4 text-foreground" />
            </span>
            <div>
              <div className="text-sm font-semibold">Transcription · OpenAI</div>
              <div className="text-xs text-muted-foreground">
                Speech-to-text from a stored recording
              </div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-accent">
            Voice intelligence
          </span>
        </div>

        <div className="mt-5 max-w-xl">
          <label
            htmlFor="rec-id"
            className="text-[11px] uppercase tracking-wider text-muted-foreground"
          >
            Recording UUID
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Input
              id="rec-id"
              value={recordingId}
              onChange={(e) => setRecordingId(e.target.value)}
              placeholder="294014bf-0e25-4904-8ad7-81c8526e2025"
              disabled={transcribing}
              className="font-mono"
            />
            <Button onClick={runTranscribe} disabled={transcribing || recordingId.trim() === ""}>
              {transcribing ? "Transcribing…" : "Transcribe recording"}
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-warning">
            Transcripts are machine-generated and may need human review.
          </p>

          <StatusPanel
            running={transcribing}
            result={transcript}
            renderOk={(d) => [
              { label: "Status", value: d.status },
              { label: "Language", value: d.language ?? "—" },
              { label: "Model", value: d.model ?? "—" },
              { label: "Transcript", value: d.transcript_id ?? "—" },
            ]}
            renderExtra={(d) => (
              <div className="rounded-lg border border-hairline bg-surface-alt/50 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Preview
                </div>
                <p className="mt-1 whitespace-pre-wrap text-xs text-foreground">
                  {d.text_preview || "—"}
                </p>
              </div>
            )}
          />
        </div>
      </div>

      {/* Call intelligence — OpenAI (Phase-4B) */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex items-center justify-between border-b border-hairline pb-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-alt">
              <Brain className="h-4 w-4 text-foreground" />
            </span>
            <div>
              <div className="text-sm font-semibold">Call intelligence · OpenAI</div>
              <div className="text-xs text-muted-foreground">
                Intent, urgency, sentiment & actions from a transcript
              </div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-accent">
            Voice intelligence
          </span>
        </div>

        <div className="mt-5 max-w-xl">
          <label
            htmlFor="transcript-id"
            className="text-[11px] uppercase tracking-wider text-muted-foreground"
          >
            Transcript UUID
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Input
              id="transcript-id"
              value={transcriptId}
              onChange={(e) => setTranscriptId(e.target.value)}
              placeholder="2d800bc5-063d-4a3e-8eab-52f0637f1aaa"
              disabled={analysing}
              className="font-mono"
            />
            <Button onClick={runAnalyse} disabled={analysing || transcriptId.trim() === ""}>
              {analysing ? "Analysing…" : "Analyse transcript"}
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-warning">
            AI-generated intelligence — advisory only, may need human review.
          </p>

          <StatusPanel
            running={analysing}
            result={insight}
            renderOk={(d) => [
              { label: "Intent", value: d.intent ?? "—" },
              { label: "Urgency", value: d.urgency ?? "—" },
              { label: "Sentiment", value: d.sentiment ?? "—" },
              { label: "Action required", value: d.action_required ? "yes" : "no" },
              { label: "Owner", value: d.suggested_owner ?? "—" },
              { label: "Confidence", value: d.confidence !== null ? d.confidence.toFixed(2) : "—" },
            ]}
            renderExtra={(d) => (
              <div className="rounded-lg border border-hairline bg-surface-alt/50 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Summary
                </div>
                <p className="mt-1 whitespace-pre-wrap text-xs text-foreground">
                  {d.summary_preview || "—"}
                </p>
              </div>
            )}
          />
        </div>
      </div>

      {/* Other integrations — placeholders */}
      <div>
        <div className="mb-3 text-[11px] uppercase tracking-wider text-muted-foreground">
          Other inputs · planned
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PLACEHOLDERS.map((p) => (
            <div key={p.name} className="rounded-2xl border border-hairline bg-white p-4">
              <div className="flex items-center justify-between">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-alt">
                  <p.icon className="h-4 w-4 text-muted-foreground" />
                </span>
                <span className="rounded-full border border-hairline bg-surface-alt px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Planned
                </span>
              </div>
              <div className="mt-3 text-sm font-semibold">{p.name}</div>
              <p className="mt-1 text-xs text-muted-foreground">{p.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const PLACEHOLDERS: { name: string; detail: string; icon: LucideIcon }[] = [
  {
    name: "Gmail input",
    detail: "Inbound email capture, classification and threading.",
    icon: Mail,
  },
  {
    name: "Slack input",
    detail: "Team messages and alerts routed into ServiceOS.",
    icon: MessageSquare,
  },
  {
    name: "VoIP / phone input",
    detail: "Active via Simwood above; more providers to follow.",
    icon: Phone,
  },
  {
    name: "Commusoft / job system",
    detail: "Jobs, customers and invoices from the field system.",
    icon: Briefcase,
  },
];
