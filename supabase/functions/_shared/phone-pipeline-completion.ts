/** Confirm this pipeline run's terminal write; a lost reply is not success. */
type Db = { from: (table: string) => any };
type Completion = {
  tenantId: string;
  runId: string;
  status: "success" | "failed";
  recordsProcessed: number;
  metadata: Record<string, unknown>;
  errorMessage: string | null;
};
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );

export async function confirmPhonePipelineCompletion(db: Db, input: Completion): Promise<boolean> {
  const completedAt = new Date().toISOString();
  const patch = {
    status: input.status,
    completed_at: completedAt,
    records_processed: input.recordsProcessed,
    error_message: input.errorMessage,
    metadata: input.metadata,
  };
  const fields =
    "id,tenant_id,provider,sync_type,status,completed_at,records_processed,error_message,metadata";
  const matches = (row: any): boolean =>
    Boolean(
      row &&
      row.id === input.runId &&
      row.tenant_id === input.tenantId &&
      row.provider === "pipeline" &&
      row.sync_type === "pipeline" &&
      row.status === input.status &&
      row.records_processed === input.recordsProcessed &&
      row.error_message === input.errorMessage &&
      Date.parse(row.completed_at) === Date.parse(completedAt) &&
      canonical(row.metadata) === canonical(input.metadata),
    );
  try {
    const saved = await db
      .from("phone_sync_runs")
      .update(patch)
      .eq("id", input.runId)
      .eq("tenant_id", input.tenantId)
      .eq("provider", "pipeline")
      .eq("sync_type", "pipeline")
      .eq("status", "running")
      .select(fields)
      .maybeSingle();
    if (!saved.error && matches(saved.data)) return true;
  } catch {
    /* The write may have committed. Read once; never blindly repeat it. */
  }
  try {
    const observed = await db
      .from("phone_sync_runs")
      .select(fields)
      .eq("id", input.runId)
      .eq("tenant_id", input.tenantId)
      .eq("provider", "pipeline")
      .eq("sync_type", "pipeline")
      .maybeSingle();
    return !observed.error && matches(observed.data);
  } catch {
    return false;
  }
}
