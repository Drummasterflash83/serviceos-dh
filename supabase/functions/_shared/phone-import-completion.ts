import type { SimwoodAccountResult } from "./simwood-account.ts";

type Db = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
};
type Import = {
  tenantId: string;
  runId: string;
  account: Extract<SimwoodAccountResult, { ok: true }>;
  kind: "calls" | "recordings";
  pages: number;
  recordsProcessed: number;
  metadata: Record<string, unknown>;
};
const unconfirmed = () => ({
  ok: false as const,
  code: "phone_completion_unconfirmed",
  message:
    "Import completion could not be confirmed. Existing records are retained for reconciliation.",
  httpStatus: 503,
});

/** One completion attempt. Unknown acknowledgements must not overwrite a run
 * that may have committed, advance a cursor, or launch follow-on processing. */
export async function completePhoneImport(db: Db, input: Import) {
  try {
    const { data, error } = await db.rpc("learn_phone_complete_import", {
      p_tenant: input.tenantId,
      p_run: input.runId,
      p_account: input.account.accountId,
      p_connector: input.account.connectorId,
      p_customer: input.account.customerId,
      p_kind: input.kind,
      p_pages: input.pages,
      p_records: input.recordsProcessed,
      p_metadata: input.metadata,
    });
    if (error) {
      if (error.code === "PT409" && error.message === "learn_capture_paused")
        return {
          ok: false as const,
          code: "learn_capture_paused",
          message: "Capture is paused. Existing records remain available.",
          httpStatus: 409,
        };
      if (error.code === "PT409" && error.message === "phone_account_unavailable")
        return {
          ok: false as const,
          code: "phone_account_unavailable",
          message: "The company phone connection changed. Review its registered connection.",
          httpStatus: 409,
        };
      return unconfirmed();
    }
    if (
      !data ||
      data.version !== "learn-phone-import/1" ||
      data.tenantId !== input.tenantId ||
      data.runId !== input.runId ||
      data.accountId !== input.account.accountId ||
      data.connectorId !== input.account.connectorId ||
      data.customerId !== input.account.customerId ||
      data.kind !== input.kind ||
      data.pages !== input.pages ||
      data.recordsProcessed !== input.recordsProcessed ||
      data.from !== input.metadata.from ||
      data.to !== input.metadata.to ||
      data.windowComplete !== true
    )
      return unconfirmed();
    return { ok: true as const };
  } catch {
    return unconfirmed();
  }
}
