/** Connect the signed HTTP boundary to a current, exact approved roster and
 * a service-only durable hint recorder. The caller supplies the database IO.
 */
import type {
  SlackEventBinding,
  SlackEventHint,
  SlackHintReceipt,
} from "./slack_event_http.ts";

export type SlackEventConfig = {
  tenantId: string;
  teamId: string;
  appId: string;
  signingSecret: string;
  minTs: string;
  expectedChannels: number;
  rosterSha256: string;
};
export type SlackEventRosterRow = {
  channel_id: string;
  team_id: string;
  next_start: string;
};
export type SlackEventRecord = {
  version: string;
  eventId: string;
  state: "recorded" | "duplicate" | "excluded";
};

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const id = /^[A-Z][A-Z0-9]{1,63}$/;
const channel = /^C[A-Z0-9]{1,63}$/;
const timestamp = /^\d{10,12}\.\d{1,6}$/;
const sha256 = /^[a-f0-9]{64}$/;

export function validSlackEventConfig(config: SlackEventConfig): boolean {
  return Boolean(config && uuid.test(config.tenantId) &&
    id.test(config.teamId) && id.test(config.appId) &&
    typeof config.signingSecret === "string" && config.signingSecret.length >= 32 &&
    timestamp.test(config.minTs) &&
    Number.isSafeInteger(config.expectedChannels) &&
    config.expectedChannels >= 1 && config.expectedChannels <= 200 &&
    sha256.test(config.rosterSha256));
}

export async function bindingFromCurrentRoster(
  config: SlackEventConfig,
  loadRoster: () => Promise<SlackEventRosterRow[]>,
): Promise<SlackEventBinding | null> {
  if (!validSlackEventConfig(config)) return null;
  const rows = await loadRoster();
  if (!Array.isArray(rows) || rows.length !== config.expectedChannels) return null;
  const allowedChannels = new Set<string>();
  for (const row of rows) {
    if (!row || row.team_id !== config.teamId ||
      !channel.test(row.channel_id) || allowedChannels.has(row.channel_id) ||
      !Number.isFinite(Date.parse(row.next_start)) ||
      Date.parse(row.next_start) < Number(config.minTs) * 1000)
      return null;
    allowedChannels.add(row.channel_id);
  }
  const bytes = new TextEncoder().encode([...allowedChannels].sort().join("\n"));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const actual = [...digest].map((n) => n.toString(16).padStart(2, "0")).join("");
  if (actual !== config.rosterSha256) return null;
  return { signingSecret: config.signingSecret, teamId: config.teamId,
    appId: config.appId, allowedChannels, minTs: config.minTs };
}

export async function recordScopedSlackHint(
  config: SlackEventConfig,
  hint: SlackEventHint,
  write: (args: Record<string, unknown>) => Promise<SlackEventRecord>,
): Promise<SlackHintReceipt> {
  if (!validSlackEventConfig(config)) throw Error("slack_event_binding_unavailable");
  const args = {
    p_tenant: config.tenantId,
    p_team: config.teamId,
    p_event_id: hint.eventId,
    p_channel: hint.channelId,
    p_kind: hint.kind,
    p_event_ts: hint.kind === "message_hint" ? hint.ts : hint.eventTs,
    p_source_ts: hint.kind === "message_hint" ? hint.ts : hint.sourceTs,
    p_thread_ts: hint.threadTs,
    p_correction: hint.kind === "message_hint" ? null : hint.correction,
  };
  const receipt = await write(args);
  if (!receipt || receipt.version !== "learn-slack-event-hint/1" ||
    receipt.eventId !== hint.eventId ||
    !["recorded", "duplicate", "excluded"].includes(receipt.state))
    throw Error("slack_event_receipt_unconfirmed");
  return receipt.state;
}
