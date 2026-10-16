import { useEffect, useRef, useState } from "react";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import {
  loadSlackConnections,
  slackChannelId,
  type SlackConnectionOption,
} from "@/lib/learn-slack-setup";
import {
  campaignKey,
  campaignActionAvailable,
  type CampaignCapabilities,
  campaignStates,
  listCampaigns,
  readCampaign,
  prepareCampaign,
  readSavedCampaign,
  readSourceReplayReceipt,
  readCampaignRecovery,
  type CampaignRecoveryState,
  type SourceReplayReceipt,
  resolveCampaign,
  type Campaign,
  type CampaignDraft,
  type CampaignSummary,
} from "@/lib/learn-slack-campaigns";
import type { RecurringClient, RecurringLock } from "@/lib/learn-slack-recurring";
const local = (ms: number) =>
  new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const when = (s: string) => new Date(s).toLocaleString();
const lock: RecurringLock = async (key, task) => {
  if (!navigator.locks) throw Error("Use a browser that supports saved-request coordination.");
  return navigator.locks.request(key, task);
};
export function LearnSlackCampaigns({
  tenantId,
  actorId,
  canEdit,
  allowSourceReplay = false,
  client,
  backend = supabaseConfig.url.replace(/\/$/, ""),
}: {
  tenantId: string;
  actorId: string;
  canEdit: boolean;
  allowSourceReplay?: boolean;
  client?: RecurringClient;
  backend?: string;
}) {
  const scope = { tenantId, actorId, backend };
  const [connections, setConnections] = useState<SlackConnectionOption[]>([]),
    [rows, setRows] = useState<CampaignSummary[]>([]),
    [next, setNext] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<CampaignCapabilities>({
    sourceReplay: false,
    pageRecovery: false,
  });
  const capabilityRef = useRef(capabilities);
  capabilityRef.current = capabilities;
  const [selected, setSelected] = useState(""),
    [campaign, setCampaign] = useState<Campaign | null>(null),
    [writable, setWritable] = useState(false);
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [notice, setNotice] = useState("");
  const [saved, setSaved] = useState<CampaignDraft | null>(null),
    [review, setReview] = useState<CampaignDraft | null>(null),
    [confirmed, setConfirmed] = useState(false);
  const [channels, setChannels] = useState(""),
    [start, setStart] = useState(() => local(Date.now() - 30 * 86400000)),
    [end, setEnd] = useState(() => local(Date.now())),
    [expires, setExpires] = useState(() => local(Date.now() + 7 * 86400000)),
    [budget, setBudget] = useState(1000),
    [reason, setReason] = useState("");
  const [sourceId, setSourceId] = useState(""),
    [sourceVersion, setSourceVersion] = useState("");
  const [replayReceipt, setReplayReceipt] = useState<SourceReplayReceipt | null>(null);
  const [recoveryAccount, setRecoveryAccount] = useState("");
  const [recovery, setRecovery] = useState<CampaignRecoveryState | null>(null);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const recoveryGeneration = useRef(0);
  const live = useRef(false),
    working = useRef(false),
    generation = useRef(0),
    detailGeneration = useRef(0),
    current = useRef(scope);
  const reasonInput = useRef<HTMLInputElement>(null);
  const reviewPanel = useRef<HTMLDivElement>(null);
  current.current = scope;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const replayAllowedRef = useRef(allowSourceReplay);
  replayAllowedRef.current = allowSourceReplay;
  const db = () => client ?? getSupabaseClient();
  const allowed = () =>
    live.current &&
    canEditRef.current &&
    current.current.tenantId === tenantId &&
    current.current.actorId === actorId &&
    current.current.backend === backend;
  const restore = () => {
    try {
      const d = readSavedCampaign(localStorage, scope);
      setSaved(d);
      setReplayReceipt(readSourceReplayReceipt(localStorage, scope));
      setReady(true);
      return d;
    } catch (e) {
      setReady(false);
      setNotice((e as Error).message);
      return null;
    }
  };
  async function load(after: string | null = null) {
    const ticket = ++generation.current;
    setLoading(true);
    setWritable(false);
    setCapabilities({ sourceReplay: false, pageRecovery: false });
    setNotice("");
    try {
      const [page, connection] = await Promise.all([
        listCampaigns(db(), tenantId, after),
        loadSlackConnections(db(), tenantId),
      ]);
      if (!live.current || ticket !== generation.current) return;
      setRows((old) => (after ? [...old, ...page.campaigns] : page.campaigns));
      setNext(page.next);
      setConnections(connection);
      setWritable(page.canWrite);
      setCapabilities(page.capabilities);
    } catch (e) {
      if (live.current && ticket === generation.current) setNotice((e as Error).message);
    } finally {
      if (live.current && ticket === generation.current) setLoading(false);
    }
  }
  async function detail(id: string) {
    const ticket = ++detailGeneration.current;
    setSelected(id);
    recoveryGeneration.current++;
    setRecovery(null);
    setRecoveryAccount("");
    setRecoveryLoading(false);
    setCampaign(null);
    setReview(null);
    setConfirmed(false);
    if (!id) return;
    try {
      const c = await readCampaign(db(), tenantId, id);
      if (live.current && ticket === detailGeneration.current) setCampaign(c);
    } catch (e) {
      if (live.current && ticket === detailGeneration.current) setNotice((e as Error).message);
    }
  }
  useEffect(() => {
    live.current = true;
    setRows([]);
    setSelected("");
    setCampaign(null);
    setReview(null);
    setConfirmed(false);
    restore();
    void load();
    const changed = (e: StorageEvent) => {
      if (
        e.key === campaignKey(scope) ||
        e.key === campaignKey(scope) + ":replay-receipt" ||
        e.key === null
      ) {
        setReview(null);
        setConfirmed(false);
        restore();
      }
    };
    window.addEventListener("storage", changed);
    return () => {
      live.current = false;
      generation.current++;
      detailGeneration.current++;
      recoveryGeneration.current++;
      window.removeEventListener("storage", changed);
    };
  }, [tenantId, actorId, backend]);
  useEffect(() => {
    if (review) reviewPanel.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [review]);
  const editable = canEdit && writable && ready && !busy && !loading && !saved;
  const base = () => ({ version: 1 as const, ...scope, requestId: crypto.randomUUID() });
  function reviewStart() {
    try {
      const c = connections[0];
      if (!c) throw Error("Choose a configured Slack connection first.");
      const ids = channels
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((v) => {
          const id = slackChannelId(v, c.teamId);
          if (!id) throw Error("Use public channel IDs or links from this Slack workspace.");
          return id;
        });
      setReview(
        prepareCampaign({
          ...base(),
          operation: "start",
          input: {
            connectionId: c.id,
            connectionRevision: c.revision,
            channelIds: ids,
            start: new Date(start).toISOString(),
            end: new Date(end).toISOString(),
            expiresAt: new Date(expires).toISOString(),
            requestBudget: budget,
            reason: reason.trim(),
          },
        }),
      );
      setConfirmed(false);
      setNotice("");
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  function reviewAction(action: "pause" | "resume" | "stop" | "handoff") {
    if (!campaign) return;
    if (!reason.trim()) {
      setNotice("Add a reason for this change.");
      reasonInput.current?.focus();
      return;
    }
    try {
      const common = {
        campaignId: campaign.campaignId,
        revision: campaign.revision,
        reason: reason.trim(),
      };
      setReview(
        prepareCampaign(
          action === "pause" || action === "resume"
            ? {
                ...base(),
                operation: "control",
                input: { ...common, enabled: action === "resume" },
              }
            : { ...base(), operation: "close", input: { ...common, action } },
        ),
      );
      setConfirmed(false);
      setNotice("");
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  async function loadRecovery(
    account: string,
    request: string | null = null,
    campaignId = campaign?.campaignId,
  ) {
    const ticket = ++recoveryGeneration.current;
    setRecovery(null);
    setRecoveryAccount(account);
    setReview(null);
    setConfirmed(false);
    if (!account || !campaignId || !allowSourceReplay || !capabilityRef.current.pageRecovery)
      return;
    setRecoveryLoading(true);
    try {
      const r = await readCampaignRecovery(db(), tenantId, campaignId, account, request);
      if (allowed() && ticket === recoveryGeneration.current) setRecovery(r);
    } catch (e) {
      if (allowed() && ticket === recoveryGeneration.current) setNotice((e as Error).message);
    } finally {
      if (live.current && ticket === recoveryGeneration.current) setRecoveryLoading(false);
    }
  }
  function reviewRecovery() {
    if (!recovery?.jobId || !campaign || !allowSourceReplay || !capabilityRef.current.pageRecovery)
      return;
    try {
      setReview(
        prepareCampaign({
          ...base(),
          operation: "recover_page",
          input: {
            campaignId: recovery.campaignId,
            accountId: recovery.accountId,
            importId: recovery.importId,
            failedJobId: recovery.jobId,
            checkpointHash: recovery.checkpointHash,
            reason: reason.trim(),
          },
        }),
      );
      setConfirmed(false);
      setNotice("");
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  function reviewReplay() {
    if (!campaign || !allowSourceReplay || !capabilityRef.current.sourceReplay) return;
    try {
      setReview(
        prepareCampaign({
          ...base(),
          operation: "replay_source",
          input: {
            campaignId: campaign.campaignId,
            sourceMessageId: sourceId.trim(),
            sourceVersion: sourceVersion.trim(),
            reason: reason.trim(),
          },
        }),
      );
      setConfirmed(false);
      setNotice("");
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  async function send(d: CampaignDraft, mode: "apply" | "check" | "cancel") {
    if (
      working.current ||
      !allowed() ||
      !ready ||
      !campaignActionAvailable(capabilityRef.current, d.operation) ||
      (["replay_source", "recover_page"].includes(d.operation) && !allowSourceReplay)
    )
      return;
    working.current = true;
    setBusy(true);
    setNotice("");
    try {
      const r = await resolveCampaign(
        db(),
        localStorage,
        lock,
        scope,
        d,
        mode,
        () =>
          allowed() &&
          campaignActionAvailable(capabilityRef.current, d.operation) &&
          (!["replay_source", "recover_page"].includes(d.operation) || replayAllowedRef.current),
      );
      if (!allowed()) return;
      restore();
      setReview(null);
      setConfirmed(false);
      await load();
      if (!allowed()) return;
      if (r.campaignId) await detail(r.campaignId);
      setNotice(
        r.state === "committed"
          ? "Recovery request queued. Capture has not yet been verified; retain the job receipt for outcome review."
          : r.state === "recorded"
            ? "Change recorded. Refresh progress to follow the import."
            : r.state === "cancelled"
              ? "Pending request cancelled. Existing capture was not changed."
              : "No completed result yet. The same saved request is available to retry.",
      );
    } catch (e) {
      if (allowed()) {
        restore();
        setNotice((e as Error).message);
      }
    } finally {
      working.current = false;
      if (live.current) setBusy(false);
    }
  }
  const draft = saved ?? review;
  return (
    <section className="space-y-4" aria-label="Slack historical campaigns">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">Channel history</h3>
        <button
          className="cp-secondary"
          disabled={busy || loading}
          onClick={() => {
            void load();
            if (selected) void detail(selected);
          }}
        >
          Refresh
        </button>
      </div>
      <p>
        Import a fixed period from selected public channels, including observed thread replies. DMs
        stay private. Private/shared channels and file downloads are not enabled here.
      </p>
      {notice && (
        <p role="status" className="rounded-lg border border-border p-3">
          {notice}
        </p>
      )}
      {loading && <p role="status">Checking campaign access and progress…</p>}
      <label className="block space-y-1">
        <span>Saved campaigns</span>
        <select
          className="block w-full rounded border p-2"
          value={selected}
          disabled={busy}
          onChange={(e) => void detail(e.target.value)}
        >
          <option value="">Choose a campaign</option>
          {rows.map((r) => (
            <option key={r.campaignId} value={r.campaignId}>
              {when(r.start)} → {when(r.end)} · {r.channelCount} channels ·{" "}
              {r.lifecycle === "open" ? (r.enabled ? "enabled" : "paused") : r.lifecycle} ·{" "}
              {r.campaignId.slice(0, 8)}
            </option>
          ))}
        </select>
      </label>
      {next && (
        <button className="cp-secondary" disabled={loading || busy} onClick={() => void load(next)}>
          More campaigns
        </button>
      )}
      {campaign && (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <p className="font-medium">
            {campaign.lifecycle === "ongoing"
              ? "Historical import handed to ongoing capture"
              : campaign.lifecycle === "stopped"
                ? "Historical import stopped"
                : campaign.complete
                  ? "Approved window captured"
                  : campaign.enabled
                    ? "Historical import in progress"
                    : "Historical import paused"}
          </p>
          <p>
            {when(campaign.start)} → {when(campaign.end)}. Approval expires{" "}
            {when(campaign.expiresAt)}.
          </p>
          <p>
            {campaign.requestsReserved.toLocaleString()} / {campaign.requestBudget.toLocaleString()}{" "}
            request allowance reserved. Checks and retries count; an uncertain response can use
            allowance without a successful provider request.
          </p>
          <p className="text-sm text-muted-foreground">
            Coverage describes this fixed window and observed threads. It does not prove deleted or
            inaccessible Slack history was available.
          </p>
          {campaign.sourceNeedsReviewCount !== undefined && campaign.sourceNeedsReviewCount > 0 && (
            <p role="status" className="text-sm text-muted-foreground">
              {campaign.sourceNeedsReviewCount.toLocaleString()} saved Slack records need source
              review. Their content is retained, but they are not yet used as conversations or for
              scoring. Available thread replies are captured separately.
            </p>
          )}
          {campaign.sourceWithheldCount !== undefined && campaign.sourceWithheldCount > 0 && (
            <p role="status" className="text-sm text-muted-foreground">
              {campaign.sourceWithheldCount.toLocaleString()} Slack records are unavailable at
              source. Their withholding markers are retained; their content is excluded from
              customer context and scoring. Available replies are captured separately.
            </p>
          )}
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="p-2 text-left">Channel</th>
                  <th className="p-2 text-left">Messages</th>
                  <th className="p-2 text-left">Replies</th>
                  <th className="p-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {campaign.channels.map((c) => (
                  <tr key={c.accountId}>
                    <td className="p-2">{c.channelId}</td>
                    <td className="p-2">
                      {c.channelPagesComplete ? "Window captured" : "Incomplete"}
                    </td>
                    <td className="p-2">
                      {c.completedThreads} / {c.observedThreads} observed threads
                      {!c.discoveryComplete ? " · discovery unfinished" : ""}
                    </td>
                    <td className="p-2">{campaignStates[c.state] ?? "Needs operator review"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="block space-y-1">
            <span>Reason for the new import or change</span>
            <input
              ref={reasonInput}
              className="block w-full rounded border p-2"
              value={reason}
              maxLength={1000}
              disabled={!editable}
              onChange={(e) => {
                setReason(e.target.value);
                setReview(null);
                setNotice("");
              }}
            />
          </label>
          {notice === "Add a reason for this change." && (
            <p role="status" className="text-sm text-destructive">
              {notice}
            </p>
          )}
          {!campaign.lifecycle && (
            <div className="flex flex-wrap gap-2">
              <button
                className="cp-secondary"
                disabled={!editable}
                onClick={() => reviewAction(campaign.enabled ? "pause" : "resume")}
              >
                {campaign.enabled ? "Pause" : "Resume"}
              </button>
              <button
                className="cp-secondary"
                disabled={!editable}
                onClick={() => reviewAction("stop")}
              >
                Stop permanently
              </button>
              <button
                className="cp-primary"
                disabled={!editable || !campaign.complete}
                onClick={() => reviewAction("handoff")}
              >
                Move to ongoing capture
              </button>
            </div>
          )}
        </div>
      )}
      {!campaign && (
        <label className="block space-y-1">
          <span>Reason for the new import or change</span>
          <input
            ref={reasonInput}
            className="block w-full rounded border p-2"
            value={reason}
            maxLength={1000}
            disabled={!editable}
            onChange={(e) => {
              setReason(e.target.value);
              setReview(null);
              setNotice("");
            }}
          />
        </label>
      )}
      {allowSourceReplay &&
        !loading &&
        (!capabilities.sourceReplay || !capabilities.pageRecovery) && (
          <p role="status" className="text-sm text-muted-foreground">
            {!capabilities.sourceReplay && !capabilities.pageRecovery
              ? "Advanced recovery tools are"
              : !capabilities.pageRecovery
                ? "Held-page recovery is"
                : "Source revalidation is"}{" "}
            unavailable in this environment. Existing history and saved requests are preserved.
          </p>
        )}
      {allowSourceReplay && capabilities.pageRecovery && (
        <details>
          <summary className="cursor-pointer font-medium">
            Advanced: recover a held campaign page
          </summary>
          <div className="mt-3 space-y-3">
            <p>
              Inspect the saved failure before one exact retry. The campaign’s dates, allowance and
              checkpoint stay unchanged. Unsupported messages remain held for review.
            </p>
            <label className="block space-y-1">
              <span>Campaign channel</span>
              <select
                className="block w-full rounded border p-2"
                value={recoveryAccount}
                disabled={busy || !campaign}
                onChange={(e) => void loadRecovery(e.target.value)}
              >
                <option value="">Choose a channel from the selected campaign</option>
                {campaign?.channels.map((c) => (
                  <option key={c.accountId} value={c.accountId}>
                    {c.channelId} · {campaignStates[c.state] ?? c.state}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="cp-secondary"
              disabled={busy || recoveryLoading || !recoveryAccount}
              onClick={() => void loadRecovery(recoveryAccount)}
            >
              Refresh saved failure
            </button>
            {recoveryLoading && <p role="status">Reading saved failure and checkpoint…</p>}
            {recovery && (
              <div className="space-y-2 break-all">
                <p>
                  Job: {recovery.jobId ?? "None"} · {recovery.status ?? "Not checked"}
                </p>
                <p>{recovery.errorCode ?? "No failure code recorded"}</p>
                {recovery.errorCode === "slack_history_withheld_card_review_required" && (
                  <p>
                    A withheld Slack source previously supplied a customer-card summary. OpenFolk
                    must reconcile that summary before retrying this page; no source or card content
                    was changed.
                  </p>
                )}
                {recovery.diagnostic ? (
                  <p>
                    Structure: type {recovery.diagnostic.type}; hidden {recovery.diagnostic.hidden};
                    subtype {recovery.diagnostic.subtype ?? recovery.diagnostic.subtypeType}.
                  </p>
                ) : (
                  <p>
                    No structural diagnostic is recorded. A reviewed bounded retry can inspect the
                    held page without skipping it.
                  </p>
                )}
                <button
                  className="cp-secondary"
                  disabled={
                    !editable ||
                    recoveryLoading ||
                    !["failed", "dead_letter"].includes(recovery.status ?? "") ||
                    ![
                      "slack_history_message_subtype_unsupported",
                      "slack_history_message_shape_unsupported",
                      "slack_history_diagnostic_unconfirmed",
                      "slack_history_failed",
                    ].includes(recovery.errorCode ?? "")
                  }
                  onClick={reviewRecovery}
                >
                  Review exact page recovery
                </button>
              </div>
            )}
          </div>
        </details>
      )}
      {allowSourceReplay && capabilities.sourceReplay && (
        <details>
          <summary className="cursor-pointer font-medium">
            Advanced: revalidate a retained Slack source
          </summary>
          <div className="mt-3 space-y-3">
            <p>
              Recheck one exact saved message under the selected campaign’s existing allowance and
              expiry. This preserves historical checkpoints and does not enable new channels or DMs.
            </p>
            <p>Selected campaign: {campaign?.campaignId ?? "Choose a campaign above"}</p>
            <label className="block space-y-1">
              <span>Retained source message ID</span>
              <input
                className="block w-full rounded border p-2"
                value={sourceId}
                disabled={!editable}
                onChange={(e) => {
                  setSourceId(e.target.value);
                  setReview(null);
                }}
              />
            </label>
            <label className="block space-y-1">
              <span>Exact source version (64-character hash)</span>
              <input
                className="block w-full rounded border p-2"
                value={sourceVersion}
                disabled={!editable}
                onChange={(e) => {
                  setSourceVersion(e.target.value);
                  setReview(null);
                }}
              />
            </label>
            <button
              className="cp-secondary"
              disabled={!editable || !campaign}
              onClick={reviewReplay}
            >
              Review source replay
            </button>
          </div>
        </details>
      )}
      {allowSourceReplay && replayReceipt && (
        <div className="space-y-2 rounded border p-3" role="status">
          <p>Last recovery request accepted. Execution outcome is separate from this receipt.</p>
          <p className="break-all">
            Request: {replayReceipt.draft.requestId}
            <br />
            Job: {replayReceipt.jobId}
          </p>
          <p>Checking this receipt confirms acceptance only. It does not submit another job.</p>
          <button
            className="cp-secondary"
            disabled={
              busy ||
              !!saved ||
              !canEdit ||
              !ready ||
              !campaignActionAvailable(capabilities, replayReceipt.draft.operation)
            }
            onClick={() => void send(replayReceipt.draft, "check")}
          >
            Reconcile saved receipt
          </button>
          {replayReceipt.draft.operation === "recover_page" && (
            <button
              className="cp-secondary"
              disabled={busy || recoveryLoading || !canEdit || !capabilities.pageRecovery}
              onClick={() => {
                const d = replayReceipt.draft;
                if (d.operation === "recover_page")
                  void loadRecovery(d.input.accountId, d.requestId, d.input.campaignId);
              }}
            >
              Read recovery job outcome
            </button>
          )}
        </div>
      )}
      <details>
        <summary className="cursor-pointer font-medium">Start a historical import</summary>
        <div className="mt-3 space-y-3">
          <p>
            Workspace: {connections[0]?.name ?? "No configured connection available"}. Enter the
            exact channels to include; this does not discover or select every channel automatically.
          </p>
          <label className="block space-y-1">
            <span>Public channel IDs or links, separated by spaces or commas</span>
            <textarea
              className="block w-full rounded border p-2"
              rows={3}
              value={channels}
              disabled={!editable}
              onChange={(e) => {
                setChannels(e.target.value);
                setReview(null);
              }}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["Start", start, setStart],
                ["Cutoff", end, setEnd],
                ["Approval expiry", expires, setExpires],
              ] as const
            ).map(([label, value, set]) => (
              <label className="block space-y-1" key={label}>
                <span>{label} (your local time)</span>
                <input
                  className="block w-full rounded border p-2"
                  type="datetime-local"
                  value={value}
                  disabled={!editable}
                  onChange={(e) => {
                    set(e.target.value);
                    setReview(null);
                  }}
                />
              </label>
            ))}
          </div>
          <label className="block space-y-1">
            <span>Total provider request allowance</span>
            <input
              className="rounded border p-2"
              type="number"
              min={9}
              max={1000000}
              value={budget}
              disabled={!editable}
              onChange={(e) => {
                setBudget(Number(e.target.value));
                setReview(null);
              }}
            />
          </label>
          <button
            className="cp-secondary"
            disabled={!editable || !connections.length}
            onClick={reviewStart}
          >
            Review import
          </button>
        </div>
      </details>
      {draft && (
        <div
          ref={reviewPanel}
          className="space-y-3 rounded-xl border border-border p-4"
          aria-label="Review saved campaign request"
        >
          <h4 className="font-semibold">
            {saved ? "Saved request — resolve before another change" : "Review before applying"}
          </h4>
          {draft.operation === "start" ? (
            <>
              <p>
                {draft.input.channelIds.length} selected channels:{" "}
                {draft.input.channelIds.join(", ")}
              </p>
              <p>
                {when(draft.input.start)} → {when(draft.input.end)}. Expires{" "}
                {when(draft.input.expiresAt)}. Maximum {draft.input.requestBudget.toLocaleString()}{" "}
                reserved provider requests, including checks/retries. Observed replies are included.
              </p>
            </>
          ) : draft.operation === "recover_page" ? (
            <div className="space-y-2 break-all">
              <p>
                Retry exactly the held page from its preserved checkpoint. Existing campaign
                allowance and expiry apply; this may record a diagnostic and remain held.
              </p>
              <p>
                Campaign: {draft.input.campaignId}
                <br />
                Account: {draft.input.accountId}
                <br />
                Import: {draft.input.importId}
                <br />
                Failed job: {draft.input.failedJobId}
                <br />
                Checkpoint: {draft.input.checkpointHash}
              </p>
              <p>Cancellation only applies before the request is committed.</p>
            </div>
          ) : draft.operation === "replay_source" ? (
            <div className="space-y-2 break-all">
              <p>
                Revalidate exactly one retained source. Existing campaign allowance and expiry
                apply; the main import checkpoint stays unchanged.
              </p>
              <p>
                Campaign: {draft.input.campaignId}
                <br />
                Source: {draft.input.sourceMessageId}
                <br />
                Version: {draft.input.sourceVersion}
              </p>
              <p>
                A queued receipt is not proof that revalidation succeeded. Cancellation only applies
                before the request is committed.
              </p>
            </div>
          ) : (
            <p>
              {draft.operation === "control"
                ? draft.input.enabled
                  ? "Resume"
                  : "Pause"
                : draft.input.action === "stop"
                  ? "Permanently stop; preserve data and checkpoints. This cannot be resumed."
                  : "Enable ongoing channel and observed-reply capture from the historical cutoff."}{" "}
              Campaign {draft.input.campaignId.slice(0, 8)}, revision {draft.input.revision}.
            </p>
          )}
          <p>Reason: {draft.input.reason}</p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>I have reviewed this company, scope and action.</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              className="cp-primary"
              disabled={!canEdit || !writable || !ready || busy || !confirmed}
              onClick={() => void send(draft, "apply")}
            >
              {saved ? "Retry same request" : "Apply reviewed change"}
            </button>
            {saved ? (
              <>
                <button
                  className="cp-secondary"
                  disabled={busy || !canEdit || !ready}
                  onClick={() => void send(draft, "check")}
                >
                  Check result
                </button>
                <button
                  className="cp-secondary"
                  disabled={busy || !canEdit || !ready}
                  onClick={() => void send(draft, "cancel")}
                >
                  Cancel pending request
                </button>
              </>
            ) : (
              <button className="cp-secondary" disabled={busy} onClick={() => setReview(null)}>
                Back to editing
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
