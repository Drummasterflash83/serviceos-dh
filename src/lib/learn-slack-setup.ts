import { SlackImportError } from "./learn-slack-import-errors.ts";
import type { LearnReadClient } from "./learn-cards.ts";
export type SlackConnectionOption = { id: string; teamId: string; name: string; revision: string };
type SetupClient = LearnReadClient & {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: any; error: { code?: string } | null }>;
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
export async function loadSlackConnections(
  db: Pick<SetupClient, "rpc">,
  tenantId: string,
): Promise<SlackConnectionOption[]> {
  if (!uuid(tenantId)) throw Error("Invalid workspace");
  const { data, error } = await db.rpc("learn_slack_connections_read", {
    p_tenant_id: tenantId,
  });
  if (error || !Array.isArray(data)) throw Error("Slack connections could not be read.");
  if (
    data.length > 1 ||
    data.some(
      (c: any) =>
        c.tenant_id !== tenantId ||
        !uuid(c.id) ||
        c.status !== "configured" ||
        c.revoked_at !== null ||
        !/^T[A-Z0-9]+$/.test(c.team_id) ||
        typeof c.updated_at !== "string" ||
        !Number.isFinite(Date.parse(c.updated_at)),
    )
  )
    throw Error("Slack connection details need review.");
  return data.map((c: any) => ({
    id: c.id,
    teamId: c.team_id,
    name:
      typeof c.team_name === "string" && c.team_name.trim() ? c.team_name.slice(0, 200) : c.team_id,
    revision: c.updated_at,
  }));
}
export function slackChannelId(value: string, teamId: string): string | null {
  const raw = value.trim();
  if (/^C[A-Z0-9]{1,99}$/.test(raw)) return raw;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.hostname !== "app.slack.com" || u.username || u.password)
      return null;
    const parts = u.pathname.split("/");
    return parts.length === 4 &&
      parts[1] === "client" &&
      parts[2] === teamId &&
      /^C[A-Z0-9]{1,99}$/.test(parts[3])
      ? parts[3]
      : null;
  } catch {
    return null;
  }
}
export type SlackImportRequest = {
  requestId: string;
  tenantId: string;
  connection: SlackConnectionOption;
  channelId: string;
  start: string;
  end: string;
  maxPages: number;
  reason: string;
};
export function validateSlackImportRequest(input: SlackImportRequest, now = Date.now()) {
  const start = Date.parse(input.start),
    end = Date.parse(input.end);
  if (
    !uuid(input.requestId) ||
    !uuid(input.tenantId) ||
    !uuid(input.connection.id) ||
    !Number.isFinite(Date.parse(input.connection.revision)) ||
    !/^C[A-Z0-9]{1,99}$/.test(input.channelId) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start ||
    end > now ||
    !Number.isInteger(input.maxPages) ||
    input.maxPages < 1 ||
    input.maxPages > 10 ||
    !input.reason.trim() ||
    input.reason.trim().length > 1000
  )
    throw Error("Choose a fixed past period, a public channel, page limit and reason.");
}

export async function startSlackImport(
  db: SetupClient,
  input: SlackImportRequest,
  now = Date.now(),
) {
  validateSlackImportRequest(input, now);
  const start = Date.parse(input.start),
    end = Date.parse(input.end);
  const { data, error } = await db.rpc("learn_slack_start_import", {
    p_tenant_id: input.tenantId,
    p_request_id: input.requestId,
    p_connection_id: input.connection.id,
    p_expected_revision: input.connection.revision,
    p_channel_id: input.channelId,
    p_start: new Date(start).toISOString(),
    p_end: new Date(end).toISOString(),
    p_max_pages: input.maxPages,
    p_reason: input.reason.trim(),
  });
  if (error)
    throw new SlackImportError(
      error.code ?? "unknown",
      ["40001", "PT409"].includes(error.code ?? "")
        ? "Connection or request changed. Reload setup before continuing."
        : error.code === "55000"
          ? "This channel has an active or incomplete import, or its connector is disabled. Review the existing import before starting another."
          : error.code === "22023"
            ? "The import details were rejected. Review the channel and window before approving again."
            : error.code === "42501"
              ? "Company owner/admin or OpenFolk administrator access is required."
              : "Import was not confirmed. Retry the same request to avoid duplicates; the setup service may need deploying.",
    );
  if (
    !data ||
    data.requestId !== input.requestId ||
    !uuid(data.accountId) ||
    !uuid(data.jobId) ||
    typeof data.reused !== "boolean"
  )
    throw Error("Import response could not be verified. Retry the same request.");
  return data as { requestId: string; accountId: string; jobId: string; reused: boolean };
}
