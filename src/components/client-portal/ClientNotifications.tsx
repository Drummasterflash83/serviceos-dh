import { useState, type FormEvent } from "react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { Bell, CheckCircle2, MessageSquare, Send } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import "@/styles/client-notifications.css";
type Route = {
  event_key: string;
  channel_id: string;
  channel_name: string;
  enabled: boolean;
  version: number;
};
type Settings = {
  connection: { generation: string; team_name: string; enabled: boolean } | null;
  routes: Route[];
  events: { key: string; label: string; detail: string }[];
  deliveries: {
    id: string;
    event_key: string;
    state: string;
    channel_name: string;
    created_at: string;
    attempts: number;
  }[];
};
async function request<T>(body: Record<string, unknown>): Promise<T> {
  const r = await getSupabaseClient().functions.invoke("customer-notifications", { body });
  if (r.error) {
    const detail =
      r.error.context instanceof Response
        ? await r.error.context
            .clone()
            .json()
            .catch(() => null)
        : null;
    throw Error(detail?.error ?? "Notifications could not be loaded. Please try again.");
  }
  return r.data;
}
export function ClientNotifications({ tenant, userId }: { tenant: string; userId: string }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const settings = useQuery({
    queryKey: ["customer-notifications", userId, tenant],
    queryFn: () => request<Settings>({ tenantId: tenant, action: "status" }),
    retry: false,
    refetchInterval: 30000,
  });
  const connection = settings.data?.connection;
  const channels = useInfiniteQuery({
    queryKey: ["customer-slack-channels", userId, tenant, connection?.generation],
    enabled: connection?.enabled === true,
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      request<{ channels: { id: string; name: string }[]; nextCursor: string | null }>({
        tenantId: tenant,
        action: "channels",
        generation: connection?.generation,
        cursor: pageParam,
      }),
    getNextPageParam: (last) => last.nextCursor || undefined,
    retry: false,
  });
  const available = [
    ...new Map(
      (channels.data?.pages.flatMap((x) => x.channels) ?? []).map((c) => [c.id, c]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
  async function act(action: string, extra: Record<string, unknown>, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await request({
        tenantId: tenant,
        generation: connection?.generation ?? null,
        action,
        ...extra,
      });
      setMessage(success);
      await settings.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function connect(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const botToken = String(new FormData(form).get("botToken") ?? "").trim();
    form.reset();
    void act(
      "connect",
      { botToken },
      "Slack connected. Choose a channel and send a test for each update below.",
    );
  }
  if (settings.isPending) return <p role="status">Opening your notifications…</p>;
  if (settings.isError)
    return (
      <div className="cp-error" role="alert">
        {settings.error.message} <button onClick={() => void settings.refetch()}>Try again</button>
      </div>
    );
  const data = settings.data;
  return (
    <div className="cn">
      <section className="cn-card cn-intro">
        <MessageSquare size={28} />
        <div>
          <h2>Stay in the loop, in Slack.</h2>
          <p>Know when OpenFolk picks up your feedback and when it’s resolved.</p>
          <span className="cn-badge">
            {connection?.enabled
              ? `Connected · ${connection.team_name}`
              : "Ready to connect your Slack"}
          </span>
        </div>
      </section>
      <section className="cn-card">
        <details open={!connection?.enabled}>
          <summary>
            {connection?.enabled ? "Manage Slack connection" : "Connect your company’s Slack"}
          </summary>
          <p>
            Your Slack administrator can connect a bot installed in your company’s workspace. This
            is separate from OpenFolk’s internal Slack.
          </p>
          <ol>
            <li>
              <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer">
                Open Slack app settings ↗
              </a>{" "}
              and create or choose your company’s app.
            </li>
            <li>
              Add bot permissions <code>chat:write</code>, <code>channels:read</code> and{" "}
              <code>groups:read</code>, then install it in your workspace.
            </li>
            <li>
              Invite the bot to your chosen channels. Enter its bot token below, then choose your
              notifications.
            </li>
          </ol>
          <form onSubmit={connect}>
            <label>
              Bot token
              <input
                name="botToken"
                type="password"
                placeholder="xoxb-…"
                autoComplete="off"
                maxLength={1000}
                required
                disabled={busy}
              />
            </label>
            <small>
              Encrypted on the server. Never paste a token into feedback or chat. No message-history
              permission is requested.
            </small>
            <label className="cn-consent">
              <input type="checkbox" required disabled={busy} />
              I’m authorised to connect this Slack workspace for our team’s notifications.
            </label>
            <button className="cn-primary" disabled={busy}>
              {busy
                ? "Checking…"
                : connection?.enabled
                  ? "Verify replacement connection"
                  : "Verify & connect"}
            </button>
          </form>
          {connection?.enabled && (
            <>
              <p>Replacing the connection pauses all routes until you test them again.</p>
              <button
                disabled={busy}
                className="cn-secondary"
                onClick={() =>
                  void act(
                    "disconnect",
                    {},
                    "Slack notifications paused. OpenFolk’s monitoring is unchanged.",
                  )
                }
              >
                Disconnect notifications
              </button>
              <small>
                A message already being sent may still arrive. Remove the app in Slack to revoke its
                token.
              </small>
            </>
          )}
        </details>
      </section>
      {message && (
        <p className="cn-success" role="status">
          <CheckCircle2 size={18} />
          {message}
        </p>
      )}
      {error && (
        <p className="cp-error" role="alert">
          {error}
        </p>
      )}
      <div className="cn-heading">
        <h2>Your updates. Your channels.</h2>
        <p>
          Brief progress updates and a private link to your feedback. No call transcripts or
          internal working notes are sent.
        </p>
      </div>
      {connection?.enabled && (
        <div className="cn-channel-tools">
          <button
            className="cn-secondary"
            disabled={busy || channels.isFetching}
            onClick={() => void channels.refetch()}
          >
            Refresh channels
          </button>
          {channels.hasNextPage && (
            <button className="cn-secondary" onClick={() => void channels.fetchNextPage()}>
              More channels
            </button>
          )}
          {channels.isError && <p role="alert">{channels.error.message}</p>}
          {channels.isPending && <p>Checking channels…</p>}
        </div>
      )}
      <div className="cn-routes">
        {data.events.map((event) => (
          <NotificationRoute
            key={`${event.key}:${data.routes.find((r) => r.event_key === event.key)?.version ?? 0}:${connection?.generation}`}
            event={event}
            route={data.routes.find((r) => r.event_key === event.key)}
            channels={available}
            disabled={busy || !connection?.enabled || channels.isError}
            onSave={(channel) =>
              act(
                "save_route",
                {
                  eventKey: event.key,
                  channelId: channel,
                  version: data.routes.find((r) => r.event_key === event.key)?.version ?? 0,
                },
                "Test delivered. This channel will receive new updates.",
              )
            }
            onPause={() =>
              act(
                "pause_route",
                {
                  eventKey: event.key,
                  version: data.routes.find((r) => r.event_key === event.key)?.version ?? 0,
                },
                "This notification is paused.",
              )
            }
          />
        ))}
      </div>
      <section className="cn-card">
        <h2>Recent notifications</h2>
        {!data.deliveries.length ? (
          <p>
            Your updates will appear here once a channel is connected and new feedback progresses.
          </p>
        ) : (
          <ul className="cn-deliveries">
            {data.deliveries.map((d) => (
              <li key={d.id}>
                <div>
                  <strong>
                    {data.events.find((e) => e.key === d.event_key)?.label ?? "Emma update"}
                  </strong>
                  <small>
                    #{d.channel_name} · {new Date(d.created_at).toLocaleString("en-GB")}
                  </small>
                </div>
                <span className="cn-badge">
                  {d.state === "sent"
                    ? "Delivered"
                    : d.state === "uncertain" || d.attempts >= 8
                      ? "OpenFolk needs to check"
                      : d.state === "failed"
                        ? "Retry scheduled"
                        : d.state === "posting"
                          ? "Sending"
                          : d.state === "cancelled"
                            ? "Cancelled"
                            : "Queued"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="cn-foot">
        <Bell size={16} />
        These settings notify your team. OpenFolk’s own alerts continue separately. Other
        notification channels can be added later.
      </p>
    </div>
  );
}
function NotificationRoute({
  event,
  route,
  channels,
  disabled,
  onSave,
  onPause,
}: {
  event: Settings["events"][number];
  route?: Route;
  channels: { id: string; name: string }[];
  disabled: boolean;
  onSave: (channel: string) => Promise<void>;
  onPause: () => Promise<void>;
}) {
  const [channel, setChannel] = useState(route?.channel_id ?? "");
  return (
    <section className="cn-card">
      <h3>{event.label}</h3>
      <p>{event.detail}</p>
      <span className="cn-badge">{route?.enabled ? `On · #${route.channel_name}` : "Off"}</span>
      <label>
        Slack channel
        <select value={channel} onChange={(e) => setChannel(e.target.value)} disabled={disabled}>
          <option value="">Choose a channel</option>
          {route && !channels.some((c) => c.id === route.channel_id) && (
            <option value={route.channel_id}>#{route.channel_name} — checking access</option>
          )}
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              #{c.name}
            </option>
          ))}
        </select>
      </label>
      <button
        className="cn-primary"
        disabled={disabled || !channels.some((c) => c.id === channel)}
        onClick={() => void onSave(channel)}
      >
        <Send size={15} />
        Send test & turn on
      </button>
      {route?.enabled && (
        <button className="cn-secondary" disabled={disabled} onClick={() => void onPause()}>
          Turn off
        </button>
      )}
    </section>
  );
}
