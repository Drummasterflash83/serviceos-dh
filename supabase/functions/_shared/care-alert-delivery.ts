import {
  verifyCareChannel,
  postCareAlert,
  slackEscape,
  SlackRejectedDelivery,
} from "./care-slack.ts";
import { careSafeError } from "./care-provider-scan.ts";
export type CareAlert = {
  id: string;
  tenant_id: string;
  issue_id: string;
  kind: string;
  reason: string;
  lease_id: string;
  team_id: string;
  channel_id: string;
  client_msg_id: string;
};
export async function deliverCareAlert(
  alert: CareAlert,
  deps: {
    token: string;
    allowedTeam: string;
    fetcher?: typeof fetch;
    issue: () => Promise<{
      title: string;
      priority: string;
      stage: string;
      company: string;
      report?: string | null;
    }>;
    currentRoute: () => Promise<{ team_id: string; channel_id: string; enabled: boolean } | null>;
    ack: (channel: string, timestamp: string) => Promise<void>;
    fail: (safeError: string, uncertain: boolean) => Promise<void>;
  },
) {
  let sending = false;
  try {
    if (!deps.token || !deps.allowedTeam) throw Error("slack_connection_required");
    const route = await deps.currentRoute();
    if (!route?.enabled || route.team_id !== alert.team_id || route.channel_id !== alert.channel_id)
      throw Error("slack_destination_unapproved");
    await verifyCareChannel(
      deps.token,
      deps.allowedTeam,
      alert.team_id,
      alert.channel_id,
      deps.fetcher,
    );
    const issue = await deps.issue();
    const title =
      alert.kind === "urgent"
        ? "Needs urgent attention"
        : alert.kind === "attention"
          ? "Your decision is needed"
          : "Progress update";
    const link = `https://app.openfolk.ai/openfolk/${encodeURIComponent(alert.tenant_id)}?module=receptionist&issue=${encodeURIComponent(alert.issue_id)}`;
    const text = `OpenFolk · ${slackEscape(issue.company)} · AI receptionist\n${title}: ${slackEscape(issue.title)}\nStatus: ${slackEscape(issue.stage)}\n<${link}|Open the review desk>\nReference: ${alert.id}${issue.report ? `\n\n${slackEscape(issue.report)}` : ""}`;
    // Slack may truncate oversized text. Hold the complete report instead of losing its evidence.
    if (text.length > 30_000) throw Error("evidence_too_large");
    // A timeout after this point is unknown delivery, never a claim of success or a blind resend.
    sending = true;
    const receipt = await postCareAlert({
      token: deps.token,
      channel: alert.channel_id,
      text,
      reference: alert.client_msg_id,
      fetcher: deps.fetcher,
    });
    await deps.ack(receipt.channel, receipt.ts);
    return { delivered: true };
  } catch (error) {
    const uncertain = sending && !(error instanceof SlackRejectedDelivery);
    await deps.fail(careSafeError(error), uncertain);
    return { delivered: false, uncertain };
  }
}

/**
 * A lost POST receipt may have been delivered. Look for positive evidence only;
 * absence, retention limits, missing permissions and exhausted page budgets never permit resend.
 * https://docs.slack.dev/reference/methods/conversations.history/
 */
export async function reconcileCareDelivery(
  alert: { team_id: string; channel_id: string; client_msg_id: string; created_at: string },
  deps: {
    token: string;
    allowedTeam: string;
    fetcher?: typeof fetch;
    now?: number;
    maxPages?: number;
  },
): Promise<{ channel: string; ts: string } | null> {
  const start = Date.parse(alert.created_at),
    end = deps.now ?? Date.now();
  const maxPages = deps.maxPages ?? 3;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    start > end ||
    !Number.isInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > 10 ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(alert.client_msg_id)
  )
    throw Error("slack_receipt_invalid");
  const fetcher = deps.fetcher ?? fetch;
  const verified = await verifyCareChannel(
    deps.token,
    deps.allowedTeam,
    alert.team_id,
    alert.channel_id,
    fetcher,
  );
  if (!verified.user_id && !verified.bot_id) throw Error("slack_verification_failed");
  const oldest = String(Math.floor(start / 1000));
  const latest = (end / 1000).toFixed(6);
  let cursor = "";
  const seenCursors = new Set<string>();
  for (let page = 0; page < maxPages; page++) {
    const url = new URL("https://slack.com/api/conversations.history");
    url.search = new URLSearchParams({
      channel: alert.channel_id,
      oldest,
      latest,
      inclusive: "true",
      limit: "100",
      ...(cursor ? { cursor } : {}),
    }).toString();
    const response = await fetcher(url, {
      method: "GET",
      redirect: "error",
      headers: { Authorization: `Bearer ${deps.token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw Error("slack_unavailable");
    const body = await response.json();
    if (body.ok !== true || !Array.isArray(body.messages) || body.messages.length > 100)
      throw Error("slack_verification_failed");
    for (const message of body.messages) {
      if (message?.client_msg_id !== alert.client_msg_id) continue;
      // A copied reference posted by another member is not a provider delivery receipt.
      if (!(
        (verified.user_id && message.user === verified.user_id) ||
        (verified.bot_id && message.bot_id === verified.bot_id)
      ))
        continue;
      if (message.team !== undefined && message.team !== verified.team_id)
        throw Error("slack_workspace_mismatch");
      if (
        typeof message.ts !== "string" ||
        !/^[0-9]{10,}\.[0-9]{6}$/.test(message.ts) ||
        Number(message.ts) < Number(oldest) ||
        Number(message.ts) > Number(latest)
      )
        throw Error("slack_receipt_invalid");
      return { channel: verified.channel_id, ts: message.ts };
    }
    const next = body.response_metadata?.next_cursor;
    if (next !== undefined && typeof next !== "string") throw Error("slack_receipt_invalid");
    if (!next?.trim()) return null;
    if (seenCursors.has(next)) throw Error("slack_receipt_invalid");
    seenCursors.add(next);
    cursor = next;
  }
  return null;
}
