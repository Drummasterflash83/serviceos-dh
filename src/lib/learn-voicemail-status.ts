export type VoicemailRouteStatus = {
  route_id: string;
  enabled: boolean;
  extension: string | null;
  status: {
    scope: "retained_email_candidates";
    coverage_complete: false;
    capture_allowed: boolean;
    generation: number | null;
    pass_started_at: string | null;
    pass_completed_at: string | null;
    rows_examined: number | null;
    next_scan_at: string | null;
    observed_at: string;
    candidates: number;
    needs_review: number;
    excluded: number;
    jobs: Record<string, number>;
    review_reasons: Record<string, number>;
    dispatch: {
      last_attempt_at: string | null;
      last_success_at: string | null;
      next_attempt_at: string | null;
      code: string | null;
    };
  };
};
export type VoicemailStatusPage = {
  version: "learn-voicemail-status/1";
  tenant_id: string;
  observed_at: string;
  routes: VoicemailRouteStatus[];
  next_after: string | null;
};
export type VoicemailStatusClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};
const object = (v: any): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const date = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const nullable = (v: unknown, check: (v: unknown) => boolean) => v === null || check(v);
export const voicemailReviewHelp: Record<string, string> = {
  voicemail_mailbox_binding_unverified:
    "Verify the original mailbox through email history capture, then review the mailbox route.",
  voicemail_received_time_unverified:
    "Refresh the original email to verify its receipt time; do not infer it from the sender's date.",
  voicemail_provider_source_unavailable:
    "The original email is unavailable from the provider. Check retention or an authorised archive.",
  voicemail_provider_response_invalid:
    "Refresh the retained email metadata and check the provider message reference.",
  voicemail_route_ambiguous:
    "Review overlapping routes for this mailbox and historical period before importing.",
  voicemail_source_previously_routed:
    "Review the original route and its retained job before changing mailbox ownership.",
  voicemail_provider_source_changed:
    "Review the source change against its original job; retain both histories.",
};
const dispatchCodes = [
  "voicemail_capture_paused",
  "voicemail_route_unverified",
  "voicemail_discovery_unconfirmed",
];
const jobStates = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "retrying",
  "skipped",
  "dead_letter",
];
export function validVoicemailPage(
  v: any,
  tenantId: string,
  after: string | null,
): v is VoicemailStatusPage {
  if (
    !object(v) ||
    v.version !== "learn-voicemail-status/1" ||
    v.tenant_id !== tenantId ||
    !date(v.observed_at) ||
    !Array.isArray(v.routes) ||
    v.routes.length > 20 ||
    !nullable(v.next_after, uuid)
  )
    return false;
  let previous = after;
  for (const r of v.routes) {
    if (
      !object(r) ||
      !uuid(r.route_id) ||
      (previous !== null && r.route_id <= previous) ||
      typeof r.enabled !== "boolean" ||
      !nullable(r.extension, (x) => typeof x === "string" && /^[0-9]{3}$/.test(x))
    )
      return false;
    previous = r.route_id;
    const s = r.status;
    if (
      !object(s) ||
      s.scope !== "retained_email_candidates" ||
      s.coverage_complete !== false ||
      typeof s.capture_allowed !== "boolean" ||
      !date(s.observed_at) ||
      !nullable(s.generation, count) ||
      !nullable(s.rows_examined, count) ||
      ![s.pass_started_at, s.pass_completed_at, s.next_scan_at].every((d) => nullable(d, date)) ||
      ![s.candidates, s.needs_review, s.excluded].every(count) ||
      s.needs_review + s.excluded > s.candidates
    )
      return false;
    if (
      !object(s.jobs) ||
      !Object.entries(s.jobs).every(([k, n]) => jobStates.includes(k) && count(n)) ||
      Object.values(s.jobs).reduce((a: number, n: any) => a + n, 0) > s.candidates
    )
      return false;
    if (
      !object(s.review_reasons) ||
      !Object.entries(s.review_reasons).every(
        ([k, n]) => Object.hasOwn(voicemailReviewHelp, k) && count(n),
      ) ||
      Object.values(s.review_reasons).reduce((a: number, n: any) => a + n, 0) !== s.needs_review
    )
      return false;
    if (
      !object(s.dispatch) ||
      ![s.dispatch.last_attempt_at, s.dispatch.last_success_at, s.dispatch.next_attempt_at].every(
        (d) => nullable(d, date),
      ) ||
      !nullable(s.dispatch.code, (x) => typeof x === "string" && dispatchCodes.includes(x))
    )
      return false;
  }
  return v.next_after === null || (v.routes.length === 20 && v.next_after === previous);
}
export async function readVoicemailStatus(
  client: VoicemailStatusClient,
  tenantId: string,
  after: string | null = null,
): Promise<VoicemailStatusPage> {
  if (!uuid(tenantId) || !nullable(after, uuid)) throw Error("Voicemail status scope is invalid.");
  try {
    const { data, error } = await client.rpc("learn_operator_voicemail_status", {
      p_tenant: tenantId,
      p_after: after,
    });
    if (error || !validVoicemailPage(data, tenantId, after)) throw Error();
    return data;
  } catch {
    throw Error(
      "Voicemail status could not be verified. Refresh status or check OpenFolk access and the backend release.",
    );
  }
}
export function voicemailScanState(route: VoicemailRouteStatus): string {
  const s = route.status;
  if (!route.enabled || !s.capture_allowed) return "Capture paused";
  if (s.dispatch.code) return "Scan needs attention";
  if (!s.dispatch.last_success_at) return "Awaiting first worker scan";
  if (
    Date.parse(s.observed_at) - Date.parse(s.dispatch.last_success_at) > 20 * 60_000 &&
    (!s.next_scan_at || Date.parse(s.next_scan_at) < Date.parse(s.observed_at))
  )
    return "Scan overdue — check the worker schedule";
  return s.pass_completed_at ? "Retained-email pass finished" : "Scanning retained emails";
}
