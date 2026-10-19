import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import {
  loadCommusoftReviewConnections,
  type ReviewConnection,
} from "@/lib/learn-commusoft-review";
import { operatorBusinessReviewClient } from "@/lib/openfolk-business-review";
import {
  readOpportunityRetainedState,
  readOpportunitySourcePage,
  readOpportunityWait,
  type OpportunitySourcePage,
} from "@/lib/new-dawn-opportunity-source-review";

/** Internal one-page source discovery. Never mounted in the client job view. */
export function FounderOpportunitySourceReview({
  tenant,
  actor,
  jobReason,
}: {
  tenant: string;
  actor: string;
  jobReason: string;
}) {
  const { user } = useAuth();
  const [connectionId, setConnectionId] = useState("");
  const [reason, setReason] = useState("");
  const [page, setPage] = useState<OpportunitySourcePage | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const working = useRef(false);
  const flag = useQuery({
    queryKey: ["new-dawn-opportunity-source-flag", actor, tenant],
    enabled: user?.id === actor,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient()
        .from("feature_flags")
        .select("value")
        .eq("tenant_id", tenant)
        .eq("flag", "new_dawn.m5_opportunities_probe")
        .maybeSingle();
      if (error) throw Error("Opportunity source flag unavailable");
      return data?.value === true;
    },
    retry: false,
    staleTime: 30_000,
  });
  const connections = useQuery<ReviewConnection[]>({
    queryKey: ["new-dawn-opportunity-source-connections", actor, tenant, jobReason],
    enabled: user?.id === actor && flag.data === true,
    queryFn: async ({ signal }) => {
      const reviewed = operatorBusinessReviewClient(
        getSupabaseClient(),
        { tenant, actor, reason: jobReason },
        () => !signal.aborted,
      );
      return loadCommusoftReviewConnections(reviewed, tenant);
    },
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    const generationRef = generation;
    generation.current++;
    working.current = false;
    setConnectionId("");
    setReason("");
    setPage(null);
    setRequestId(null);
    setRetryAt(null);
    setNotice("");
    setBusy(false);
    return () => {
      generationRef.current++;
    };
  }, [tenant, actor, jobReason, flag.data]);
  if (user?.id !== actor || flag.data !== true) return null;

  const selected = connections.data?.find((connection) => connection.id === connectionId);
  const validReason = reason.trim().length >= 3 && reason.trim().length <= 500;
  async function run(sameRequest: boolean) {
    if (!selected || !validReason || working.current || flag.data !== true) return;
    const request = sameRequest && requestId ? requestId : crypto.randomUUID();
    const ticket = generation.current;
    working.current = true;
    setBusy(true);
    setNotice("");
    setPage(null);
    if (!sameRequest) {
      setRequestId(request);
      setRetryAt(null);
    }
    try {
      const db = getSupabaseClient();
      const { data, error } = await db.functions.invoke("learn-commusoft-opportunity-probe", {
        body: {
          tenantId: tenant,
          connectionId: selected.id,
          requestId: request,
          reason: reason.trim(),
        },
      });
      if (error) throw Error("source_check_unconfirmed");
      if (data && typeof data === "object" && "state" in data && data.state === "waiting") {
        const next = readOpportunityWait(data, request);
        if (ticket === generation.current) {
          setRetryAt(next);
          setNotice(
            `Commusoft is busy. This request is waiting until ${new Date(next).toLocaleString("en-GB")}. Retry this same request manually; no page was read.`,
          );
        }
      } else {
        const checked = readOpportunitySourcePage(data, {
          tenant,
          connection: selected.id,
          request,
        });
        if (ticket === generation.current) {
          setPage(checked);
          setRetryAt(null);
        }
      }
    } catch {
      try {
        const { data, error } = await getSupabaseClient().rpc(
          "new_dawn_commusoft_opportunity_probe_result",
          { p_request: request },
        );
        if (error) throw Error();
        const retained = readOpportunityRetainedState(data, request);
        if (ticket === generation.current) {
          if (retained.state === "complete") {
            setPage(
              readOpportunitySourcePage(retained.result, {
                tenant,
                connection: selected.id,
                request,
              }),
            );
            setRetryAt(null);
          } else {
            setRetryAt(null);
            setNotice(
              `The one-page source check was ${retained.state}. Request ${request}. Inspect the saved operator audit before starting another check.`,
            );
          }
        }
      } catch {
        if (ticket === generation.current) {
          setRetryAt(null);
          setNotice(
            `The one-page source check could not be confirmed. Request ${request}. Inspect its saved audit before another attempt.`,
          );
        }
      }
    } finally {
      if (ticket === generation.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  const clear = () => {
    generation.current++;
    setPage(null);
    setRequestId(null);
    setRetryAt(null);
    setNotice("");
  };
  return (
    <section className="nd-money-panel" aria-label="OpenFolk opportunity source review">
      <p className="of-eyebrow">OPENFOLK · PRIVATE SOURCE DISCOVERY</p>
      <h2 className="text-xl font-semibold">Opportunity source check</h2>
      <p className="nd-money-scope">
        One read-only Commusoft opportunities page, limited to ten records. The saved result shows
        source pipeline and status labels only. It does not establish Further Works quotes, ageing,
        conversion, follow-up or a customer action.
      </p>
      {connections.isPending && <p role="status">Checking configured Commusoft connections…</p>}
      {connections.isError && (
        <p role="alert">
          A configured connection could not be confirmed. OpenFolk source review is unavailable.
        </p>
      )}
      {connections.isSuccess && (
        <>
          <label className="grid gap-1 text-sm">
            Commusoft connection
            <select
              className="rounded-lg border bg-background p-2"
              value={connectionId}
              disabled={busy}
              onChange={(event) => {
                clear();
                setConnectionId(event.target.value);
              }}
            >
              <option value="">Choose connection</option>
              {connections.data.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Reason for this source check
            <input
              className="rounded-lg border bg-background p-2"
              value={reason}
              maxLength={500}
              disabled={busy}
              onChange={(event) => {
                clear();
                setReason(event.target.value);
              }}
              placeholder="Check opportunity source fields for Further Works"
            />
          </label>
          {!requestId && (
            <button
              className="cp-secondary"
              disabled={!selected || !validReason || busy}
              onClick={() => void run(false)}
            >
              {busy ? "Checking source…" : "Read one Commusoft source page"}
            </button>
          )}
          {requestId && retryAt !== null && (
            <button className="cp-secondary" disabled={busy} onClick={() => void run(true)}>
              Retry the same one-page request
            </button>
          )}
          {requestId && retryAt === null && !busy && (
            <button className="cp-secondary" onClick={clear}>
              Close this check
            </button>
          )}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {page && (
        <div className="space-y-2" role="status">
          <p>
            <strong>{page.recordCount} records in the saved page</strong> · observed{" "}
            {new Date(page.observedAt).toLocaleString("en-GB")} ·{" "}
            {page.hasMore === true
              ? "More source pages may exist"
              : page.hasMore === false
                ? "Source says no next page"
                : "Pagination not confirmed"}
            .
          </p>
          <p className="nd-money-scope">
            This page is a bounded sample, not a company total. Pipeline and status strings are
            source labels only; no Further Works classification or quote age is inferred.
          </p>
          <details>
            <summary>Source labels and retained request</summary>
            <p>
              Pipeline:{" "}
              {page.pipelineCounts.length
                ? page.pipelineCounts.map((row) => `${row.label} (${row.count})`).join(", ")
                : "none in this page"}
              .
            </p>
            <p>
              Status:{" "}
              {page.statusCounts.length
                ? page.statusCounts.map((row) => `${row.label} (${row.count})`).join(", ")
                : "none in this page"}
              .
            </p>
            <p>Request {page.requestId}</p>
          </details>
        </div>
      )}
    </section>
  );
}
