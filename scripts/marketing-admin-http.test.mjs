// ServiceOS — Marketing Phase 3 HTTP-contract proof (requires a SERVED edge runtime).
//
// Exercises the REAL authenticated HTTP boundaries of marketing-admin,
// marketing-segments, the marketing-contacts Phase-3 actions and the contacts
// data-import path — the layers the DB suites deliberately do not claim.
// Exits 3 with NOT-RUN when the endpoints are unreachable — it never fakes success.
//
// Contract covered (post-correction):
//   malformed JSON → 400 on every function (never a silent default read).
//   marketing-admin: ops role → 403; owner settings_get/update (stale → 409
//     VERSION_CONFLICT; no-op → 400), access_set (restricted grant → 400;
//     lockout → 409 LOCKOUT), audit_list with typed next_cursor.
//   marketing-access: DISABLED Marketing returns reason=not_enabled + the
//     caller's own role, so owner/admin get the governed re-enable path.
//   marketing-segments: viewer → 403; ops create/evaluate (+ next_cursor,
//     expected_version race → 409); unsupported filter → 400 honest message;
//     stale update → 409; archive needs expected_updated_at.
//   marketing-contacts: tag_bulk preflight issues a CONTRACT; apply without it
//     → 400/409; bounded; foreign ids counted only.
//   data-import (contacts): the EXACT DEFAULT UI-SHAPED request — no
//     profile_id, source_system='generic', contact_options.source='csv_upload'
//     — resolves + SEALS the platform profile and applies to canonical People;
//     preview surfaces the resolved profile; mapping_overrides re-preview;
//     modified CSV → 409 checksum_mismatch; completed apply → idempotent
//     'already'; row_results bounded download.
// Self-cleaning synthetic tenants. Exits 3 NOT-RUN without a served runtime.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!SR || !ANON) {
  console.error("MISSING env (SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY)");
  process.exit(2);
}
const FN = (name) => `${URL}/functions/v1/${name}`;
const admin = createClient(URL, SR, { auth: { persistSession: false } });
const T = "84a03000-0000-4000-8000-0000000084ab";
const USERS = {
  owner: { id: "84a03000-0000-4000-8000-0000000084c1", role: "owner" },
  ops: { id: "84a03000-0000-4000-8000-0000000084c2", role: "ops" },
  viewer: { id: "84a03000-0000-4000-8000-0000000084c3", role: "viewer" },
};

let failed = 0;
const ok = (l, c, x) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${x !== undefined ? `  [${x}]` : ""}`);
  if (!c) failed++;
};

async function call(fn, token, body) {
  const res = await fetch(FN(fn), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

async function cleanup() {
  for (const u of Object.values(USERS)) await admin.auth.admin.deleteUser(u.id).catch(() => {});
  for (const table of [
    "marketing_import_row_results",
    "import_row_provenance",
    "data_imports",
    "marketing_segment_versions",
    "marketing_segments",
    "contact_tag_assignments",
    "marketing_tags",
    "contact_points",
    "contact_relationships",
    "marketing_access_grants",
    "marketing_identity_conflicts",
    "marketing_settings_history",
    "marketing_lifecycle_stages",
    "marketing_settings",
    "audit_logs",
    "platform_events",
  ]) {
    await admin.from(table).delete().eq("tenant_id", T);
  }
  await admin.from("people").delete().eq("tenant_id", T);
  await admin.from("tenants").delete().eq("id", T);
}

async function main() {
  try {
    const probe = await fetch(FN("marketing-admin"), { method: "OPTIONS" });
    if (!probe.ok) throw new Error(`status ${probe.status}`);
  } catch (e) {
    console.error(`NOT-RUN  marketing-admin endpoint unreachable (${e.message}).`);
    console.error("Serve the functions (supabase functions serve) or point at a deployed env.");
    process.exit(3);
  }

  await cleanup();
  await admin.from("tenants").insert({ id: T, slug: "p3-http", display_name: "P3 HTTP" });
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const tokens = {};
  for (const [k, u] of Object.entries(USERS)) {
    const c = await admin.auth.admin.createUser({
      id: u.id,
      email: `${k}@p3-http.test`,
      password: "Proof-Passw0rd!",
      email_confirm: true,
    });
    if (c.error) return ok(`create ${k}`, false, c.error.message);
    await admin.from("profiles").update({ tenant_id: T, role: u.role }).eq("id", u.id);
    const si = await anon.auth.signInWithPassword({
      email: `${k}@p3-http.test`,
      password: "Proof-Passw0rd!",
    });
    if (si.error) return ok(`sign in ${k}`, false, si.error.message);
    tokens[k] = si.data.session.access_token;
  }
  await admin.rpc("marketing_materialise_defaults", { p_tenant: T, p_actor: USERS.owner.id });

  // ── malformed JSON is a 400 everywhere, never a silent default read ──
  for (const fn of ["marketing-admin", "marketing-segments", "marketing-contacts"]) {
    const res = await fetch(FN(fn), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: ANON,
        Authorization: `Bearer ${tokens.owner}`,
      },
      body: "{not json",
    });
    ok(`${fn}: malformed JSON → 400`, res.status === 400, res.status);
  }

  // ── marketing-admin ──
  let r = await call("marketing-admin", tokens.ops, { action: "settings_get" });
  ok("admin: ops role → 403", r.status === 403, r.status);
  r = await call("marketing-admin", tokens.owner, {
    action: "settings_get",
    sneaky_key: true,
  });
  ok("admin: unknown top-level key → 400", r.status === 400, r.status);
  r = await call("marketing-admin", tokens.owner, { action: "settings_get" });
  ok(
    "admin: owner settings_get 200",
    r.status === 200 && r.body?.data?.settings?.version === 1,
    r.status,
  );
  r = await call("marketing-admin", tokens.owner, {
    action: "settings_update",
    changes: { timezone: "Europe/London" },
    expected_version: 1,
  });
  ok("admin: settings_update 200 → v2", r.status === 200 && r.body?.data?.version === 2, r.status);
  r = await call("marketing-admin", tokens.owner, {
    action: "settings_update",
    changes: { tracking_enabled: true },
    expected_version: 1,
  });
  ok(
    "admin: stale settings_update → 409 VERSION_CONFLICT",
    r.status === 409 && r.body?.error?.code === "VERSION_CONFLICT",
    r.status,
  );
  r = await call("marketing-admin", tokens.owner, {
    action: "access_set",
    profile_id: USERS.ops.id,
    permission: "marketing.campaigns.launch",
    mode: "grant",
    expected: "none",
  });
  ok("admin: restricted grant → 400", r.status === 400, r.status);
  r = await call("marketing-admin", tokens.owner, {
    action: "access_set",
    profile_id: USERS.owner.id,
    permission: "marketing.access.manage",
    mode: "deny",
    expected: "none",
  });
  ok(
    "admin: last-manager deny → 409 LOCKOUT",
    r.status === 409 && r.body?.error?.code === "LOCKOUT",
    r.body?.error?.code,
  );
  // no-op settings update rejected before any history/audit
  r = await call("marketing-admin", tokens.owner, {
    action: "settings_update",
    changes: { timezone: "Europe/London" },
    expected_version: 2,
  });
  ok("admin: same-value settings update → 400 (no-op)", r.status === 400, r.status);
  // STRICT nested contracts: hostile extra keys are REJECTED, never
  // silently normalized away
  r = await call("marketing-admin", tokens.owner, {
    action: "audit_list",
    cursor: { t: new Date().toISOString(), id: USERS.owner.id, sneaky: 1 },
  });
  ok("admin: audit cursor with extra key → 400", r.status === 400, r.status);
  r = await call("marketing-admin", tokens.owner, { action: "audit_list", limit: 2 });
  ok(
    "admin: audit_list bounded 200 with typed next_cursor",
    r.status === 200 &&
      Array.isArray(r.body?.data?.items) &&
      (r.body?.data?.next_cursor === null || typeof r.body?.data?.next_cursor?.id === "string"),
    r.status,
  );
  if (r.body?.data?.next_cursor) {
    const first = r.body.data.items.map((i) => i.id);
    r = await call("marketing-admin", tokens.owner, {
      action: "audit_list",
      limit: 2,
      cursor: r.body.data.next_cursor,
    });
    ok(
      "admin: audit cursor advances without repeats (equal-timestamp safe)",
      r.status === 200 && !r.body.data.items.some((i) => first.includes(i.id)),
      r.status,
    );
  }

  // ── marketing-access: DISABLED → owner sees not_enabled + own role ──
  r = await call("marketing-admin", tokens.owner, {
    action: "settings_update",
    changes: { marketing_enabled: false },
    expected_version: 2,
  });
  ok("admin: disable marketing 200", r.status === 200, r.status);
  r = await call("marketing-access", tokens.owner, {});
  ok(
    "access: disabled owner → not_enabled + role for the governed re-enable path",
    r.status === 200 &&
      r.body?.data?.can_view === false &&
      r.body?.data?.reason === "not_enabled" &&
      r.body?.data?.role === "owner",
    JSON.stringify(r.body?.data),
  );
  r = await call("marketing-access", tokens.viewer, {});
  ok(
    "access: disabled viewer → not_enabled with viewer role (no admin path)",
    r.status === 200 && r.body?.data?.reason === "not_enabled" && r.body?.data?.role === "viewer",
    JSON.stringify(r.body?.data),
  );
  // the governed re-enable path itself (owner role suffices while disabled)
  r = await call("marketing-admin", tokens.owner, {
    action: "settings_update",
    changes: { marketing_enabled: true },
    expected_version: 3,
  });
  ok("admin: owner re-enables while disabled (recovery path)", r.status === 200, r.status);

  // ── marketing-segments ──
  r = await call("marketing-segments", tokens.viewer, { action: "list" });
  ok("segments: viewer without view → 403", r.status === 403, r.status);
  r = await call("marketing-segments", tokens.ops, {
    action: "create",
    args: { name: "HTTP seg", definition: { field: "last_contact", never: true } },
  });
  ok(
    "segments: ops create 200",
    r.status === 200 && r.body?.data?.definition_version === 1,
    r.status,
  );
  const segId = r.body?.data?.id;
  r = await call("marketing-segments", tokens.ops, { action: "evaluate", segment_id: segId });
  ok(
    "segments: evaluate 200 with count",
    r.status === 200 && typeof r.body?.data?.count === "number",
    r.status,
  );
  r = await call("marketing-segments", tokens.ops, {
    action: "evaluate",
    definition: { field: "campaign_engagement", value: "opened" },
  });
  ok(
    "segments: unsupported filter → 400 with honest message",
    r.status === 400 && /unsupported/i.test(r.body?.error?.message ?? ""),
    r.status,
  );
  r = await call("marketing-segments", tokens.ops, {
    action: "update",
    args: { segment_id: segId, expected_version: 9, name: "X" },
  });
  ok("segments: stale update → 409", r.status === 409, r.status);
  // saved-evaluation VERSION CAPTURE over HTTP
  r = await call("marketing-segments", tokens.ops, {
    action: "update",
    args: {
      segment_id: segId,
      expected_version: 1,
      definition: { field: "search", value: "http" },
    },
  });
  ok("segments: definition update → v2", r.status === 200, r.status);
  r = await call("marketing-segments", tokens.ops, {
    action: "evaluate",
    segment_id: segId,
    expected_version: 1,
  });
  ok("segments: stale expected_version evaluation → 409", r.status === 409, r.status);
  // archive requires the OBSERVABLE updated_at token
  r = await call("marketing-segments", tokens.ops, {
    action: "archive",
    args: { segment_id: segId, expected_version: 2 },
  });
  ok("segments: archive without expected_updated_at → 400", r.status === 400, r.status);
  r = await call("marketing-segments", tokens.ops, {
    action: "evaluate",
    segment_id: segId,
    cursor: { v: "", id: USERS.ops.id, sneaky: 1 },
  });
  ok("segments: cursor with extra key → 400", r.status === 400, r.status);

  // ── marketing-contacts Phase-3 actions ──
  r = await call("marketing-contacts", tokens.ops, { action: "tags_admin_list" });
  ok("contacts: tags_admin_list 200", r.status === 200, r.status);
  r = await call("marketing-contacts", tokens.ops, { action: "tag_create", label: "HTTP Tag" });
  const tagId = r.body?.data?.id;
  // tag_admin: exact per-operation nested shape — a rename cannot smuggle a tone
  {
    const t = await admin.from("marketing_tags").select("updated_at").eq("id", tagId).single();
    r = await call("marketing-contacts", tokens.ops, {
      action: "tag_admin",
      op: "rename",
      args: {
        tag_id: tagId,
        expected_updated_at: t.data.updated_at,
        label: "X",
        tone: "negative",
      },
    });
    ok("contacts: tag_admin rename with extra 'tone' arg → 400", r.status === 400, r.status);
  }
  const person = await admin
    .from("people")
    .insert({ tenant_id: T, display_name: "HTTP P3 Person" })
    .select("id")
    .single();
  r = await call("marketing-contacts", tokens.ops, {
    action: "tag_bulk_preflight",
    op: "assign",
    tag_id: tagId,
    person_ids: [person.data.id, person.data.id, "84a03000-0000-4000-8000-00000000ffff"],
  });
  ok(
    "contacts: bulk preflight — duplicates collapse, foreign ids counted not echoed",
    r.status === 200 &&
      r.body?.data?.requested === 3 &&
      r.body?.data?.unique === 2 &&
      r.body?.data?.rejected === 1 &&
      r.body?.data?.applicable === 1 &&
      typeof r.body?.data?.contract === "string",
    JSON.stringify(r.body?.data),
  );
  const bulkContract = r.body?.data?.contract;
  r = await call("marketing-contacts", tokens.ops, {
    action: "tag_bulk_apply",
    op: "assign",
    tag_id: tagId,
    person_ids: [person.data.id],
  });
  ok("contacts: bulk apply without contract → 400", r.status === 400, r.status);
  r = await call("marketing-contacts", tokens.ops, {
    action: "tag_bulk_apply",
    op: "assign",
    tag_id: tagId,
    person_ids: [person.data.id, person.data.id, "84a03000-0000-4000-8000-00000000ffff"],
    contract: bulkContract,
  });
  ok(
    "contacts: contract-bound bulk apply 200",
    r.status === 200 && r.body?.data?.applied === 1,
    r.status,
  );

  // ── data-import (contacts): the EXACT DEFAULT UI-SHAPED FLOW ──
  // No explicit profile_id; source_system='generic';
  // contact_options.source='csv_upload' — preview must resolve + SEAL the
  // platform profile, and apply must succeed from the sealed contract alone.
  const csv = "name,email\nImport One,import1@p3-http.test\nImport Two,import2@p3-http.test\n";
  const uiShaped = {
    action: "preview",
    entity_type: "contacts",
    source_system: "generic",
    csv_text: csv,
    filename: "t.csv",
    contact_options: { source: "csv_upload" },
  };
  r = await call("data-import", tokens.viewer, uiShaped);
  ok("import: viewer without contacts.import → 403", r.status === 403, r.status);
  r = await call("data-import", tokens.ops, uiShaped);
  ok(
    "import: DEFAULT UI-SHAPED preview 200 — profile RESOLVED + sealed + counts",
    r.status === 200 &&
      r.body?.preview?.will_create === 2 &&
      r.body?.preview?.contact_options?.source === "csv_upload" &&
      typeof r.body?.preview?.profile?.id === "string" &&
      typeof r.body?.preview?.profile?.version === "number" &&
      Array.isArray(r.body?.preview?.profile?.fields),
    JSON.stringify(r.body?.preview?.profile ?? r.body),
  );
  ok(
    "import: blank UI defaults sealed as EXPLICIT resolved values (never live fallbacks)",
    typeof r.body?.preview?.contact_options?.lifecycle_stage_key === "string" &&
      typeof r.body?.preview?.contact_options?.relationship_type === "string",
    JSON.stringify(r.body?.preview?.contact_options),
  );
  // MASKED SAMPLES: known contact PII never appears verbatim in the preview
  ok(
    "import: preview sample is masked — raw emails/names never verbatim",
    !JSON.stringify(r.body?.preview?.sample ?? []).includes("import1@p3-http.test") &&
      !JSON.stringify(r.body?.preview?.sample ?? []).includes("Import One"),
    JSON.stringify(r.body?.preview?.sample?.[0] ?? null),
  );
  // PROFILE HARDENING: wrong-entity explicit profile can never be sealed
  {
    const wrong = await admin
      .from("import_profiles")
      .select("id")
      .eq("entity_type", "customers")
      .limit(1)
      .maybeSingle();
    if (wrong.data) {
      const w = await call("data-import", tokens.ops, {
        ...uiShaped,
        profile_id: wrong.data.id,
      });
      ok(
        "import: wrong-entity explicit profile → 400 profile_mismatch",
        w.status === 400,
        w.status,
      );
    }
  }
  const importId = r.body?.import_id;
  {
    const row = await admin
      .from("data_imports")
      .select("profile_id,source_system,preview")
      .eq("id", importId)
      .single();
    ok(
      "import: resolved profile id persisted; provenance source separate",
      row.data?.profile_id === r.body?.preview?.profile?.id &&
        row.data?.source_system === "csv_upload" &&
        typeof row.data?.preview?.sealed?.profile?.definition_sha256 === "string",
      JSON.stringify({ p: row.data?.profile_id, s: row.data?.source_system }),
    );
  }
  // mapping review: an override re-previews and re-seals
  r = await call("data-import", tokens.ops, {
    ...uiShaped,
    mapping_overrides: { secondary_email: null },
  });
  ok(
    "import: mapping_overrides accepted, validated and re-sealed",
    r.status === 200 && !("secondary_email" in (r.body?.preview?.mapping ?? {})),
    r.status,
  );
  r = await call("data-import", tokens.ops, {
    ...uiShaped,
    mapping_overrides: { made_up_field: 0 },
  });
  ok("import: unknown mapping override field → 400", r.status === 400, r.status);
  r = await call("data-import", tokens.ops, {
    action: "apply",
    import_id: importId,
    csv_text: csv + "Tamper,tamper@p3-http.test\n",
  });
  ok("import: modified CSV → 409 checksum_mismatch", r.status === 409, r.status);
  r = await call("data-import", tokens.ops, {
    action: "apply",
    import_id: importId,
    csv_text: csv,
  });
  ok(
    "import: apply from the sealed contract creates canonical People",
    r.status === 200 && r.body?.created === 2,
    JSON.stringify({ status: r.status, created: r.body?.created }),
  );
  {
    const ppl = await admin
      .from("people")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", T)
      .in("primary_email", ["import1@p3-http.test", "import2@p3-http.test"]);
    ok("import: canonical People exist with imported emails", ppl.count === 2, ppl.count);
  }
  r = await call("data-import", tokens.ops, {
    action: "apply",
    import_id: importId,
    csv_text: csv,
  });
  ok(
    "import: second apply idempotent WITH the full totals contract",
    r.status === 200 &&
      r.body?.already === true &&
      r.body?.created === 2 &&
      typeof r.body?.import?.status === "string",
    JSON.stringify({ already: r.body?.already, created: r.body?.created }),
  );
  // SEALED-CONTRACT PREFLIGHT: retire the sealed stage, then apply on a fresh
  // preview sealed to it → 409 invalid_preview BEFORE any row/failed write
  {
    const pv = await call("data-import", tokens.ops, {
      ...uiShaped,
      csv_text: csv + "Extra Person,extra@p3-http.test\n",
      contact_options: { source: "csv_upload", lifecycle_stage_key: "contact_attempted" },
    });
    if (pv.status === 200) {
      const stage = await admin
        .from("marketing_lifecycle_stages")
        .select("id,updated_at")
        .eq("tenant_id", T)
        .eq("stage_key", "contact_attempted")
        .single();
      const retired = await call("marketing-admin", tokens.owner, {
        action: "lifecycle",
        op: "retire",
        args: { stage_id: stage.data.id, expected_updated_at: stage.data.updated_at },
      });
      ok(
        "import: sealed stage retired for the preflight probe",
        retired.status === 200,
        retired.status,
      );
      const ap = await call("data-import", tokens.ops, {
        action: "apply",
        import_id: pv.body?.import_id,
        csv_text: csv + "Extra Person,extra@p3-http.test\n",
      });
      ok(
        "import: unhonourable sealed stage → 409 invalid_preview (never a row failure)",
        ap.status === 409 && ap.body?.error?.code === "invalid_preview",
        JSON.stringify(ap.body?.error),
      );
      const rr = await call("data-import", tokens.ops, {
        action: "row_results",
        import_id: pv.body?.import_id,
      });
      ok(
        "import: the rejected apply wrote NO row outcomes",
        rr.status === 200 && (rr.body?.rows ?? []).length === 0,
        (rr.body?.rows ?? []).length,
      );
    } else {
      ok("import: preflight probe preview succeeded", false, pv.status);
    }
  }
  // bounded row_results download (no raw values, field names only)
  r = await call("data-import", tokens.ops, {
    action: "row_results",
    import_id: importId,
    outcomes: ["invalid", "conflict", "failed"],
  });
  ok(
    "import: row_results bounded download 200",
    r.status === 200 && Array.isArray(r.body?.rows),
    r.status,
  );

  await cleanup();
  console.log(failed === 0 ? "\nALL PASS (real HTTP boundary exercised)" : `\n${failed} FAILURES`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
