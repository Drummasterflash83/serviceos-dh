/** Revalidate a pinned phone account and the operator switch between bounded pages.
 * This narrows the revocation window; it is not an atomic database publication lock.
 */
import { captureAdmission } from "./learn_capture_control.ts";
import { resolveSimwoodAccount, type SimwoodAccountResult } from "./simwood-account.ts";

type BoundAccount = Extract<SimwoodAccountResult, { ok: true }>;
type Db = Parameters<typeof resolveSimwoodAccount>[0] & Parameters<typeof captureAdmission>[0];
export function phoneCaptureGuard(db: Db, tenantId: string, expected: BoundAccount) {
  return async () => {
    const account = await resolveSimwoodAccount(db, tenantId, expected.customerId);
    if (!account.ok) return { allowed: false as const, ...account };
    if (account.accountId !== expected.accountId || account.connectorId !== expected.connectorId)
      return {
        allowed: false as const,
        code: "phone_account_changed",
        message:
          "The company phone connection changed. Restart this sync with its current settings.",
        httpStatus: 409,
      };
    // Read the switch last, immediately before the bounded provider/write step.
    return captureAdmission(db, tenantId, "phone");
  };
}
