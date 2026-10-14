import { test } from "node:test";
import assert from "node:assert/strict";
import { readCustomerBusinessContext } from "./learn-customer-business-context.ts";
const id = (n: number) => `cf820000-aaaa-4000-8000-${String(n).padStart(12, "0")}`;
const args = { tenant: id(1), actor: id(2), card: id(3), collection: "sites" as const };
const row = (n: number) => ({
  id: id(n),
  fields: {
    label: "Synthetic site",
    address_text: null,
    postcode: null,
    verified: false,
    source_system: "alternative-provider",
    external_id: "12",
    updated_at: null,
  },
  truncated_fields: [],
  sources: [],
});
const response = () => ({
  version: "learn-customer-business-context/1",
  tenant_id: args.tenant,
  actor_id: args.actor,
  card_id: args.card,
  collection: args.collection,
  after: null,
  operator_mode: false,
  audit_id: null,
  rows: [row(10)],
  total: 1,
  next_after: null,
  observed_at: new Date().toISOString(),
});
function db(data: any) {
  return {
    rpc(name: string, params: any) {
      assert.equal(name, params.p_collection === "jobs" ? "learn_customer_jobs_recent" : "learn_customer_business_context");
      assert.equal(params.p_tenant, args.tenant);
      assert.equal(params.p_card, args.card);
      return {
        abortSignal(signal: AbortSignal) {
          assert.ok(signal);
          return Promise.resolve({ data, error: null });
        },
      };
    },
  };
}
test("canonical context binds tenant, actor, card and collection and accepts another provider", async () => {
  const r = await readCustomerBusinessContext(db(response()), args, new AbortController().signal);
  assert.equal(r.rows[0].fields.source_system, "alternative-provider");
  assert.equal(r.total, 1);
  for (const field of ["tenant_id", "actor_id", "card_id", "collection"]) {
    const p: any = response();
    p[field] = "foreign";
    await assert.rejects(readCustomerBusinessContext(db(p), args, new AbortController().signal));
  }
});
test("operator responses require their own audit and the requested operator mode", async () => {
  const op = { ...args, operatorReason: "Review client relationships" };
  await assert.rejects(
    readCustomerBusinessContext(db(response()), op, new AbortController().signal),
  );
  const p: any = { ...response(), operator_mode: true, audit_id: id(99) };
  assert.equal(
    (await readCustomerBusinessContext(db(p), op, new AbortController().signal)).rows.length,
    1,
  );
  await assert.rejects(readCustomerBusinessContext(db(p), args, new AbortController().signal));
  p.audit_id = null;
  await assert.rejects(readCustomerBusinessContext(db(p), op, new AbortController().signal));
});
test("pagination is ordered, bounded and cannot mix cursors or duplicate a row", async () => {
  const p: any = {
    ...response(),
    rows: Array.from({ length: 25 }, (_, n) => row(10 + n)),
    total: 26,
    next_after: id(34),
  };
  assert.equal(
    (await readCustomerBusinessContext(db(p), args, new AbortController().signal)).next_after,
    id(34),
  );
  for (const mutate of [
    (x: any) => x.rows.push(row(40)),
    (x: any) => (x.rows[1] = x.rows[0]),
    (x: any) => (x.next_after = id(35)),
    (x: any) => (x.after = id(5)),
    (x: any) => (x.total = 0),
  ]) {
    const x = structuredClone(p);
    mutate(x);
    await assert.rejects(readCustomerBusinessContext(db(x), args, new AbortController().signal));
  }
});
test("expired, malformed, private extra fields and invented source references fail visibly", async () => {
  for (const mutate of [
    (x: any) => (x.observed_at = "2000-01-01T00:00:00Z"),
    (x: any) => (x.rows[0].fields.secret = "private"),
    (x: any) => (x.rows[0].fields.label = true),
    (x: any) => (x.rows[0].truncated_fields = ["not_a_field"]),
    (x: any) => (x.rows[0].sources = [{ provider: "unknown" }]),
  ]) {
    const p: any = response();
    mutate(p);
    await assert.rejects(readCustomerBusinessContext(db(p), args, new AbortController().signal));
  }
});

const jobsArgs = { ...args, collection: "jobs" as const };
const job = (n: number, created: string | null) => ({ id: id(n), fields: {
  title: "001. Recorded Commusoft description", job_number: "0008", description: null,
  status: "completed", priority: null, site_id: null, verified: false, source_system: "commusoft",
  external_id: "8", created_date: created, completed_date: null, updated_at: null,
  time_evidence: { created: { state: "absent", source: null, instant: null },
    completed: { state: "timezone_required", source: "2026-10-01 12:00:00", instant: null } },
}, truncated_fields: [], sources: [] });
const jobsResponse = (rows: any[]) => ({ ...response(), version: "learn-customer-jobs-recent/1",
  collection: "jobs", order: "created_desc", rows, total: rows.length });
test("recent jobs use recorded creation, exact job codes, tied UUIDs and undated rows last", async () => {
  const p = jobsResponse([job(90,"2026-10-01T10:00:00Z"),job(91,"2026-10-01T11:00:00+01:00"),
    job(10,"2026-09-01T00:00:00Z"),job(2,null),job(3,null)]);
  const r = await readCustomerBusinessContext(db(p),jobsArgs,new AbortController().signal);
  assert.deepEqual(r.rows.map(x=>x.id),p.rows.map(x=>x.id));
  assert.equal(r.order,"created_desc");
  assert.equal(r.rows[0].fields.job_number,"0008");
  assert.equal(r.rows[0].fields.title,"001. Recorded Commusoft description");
  assert.equal(r.rows[0].fields.time_evidence.completed.state,"timezone_required");
});
test("incorrect chronological order, ambiguous dates, repeated rows and wrong protocol fail visibly", async () => {
  const good = jobsResponse([job(90,"2026-10-01T10:00:00Z"),job(10,"2026-09-01T00:00:00Z"),job(2,null)]);
  for (const change of [
    (p:any)=>p.rows.reverse(),
    (p:any)=>p.rows[0].fields.created_date="not-a-date",
    (p:any)=>p.rows[0].fields.created_date="2026-10-01T10:00:00",
    (p:any)=>p.rows[0].fields.created_date=null,
    (p:any)=>p.rows[1]=p.rows[0],
    (p:any)=>p.version="learn-customer-business-context/1",
    (p:any)=>p.order="id_asc",
    (p:any)=>p.rows[1]=job(1,"2026-10-01T10:00:00Z"),
  ]) {
    const p=structuredClone(good);change(p);
    await assert.rejects(readCustomerBusinessContext(db(p),jobsArgs,new AbortController().signal));
  }
});
test("recent-job continuation binds the cursor without assuming UUID chronological order", async () => {
  const p:any=jobsResponse([job(2,"2026-09-01T00:00:00Z")]);p.after=id(90);
  assert.equal((await readCustomerBusinessContext(db(p),{...jobsArgs,after:id(90)},new AbortController().signal)).rows[0].id,id(2));
  p.rows=[job(90,"2026-09-01T00:00:00Z")];
  await assert.rejects(readCustomerBusinessContext(db(p),{...jobsArgs,after:id(90)},new AbortController().signal));
  const full:any=jobsResponse(Array.from({length:25},(_,n)=>job(100-n,new Date(Date.UTC(2026,9,25-n)).toISOString())));
  full.next_after=id(76);full.total=26;
  assert.equal((await readCustomerBusinessContext(db(full),jobsArgs,new AbortController().signal)).next_after,id(76));
  full.next_after=id(100);
  await assert.rejects(readCustomerBusinessContext(db(full),jobsArgs,new AbortController().signal));
});
