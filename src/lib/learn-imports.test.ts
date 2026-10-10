import test from "node:test";
import assert from "node:assert/strict";
import {
  loadGovernedProfiles,
  loadGovernedImports,
  loadGovernedImport,
  loadGovernedOutcomes,
  previewGovernedImport,
  applyGovernedImport,
  importFileHash,
  validGovernedPreview,
  importProgress,
  type ImportClient,
  type GovernedProfile,
} from "./learn-imports.ts";
const tenant = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  id = "33333333-3333-4333-8333-333333333333",
  profileId = "44444444-4444-4444-8444-444444444444",
  csv = "external_id\nSYNTHETIC",
  at = "2026-10-10T04:00:00Z";
const profile: GovernedProfile = {
  id: profileId,
  tenant_id: null,
  source_system: "commusoft",
  entity_type: "customers",
  name: "Prepared customers",
  version: 1,
  definition: { governed: true, columns: [{ canonical: "external_id" }] },
};
const preview = () => ({
  headers: ["external_id"],
  mapping: { external_id: 0 },
  unmapped: [],
  missing_required: [],
  row_count: 1,
  valid: 1,
  invalid: 0,
  will_create: 1,
  will_update: 0,
  will_conflict: 0,
  will_hold: 0,
  duplicate_upload: false,
  profile: { id: profileId, name: profile.name, version: 1 },
  sealed: {
    profile: structuredClone(profile),
    mapping: { external_id: 0 },
    provenance_source: "commusoft",
    import_options: { source: "commusoft" },
  },
});
async function saved() {
  return {
    id,
    tenant_id: tenant,
    profile_id: profileId,
    source_system: "commusoft",
    entity_type: "customers" as const,
    original_filename: "synthetic.csv",
    status: "previewed",
    row_count: 1,
    valid_rows: 1,
    invalid_rows: 0,
    created_records: 0,
    updated_records: 0,
    skipped_records: 0,
    conflict_records: 0,
    created_at: at,
    completed_at: null,
    file_checksum: await importFileHash(csv),
    preview: preview(),
  };
}
function client(reply: (body: any) => any) {
  const calls: any[] = [];
  const db: ImportClient = {
    functions: {
      async invoke(name, args) {
        assert.equal(name, "learn-data-import");
        calls.push(args.body);
        return reply(args.body);
      },
    },
  };
  return { db, calls };
}
test("governed profile and history responses reject mixed companies, legacy configs and duplicate runs", async () => {
  for (const p of [
    { ...profile, tenant_id: other },
    { ...profile, definition: { columns: [] } },
    { ...profile, entity_type: "contacts" },
  ]) {
    const h = client(() => ({ data: { success: true, profiles: [p] }, error: null }));
    await assert.rejects(() => loadGovernedProfiles(h.db, tenant));
  }
  const run = await saved(),
    h = client(() => ({ data: { success: true, imports: [run, run] }, error: null }));
  await assert.rejects(() => loadGovernedImports(h.db, tenant));
});
test("malformed preview counts, mapping and sealed identity cannot become a review", () => {
  assert.equal(validGovernedPreview(preview(), tenant), true);
  for (const mutate of [
    (p: any) => (p.valid = 2),
    (p: any) => (p.will_hold = 1),
    (p: any) => (p.mapping.external_id = 2),
    (p: any) => (p.sealed.mapping = {}),
    (p: any) => (p.sealed.profile.tenant_id = other),
    (p: any) => (p.profile.id = other),
    (p: any) => (p.sealed.import_options.source = "other"),
  ]) {
    const p = preview();
    mutate(p);
    assert.equal(validGovernedPreview(p, tenant), false);
  }
});
test("preview verifies saved tenant, profile and exact bytes before returning approval evidence", async () => {
  const run = await saved(),
    h = client((b) => ({
      data:
        b.action === "preview"
          ? { success: true, import_id: id, preview: preview() }
          : { success: true, import: run },
      error: null,
    }));
  assert.equal((await previewGovernedImport(h.db, tenant, profile, csv, "synthetic.csv")).id, id);
  assert.deepEqual(
    h.calls.map((c) => c.action),
    ["preview", "status"],
  );
  assert.ok(h.calls.every((c) => c.tenant_id === tenant));
  run.tenant_id = other;
  await assert.rejects(() => previewGovernedImport(h.db, tenant, profile, csv, "synthetic.csv"));
});
test("foreign, changed and completed files never send an apply request", async () => {
  const run = await saved(),
    h = client(() => {
      throw Error("must not send");
    });
  await assert.rejects(() => applyGovernedImport(h.db, other, run, csv));
  await assert.rejects(() => applyGovernedImport(h.db, tenant, run, csv + "changed"));
  await assert.rejects(() =>
    applyGovernedImport(h.db, tenant, { ...run, status: "completed" }, csv),
  );
  assert.equal(h.calls.length, 0);
});
test("apply checks fresh state, sends once, then reloads durable state; unknown writes are not retried", async () => {
  const run = await saved();
  let submitted = false;
  const h = client((b) => {
    if (b.action === "apply") {
      submitted = true;
      return { data: { success: true }, error: null };
    }
    return {
      data: { success: true, import: { ...run, status: submitted ? "completed" : "previewed" } },
      error: null,
    };
  });
  assert.equal((await applyGovernedImport(h.db, tenant, run, csv)).status, "completed");
  assert.deepEqual(
    h.calls.map((c) => c.action),
    ["status", "apply", "status"],
  );
  const unknown = client((b) => {
    if (b.action === "apply") throw Error("PRIVATE SERVER ERROR");
    return { data: { success: true, import: run }, error: null };
  });
  await assert.rejects(
    () => applyGovernedImport(unknown.db, tenant, run, csv),
    /Reload saved imports/,
  );
  assert.deepEqual(
    unknown.calls.map((c) => c.action),
    ["status", "apply"],
  );
  const changed = client(() => ({
    data: { success: true, import: { ...run, status: "completed" } },
    error: null,
  }));
  await assert.rejects(() => applyGovernedImport(changed.db, tenant, run, csv));
  assert.equal(changed.calls.length, 1);
});
test("empty responses, row duplicates and unknown outcomes never imply success", async () => {
  const h = client(() => ({ data: null, error: { message: "PRIVATE" } }));
  await assert.rejects(
    () => loadGovernedImports(h.db, tenant),
    (e) => !String(e).includes("PRIVATE"),
  );
  const row = {
    row_number: 2,
    outcome: "held",
    reason: "customer_not_imported",
    fields: ["customer_external_id"],
    attempt: 1,
    created_at: at,
  };
  for (const rows of [[row, row], [{ ...row, outcome: "surprise" }], [{ ...row, attempt: 0 }]]) {
    const h = client(() => ({
      data: {
        success: true,
        tenant_id: tenant,
        import_id: id,
        after_row: 1,
        page_size: 100,
        next_after_row: null,
        rows,
        truncated: false,
      },
      error: null,
    }));
    await assert.rejects(() => loadGovernedOutcomes(h.db, tenant, id));
  }
  const good = client(() => ({
    data: {
      success: true,
      tenant_id: tenant,
      import_id: id,
      after_row: 1,
      page_size: 100,
      next_after_row: null,
      rows: [row],
      truncated: false,
    },
    error: null,
  }));
  assert.equal((await loadGovernedOutcomes(good.db, tenant, id)).rows[0].outcome, "held");
});
test("oversized JSON requests are rejected before transport and completed-invalid rows remain visible", async () => {
  const h = client(() => {
    throw Error("must not call");
  });
  await assert.rejects(
    () =>
      previewGovernedImport(h.db, tenant, profile, "x".repeat(16 * 1024 * 1024), "synthetic.csv"),
    /16 MiB/,
  );
  assert.equal(h.calls.length, 0);
  const run = await saved();
  assert.equal(
    importProgress({ ...run, status: "completed", invalid_rows: 1 }),
    "Finished with 1 invalid rows",
  );
});

test("outcome pages verify scope, cursor, row order and exact continuation", async () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    row_number: i + 102,
    outcome: "created",
    reason: null,
    fields: [],
    attempt: 1,
    created_at: at,
  }));
  const reply = {
    success: true,
    tenant_id: tenant,
    import_id: id,
    after_row: 101,
    page_size: 100,
    rows,
    truncated: true,
    next_after_row: 201,
  };
  const good = client(() => ({ data: reply, error: null }));
  assert.equal((await loadGovernedOutcomes(good.db, tenant, id, 101)).next_after_row, 201);
  for (const change of [
    { tenant_id: "foreign" },
    { import_id: tenant },
    { after_row: 1 },
    { next_after_row: 200 },
    { rows: rows.slice(1) },
    { truncated: false },
    { rows: [{ ...rows[0], row_number: 101 }, ...rows.slice(1)] },
  ]) {
    const h = client(() => ({ data: { ...reply, ...change }, error: null }));
    await assert.rejects(() => loadGovernedOutcomes(h.db, tenant, id, 101));
  }
  for (const cursor of [0, 5002, 1.5, NaN])
    await assert.rejects(() => loadGovernedOutcomes(good.db, tenant, id, cursor));
});
