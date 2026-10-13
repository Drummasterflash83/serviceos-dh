import test from "node:test";
import assert from "node:assert/strict";
import { readQuickBooksImports } from "./learn-quickbooks-import.ts";
const tenant = "00000000-0000-4000-8000-000000000001";
const base = () => ({
  tenantId: tenant,
  checkedAt: "2026-10-13T15:00:00Z",
  enabled: true,
  learnEnabled: true,
  runs: [],
  counts: [],
});
test("import status rejects foreign tenants, unknown scopes and misleading coverage", () => {
  assert.equal(readQuickBooksImports(base(), tenant).enabled, true);
  for (const patch of [
    { tenantId: "00000000-0000-4000-8000-000000000002" },
    { checkedAt: "invalid" },
    { enabled: "true" },
    {
      counts: [
        {
          environment: "production",
          realmId: 9007199254740992,
          entity: "Invoice",
          records: 1,
          conflictedRecords: 0,
          lastObservedAt: base().checkedAt,
        },
      ],
    },
    { runs: [{ id: tenant, connectionId: tenant, state: "complete", coverage: "complete" }] },
  ])
    assert.throws(() => readQuickBooksImports({ ...base(), ...patch }, tenant));
});
