import test from "node:test";
import assert from "node:assert/strict";
import {
  completeProviderPage,
  includeLocalCalls,
  providerPageItems,
  syncWindowComplete,
} from "./phone-sync-completeness.ts";

test("provider list validation fails closed without disguising malformed data as no calls", () => {
  for (const payload of [null, {}, { error: "not_authorised" }, { items: null }, [null], [7], [[]]])
    assert.equal(providerPageItems(payload), null);
  assert.deepEqual(providerPageItems({ items: [{ callId: "one" }] }), [{ callId: "one" }]);
  assert.deepEqual(providerPageItems([]), []);
});

test("a short fully-consumed page or empty page proves exhaustion", () => {
  assert.equal(completeProviderPage({ returned: 0, selected: 0, pageSize: 200 }), true);
  assert.equal(completeProviderPage({ returned: 19, selected: 19, pageSize: 200 }), true);
});
test("a full last page at the safety cap does not prove completeness", () => {
  assert.equal(completeProviderPage({ returned: 200, selected: 200, pageSize: 200 }), false);
  assert.equal(syncWindowComplete(false, 0), false);
});
test("manual limits and malformed records cannot become successful cursor windows", () => {
  assert.equal(completeProviderPage({ returned: 19, selected: 10, pageSize: 200 }), false);
  assert.equal(syncWindowComplete(true, 1), false);
  assert.equal(syncWindowComplete(true, 0), true);
});
test("local-leg capture requires explicit boolean opt-in", () => {
  for (const settings of [
    null,
    {},
    { include_local_calls: false },
    { include_local_calls: "true" },
  ])
    assert.equal(includeLocalCalls(settings), false);
  assert.equal(includeLocalCalls({ include_local_calls: true }), true);
});
