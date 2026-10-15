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

/** A tick may settle several distinct pages, never retry an uncertain page.
 * SQL still owns admission, per-credential pacing, leases and successor creation.
 * Keep the whole sequence below the one-minute scheduler interval. */
export async function drainInputPages(
  invoke: (timeoutMs: number) => Promise<Outcome>,
  clock: () => number = () => performance.now(),
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<Outcome> {
  const deadline = clock() + 45_000;
  let progressed = false;
  for (let page = 0; page < 10; page++) {
    const remaining = Math.floor(deadline - clock());
    if (remaining <= 0) break;
    let next: Outcome;
    try { next = await invoke(remaining); }
    catch { return outcome("unconfirmed"); }
    if (next.state === "idle") return outcome(progressed ? "processed" : "idle");
    if (next.state !== "processed") return next;
    progressed = true;
    // The SQL successor has at least a 1,250 ms cooldown. Waiting does not grant
    // authority: the next worker call must claim its own currently permitted job.
    if (page === 9 || deadline - clock() <= 1_500) break;
    try { await sleep(1_500); }
    catch { return outcome("unconfirmed"); }
  }
  return outcome(progressed ? "processed" : "idle");
}

export const drainCommusoftPages = drainInputPages;

/** The reviewed internal Slack profile has a 30-second completion cooldown.
 * A second call may claim only after that SQL gate has elapsed. The ordinary
 * minute tick remains bounded to two serial calls and its existing deadline. */
export async function drainSlackPages(
  invoke: (timeoutMs: number) => Promise<Outcome>,
  clock: () => number = () => performance.now(),
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<Outcome> {
  const deadline = clock() + 55_000;
  let first: Outcome;
  try { first = await invoke(Math.floor(deadline - clock())); }
  catch { return outcome("unconfirmed"); }
  if (first.state !== "processed") return first;
  // Leave ten seconds for the second worker and settlement. An expired or
  // unreviewed profile simply returns idle after its longer database cooldown.
  if (deadline - clock() < 42_000) return first;
  try { await sleep(31_000); }
  catch { return outcome("unconfirmed"); }
  const remaining = Math.floor(deadline - clock());
  if (remaining < 10_000) return first;
  let second: Outcome;
  try { second = await invoke(remaining); }
  catch { return outcome("unconfirmed"); }
  return second.state === "idle" ? first : second;
}

export async function runLearnInputTick(
  config: Config,
  jobTypes: string[] | null,
  request: Fetch = fetch,
  timing?: { clock: () => number; sleep: (ms: number) => Promise<void> },
) {
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

  async function invoke(name: string, key: string | undefined, schedule = false, timeoutMs = schedule ? 15000 : 100000): Promise<Outcome> {
    if (!key || key.length < 20) return outcome("unconfirmed");
    try {
      const response = await request(`${config.url}/functions/v1/${name}`, {
        method: "POST", redirect: "error",
        headers: { Authorization: `Bearer ${config.serviceKey}`, "x-serviceos-worker-key": key },
        signal: AbortSignal.timeout(timeoutMs),
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
    commusoftEnabled ? drainCommusoftPages(timeoutMs => invoke("learn-commusoft-worker", config.commusoftKey, false, timeoutMs)) : outcome("disabled"),
    (async () => {
      if (!slackEnabled) return { slackSchedule: outcome("disabled"), slack: outcome("disabled") };
      const slackSchedule = await invoke("learn-slack-schedule", config.slackKey, true);
      // Existing history jobs can continue even if creating a new window failed.
      return { slackSchedule, slack: await drainSlackPages(
        timeoutMs => invoke("learn-slack-worker", config.slackKey, false, timeoutMs),
        timing?.clock,
        timing?.sleep,
      ) };
    })(),
    quickbooksEnabled ? drainInputPages(timeoutMs => invoke("learn-quickbooks-worker", config.quickbooksKey, false, timeoutMs)) : outcome("disabled"),
  ]);
  return { commusoft, ...slack, quickbooks };
}
