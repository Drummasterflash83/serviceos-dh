/** Dispatch only from an authenticated, unfiltered infrastructure tick. The
 * dedicated queues still own tenant admission, approval, pacing and settlement.
 * No provider or service credential is added to the database HTTP queue.
 */
type Config = {
  enabled?: string;
  // Explicit Slack override; absent preserves the original shared switch.
  // Enabling Slack alone never enables the Commusoft dispatcher.
  slackEnabled?: string;
  // QuickBooks never inherits another provider’s activation.
  quickbooksEnabled?: string;
  quickbooksKey?: string;
  url?: string;
  serviceKey?: string;
  commusoftKey?: string;
  slackKey?: string;
};
type Outcome = { state: "disabled" | "skipped" | "idle" | "processed" | "attention" | "unconfirmed" };
type Fetch = (input: string, init: RequestInit) => Promise<Response>;
const outcome = (state: Outcome["state"]): Outcome => ({ state });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export async function runLearnInputTick(config: Config, jobTypes: string[] | null, request: Fetch = fetch) {
  const all = (state: Outcome["state"]) => ({
    commusoft: outcome(state), slackSchedule: outcome(state), slack: outcome(state), quickbooks: outcome(state),
  });
  // Explicitly filtered invocations must never start unrelated input work, even
  // if a caller supplies an empty list. Only the ordinary cron tick dispatches.
  if (jobTypes !== null) return all("skipped");
  const commusoftEnabled = config.enabled === "true";
  const slackEnabled = config.slackEnabled === undefined ? commusoftEnabled : config.slackEnabled === "true";
  const quickbooksEnabled = config.quickbooksEnabled === "true";
  if (!commusoftEnabled && !slackEnabled && !quickbooksEnabled) return all("disabled");
  if (!/^https:\/\/[a-z]{20}\.supabase\.co$/.test(config.url ?? "") || !config.serviceKey)
    return {
      commusoft: outcome(commusoftEnabled ? "unconfirmed" : "disabled"),
      slackSchedule: outcome(slackEnabled ? "unconfirmed" : "disabled"),
      slack: outcome(slackEnabled ? "unconfirmed" : "disabled"),
      quickbooks: outcome(quickbooksEnabled ? "unconfirmed" : "disabled"),
    };

  async function invoke(name: string, key: string | undefined, schedule = false): Promise<Outcome> {
    if (!key || key.length < 20) return outcome("unconfirmed");
    try {
      const response = await request(`${config.url}/functions/v1/${name}`, {
        method: "POST", redirect: "error",
        headers: { Authorization: `Bearer ${config.serviceKey}`, "x-serviceos-worker-key": key },
        signal: AbortSignal.timeout(schedule ? 15000 : 100000),
        // Deliberately no body: even an empty JSON object is rejected by the worker.
      });
      if (response.status !== 200) { void response.body?.cancel().catch(() => {}); return outcome("unconfirmed"); }
      const value: unknown = await response.json();
      if (!object(value) || value.ok !== true || !object(value.result)) return outcome("unconfirmed");
      const result = value.result;
      if (name === "learn-quickbooks-worker") {
        if (result.claimed === 0 && ["idle", "waiting"].includes(String(result.state))) return outcome("idle");
        if (result.claimed === 1 && result.state === "saved") return outcome("processed");
        if ([0, 1].includes(result.claimed as number) && ["held", "attention"].includes(String(result.state))) return outcome("attention");
        return outcome("unconfirmed");
      }
      if (schedule) {
        const { checked, queued, held } = result;
        if (![checked, queued, held].every(v => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 10) ||
            Number(queued) + Number(held) > Number(checked)) return outcome("unconfirmed");
        return outcome(Number(held) > 0 ? "attention" : Number(checked) > 0 ? "processed" : "idle");
      }
      if (![0, 1].includes(result.claimed as number) || !Array.isArray(result.outcomes) ||
          result.outcomes.length !== result.claimed) return outcome("unconfirmed");
      if (result.claimed === 0) return outcome("idle");
      const settled = result.outcomes[0];
      if (object(settled) && settled.state === "waiting" && ["paused", "unavailable"].includes(String(settled.reason)))
        return outcome("attention");
      if (!object(settled) || !["succeeded", "retrying", "dead_letter", "waiting"].includes(String(settled.status)))
        return outcome("unconfirmed");
      return outcome(settled.status === "succeeded" ? "processed" : "attention");
    } catch {
      // No raw errors, response bodies, record IDs or credentials in the parent response.
      return outcome("unconfirmed");
    }
  }
  const [commusoft, slack, quickbooks] = await Promise.all([
    commusoftEnabled ? invoke("learn-commusoft-worker", config.commusoftKey) : outcome("disabled"),
    (async () => {
      if (!slackEnabled) return { slackSchedule: outcome("disabled"), slack: outcome("disabled") };
      const slackSchedule = await invoke("learn-slack-schedule", config.slackKey, true);
      // Existing history jobs can continue even if creating a new window failed.
      return { slackSchedule, slack: await invoke("learn-slack-worker", config.slackKey) };
    })(),
    quickbooksEnabled ? invoke("learn-quickbooks-worker", config.quickbooksKey) : outcome("disabled"),
  ]);
  return { commusoft, ...slack, quickbooks };
}
