/** Recurring discovery uses the existing worker tick and SQL's replayable batch.
 * It never emits Phone health success or claims provider history is complete. */
type Db = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
};
export type DiscoveryTick = {
  state: "skipped" | "busy" | "idle" | "completed" | "attention" | "unconfirmed";
  historicalReceipt: boolean;
  routesAttempted?: number;
  routesFailed?: number;
  pages?: number;
  rowsExamined?: number;
  jobsEnqueued?: number;
  observedAt?: string;
  coverageComplete: false;
};
export async function runVoicemailDiscoveryTick(
  db: Db,
  jobTypes: string[] | null,
): Promise<DiscoveryTick> {
  const simple = (state: DiscoveryTick["state"]): DiscoveryTick => ({
    state,
    historicalReceipt: false,
    coverageComplete: false,
  });
  // A deliberately narrow run must not start an unrelated connector.
  if (jobTypes?.length && !jobTypes.includes("phone.voicemail_import")) return simple("skipped");
  try {
    const { data, error } = await db.rpc("voicemail_schedule_tick", {});
    if (
      error ||
      !data ||
      data.coverage_complete !== false ||
      typeof data.historical_receipt !== "boolean"
    )
      return simple("unconfirmed");
    if (data.state === "busy" && data.historical_receipt === false) return simple("busy");
    if (!["idle", "completed", "attention"].includes(data.state)) return simple("unconfirmed");
    const limits = {
      routes_attempted: 2,
      routes_failed: 2,
      pages: 10,
      rows_examined: 1000,
      jobs_enqueued: 1000,
    };
    for (const [key, max] of Object.entries(limits))
      if (!Number.isSafeInteger(data[key]) || data[key] < 0 || data[key] > max)
        return simple("unconfirmed");
    if (
      typeof data.observed_at !== "string" ||
      !Number.isFinite(Date.parse(data.observed_at)) ||
      data.routes_failed > data.routes_attempted ||
      data.jobs_enqueued > data.rows_examined
    )
      return simple("unconfirmed");
    if (
      (data.state === "idle" &&
        (data.routes_attempted !== 0 ||
          data.pages !== 0 ||
          data.rows_examined !== 0 ||
          data.jobs_enqueued !== 0)) ||
      (data.state === "completed" && (data.routes_attempted === 0 || data.routes_failed !== 0)) ||
      (data.state === "attention" && data.routes_failed === 0)
    )
      return simple("unconfirmed");
    return {
      state: data.state,
      historicalReceipt: data.historical_receipt,
      routesAttempted: data.routes_attempted,
      routesFailed: data.routes_failed,
      pages: data.pages,
      rowsExamined: data.rows_examined,
      jobsEnqueued: data.jobs_enqueued,
      observedAt: data.observed_at,
      coverageComplete: false,
    };
  } catch {
    return simple("unconfirmed");
  }
}
