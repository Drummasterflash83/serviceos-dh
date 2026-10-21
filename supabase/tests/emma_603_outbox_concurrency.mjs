// Run after emma_603_outbox_synthetic.sql in a disposable local Docker DB:
// EMMA_603_TEST_DB=emma603test3 node supabase/tests/emma_603_outbox_concurrency.mjs
// The hard guards prevent accidentally pointing this test at a real project.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const db = process.env.EMMA_603_TEST_DB;
const container = process.env.EMMA_603_CONTAINER ?? "serviceos-emma-603-sql-check";
if (!/^emma603test\d+$/.test(db ?? "") || container !== "serviceos-emma-603-sql-check") {
  throw new Error("Synthetic local Emma 603 container and database required");
}
async function sql(query) {
  const { stdout } = await run("docker", ["exec", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db, "-c", query]);
  return stdout.trim();
}
const tenant = "00000000-0000-0000-0000-000000000001";
const source = "00000000-0000-0000-0000-000000000007";
const message = "00000000-0000-0000-0000-000000000009";
await sql(`insert into public.receptionist_voicemail_intakes values
('00000000-0000-0000-0000-000000000008','${tenant}','00000000-0000-0000-0000-000000000002',
'00000000-0000-0000-0000-000000000003','${message}','published',101,repeat('b',64),repeat('c',64));
insert into public.receptionist_voicemail_sources values
('${source}','${tenant}','00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000003',repeat('a',64));`);
const prepare = `set role service_role; select delivery_id||'|'||target from public.emma_603_prepare('${tenant}','${source}',
jsonb_set(synthetic.core(),'{deposit,mailboxMessageId}','"${message}"'),'C123456');`;
const prepared = await Promise.all(Array.from({ length: 8 }, () => sql(prepare)));
assert.equal(new Set(prepared).size, 1, "all concurrent preparations must return the same three IDs");
assert.equal(prepared[0].split("\n").length, 3);
assert.equal(await sql(`select count(*) from public.receptionist_emergency_603_outbox where source_id='${source}'`), "3");

const claim = `set role service_role; select delivery_id from public.emma_603_claim('${tenant}')`;
const claimed = (await Promise.all(Array.from({ length: 8 }, () => sql(claim)))).filter(Boolean);
assert.equal(claimed.length, 3, "only three prepared rows may be claimed");
assert.equal(new Set(claimed).size, 3, "concurrent claims must not duplicate a reservation");
assert.equal(await sql(`select count(*) from public.receptionist_emergency_603_outbox where source_id='${source}' and state='reserved'`), "3");
console.log("Emma 603 concurrent preparation and claim: 8 workers, three unique rows, three unique reservations");
