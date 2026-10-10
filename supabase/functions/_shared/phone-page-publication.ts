/** One atomic source-page publication. Never retry an unknown outcome or fall back
 * to direct writes: the database receipt is the durable reconciliation evidence.
 */
import type { SimwoodAccountResult } from "./simwood-account.ts";
type Db = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
};
type Page = {
  tenantId: string;
  runId: string;
  account: Extract<SimwoodAccountResult, { ok: true }>;
  kind: "calls" | "recordings";
  page: number;
  records: Record<string, unknown>[];
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const unconfirmed = () => ({
  ok: false as const,
  code: "phone_page_unconfirmed",
  message:
    "This phone page could not be confirmed. Existing records are retained; the sync window remains incomplete.",
  httpStatus: 503,
});
export async function publishPhonePage(db: Db, page: Page) {
  try {
    const { data, error } = await db.rpc("learn_phone_publish_page", {
      p_tenant: page.tenantId,
      p_run: page.runId,
      p_account: page.account.accountId,
      p_connector: page.account.connectorId,
      p_customer: page.account.customerId,
      p_kind: page.kind,
      p_page: page.page,
      p_records: page.records,
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
      data.version !== "learn-phone-page/1" ||
      data.tenantId !== page.tenantId ||
      data.runId !== page.runId ||
      data.page !== page.page ||
      data.kind !== page.kind ||
      data.recordsProcessed !== page.records.length ||
      !Array.isArray(data.newRecordingIds) ||
      data.newRecordingIds.length > page.records.length ||
      !data.newRecordingIds.every(uuid) ||
      new Set(data.newRecordingIds).size !== data.newRecordingIds.length ||
      (page.kind === "calls" && data.newRecordingIds.length !== 0)
    )
      return unconfirmed();
    return {
      ok: true as const,
      recordsProcessed: data.recordsProcessed as number,
      newRecordingIds: data.newRecordingIds as string[],
    };
  } catch {
    return unconfirmed();
  }
}
