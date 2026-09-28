// Enumerate by bounded update-time windows, never an assumed sort order or a hidden cap.
// A full response is split; an unsplittable full timestamp or request budget fails closed.
import { record } from "./receptionist-data.ts";
export type ObservedCall = { id: string; updatedAt: string; status: string };
export type ScanWindow = { from: string; to: string };
export async function scanProviderCalls(input: {
  key: string;
  assistantId: string;
  from: string;
  through: string;
  observe: (calls: ObservedCall[]) => Promise<void>;
  fetcher?: typeof fetch;
  maxRequests?: number;
  pageSize?: number;
  pending?: ScanWindow[];
  maxDurationMs?: number;
}) {
  const start = Date.parse(input.from),
    end = Date.parse(input.through);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end)
    throw Error("scan_boundary_invalid");
  if (!input.key || !/^[0-9a-f-]{36}$/i.test(input.assistantId))
    throw Error("scan_connection_required");
  const limit = input.pageSize ?? 1000,
    budget = input.maxRequests ?? 24;
  if (!Number.isInteger(limit) || limit < 2 || limit > 1000) throw Error("scan_limit_invalid");
  const windows: [number, number][] = input.pending?.length
    ? input.pending.map((w) => [Date.parse(w.from), Date.parse(w.to)])
    : [[start, end]];
  if (
    windows.some(
      ([a, b]) => !Number.isFinite(a) || !Number.isFinite(b) || a < start || b > end || a > b,
    )
  )
    throw Error("scan_boundary_invalid");
  const started = Date.now();
  const seen = new Set<string>();
  let requests = 0;
  while (windows.length) {
    if (requests >= budget || Date.now() - started >= (input.maxDurationMs ?? 45000))
      return {
        complete: false,
        pending: windows.map(([a, b]) => ({
          from: new Date(a).toISOString(),
          to: new Date(b).toISOString(),
        })),
        count: seen.size,
        requests,
        through: input.through,
      };
    requests++;
    const [from, through] = windows.pop()!;
    const url = new URL("https://api.vapi.ai/call");
    url.searchParams.set("assistantId", input.assistantId);
    url.searchParams.set("updatedAtGe", new Date(from).toISOString());
    url.searchParams.set("updatedAtLe", new Date(through).toISOString());
    url.searchParams.set("limit", String(limit));
    const response = await (input.fetcher ?? fetch)(url, {
      headers: { Authorization: `Bearer ${input.key}` },
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok)
      throw Error(response.status === 429 ? "scan_rate_limited" : "scan_provider_unavailable");
    const body = await response.json();
    if (!Array.isArray(body) || body.length > limit) throw Error("scan_response_invalid");
    const calls = body.map((item) => {
      const c = record(item),
        time = typeof c.updatedAt === "string" ? Date.parse(c.updatedAt) : NaN;
      if (
        c.assistantId !== input.assistantId ||
        typeof c.id !== "string" ||
        !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(c.id) ||
        !Number.isFinite(time) ||
        time < from ||
        time > through ||
        typeof c.status !== "string"
      )
        throw Error("scan_scope_invalid");
      return { id: c.id, updatedAt: c.updatedAt as string, status: c.status };
    });
    if (calls.length === limit) {
      if (through - from <= 1) throw Error("scan_timestamp_saturated");
      const times = calls.map((c) => Date.parse(c.updatedAt));
      const candidate = Math.floor((Math.min(...times) + Math.max(...times)) / 2);
      const midpoint =
        candidate > from && candidate < through
          ? candidate
          : Math.floor(from + (through - from) / 2);
      // Inclusive overlap avoids losing provider timestamps finer than milliseconds.
      windows.push([from, midpoint], [midpoint, through]);
      continue;
    }
    const unique = calls.filter((c) => !seen.has(`${c.id}:${c.updatedAt}`));
    await input.observe(unique);
    for (const c of unique) seen.add(`${c.id}:${c.updatedAt}`);
  }
  return { complete: true, pending: [], count: seen.size, requests, through: input.through };
}

// Only fixed, non-sensitive error identifiers may be persisted or returned.
const SAFE_ERRORS = new Set([
  "scan_boundary_invalid",
  "scan_connection_required",
  "scan_limit_invalid",
  "scan_budget_exceeded",
  "scan_rate_limited",
  "scan_provider_unavailable",
  "scan_response_invalid",
  "scan_scope_invalid",
  "scan_timestamp_saturated",
  "review_credit_required",
  "review_rate_limited",
  "review_provider_unavailable",
  "review_connection_required",
  "review_incomplete",
  "review_refused",
  "assessment_invalid",
  "assessment_evidence_invalid",
  "awaiting_transcript",
  "awaiting_completed_call",
  "evidence_too_large",
  "approved_rules_required",
  "call_scope_invalid",
  "call_evidence_unavailable",
  "feedback_unavailable",
  "review_store_unavailable",
  "slack_destination_unapproved",
  "slack_workspace_mismatch",
  "slack_channel_not_available",
  "slack_unavailable",
  "slack_verification_failed",
  "slack_connection_required",
  "slack_delivery_failed",
  "slack_receipt_invalid",
  "worker_store_unavailable",
  "review_settings_changed",
  "review_lease_superseded",
]);
export function careSafeError(error: unknown): string {
  return error instanceof Error && SAFE_ERRORS.has(error.message)
    ? error.message
    : "care_operation_failed";
}
