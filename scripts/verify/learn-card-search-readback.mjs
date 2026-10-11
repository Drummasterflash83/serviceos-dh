import assert from "node:assert/strict";
import { searchLearnCards } from "../../src/lib/learn-cards.ts";
let text = "";
for await (const c of process.stdin) text += c;
const { tenant, responses } = JSON.parse(text);
for (const r of responses) {
  const page = await searchLearnCards(
    { rpc: async () => ({ data: r.response, error: null }) },
    tenant,
    r.kind,
    r.query,
    r.page,
    Date.now(),
    r.group,
  );
  assert.equal(page.cards.length, r.response.rows.length);
  assert.equal(page.hasMore, r.response.hasMore);
}
console.log(`Actual SQL-to-client card parsing: PASS (${responses.length} pages)`);
