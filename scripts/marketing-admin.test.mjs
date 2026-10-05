// ServiceOS — Marketing Phase 3 RPC-boundary proof (PostgREST + real GoTrue JWTs).
//
// Proves at the REAL service boundary (post-correction contracts):
//   1. Every Phase-3 admin/segment/import RPC is SERVICE-ROLE ONLY (authenticated
//      JWTs → 42501; no Edge-Function bypass exists).
//   2. Owner administration works end-to-end over PostgREST: settings update +
//      history + stale conflict; restricted-permission enforcement; segment
//      create/evaluate with immutable versions; CONTRACT-bound bulk tagging;
//      single-contact inactive-tag lifecycle parity (deactivate → assign
//      rejected, history kept, remove legal, reactivate → assignable).
//   3. TRUE CONCURRENCY proofs:
//      - two access managers CONCURRENTLY denying themselves → exactly one
//        succeeds, one is MK423/MK409, at least one manager remains (F5);
//      - PARALLEL same-row contact-import applies serialise on the per-row
//        lock: exactly one Person for a name-only row;
//      - CONCURRENT import finalisations agree on one durable total.
//   4. VIEWER CEILING at PostgREST/RLS: hostile raw write-grant rows are inert
//      in the resolver, and the viewer JWT can neither write tables nor
//      execute the mutation RPCs.
//   5. Saved-evaluation VERSION CAPTURE: a stale expected_version conflicts
//      and leaves the stored count untouched.
// Self-cleaning synthetic tenants. HTTP layers are covered by the staged
// marketing-admin-http script (NOT-RUN until an edge runtime exists).

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!SR) {
  console.error("MISSING SUPABASE_SERVICE_ROLE_KEY env");
  process.exit(2);
}
const admin = createClient(URL, SR, { auth: { persistSession: false } });
const T = "74a03000-0000-4000-8000-0000000074ab";
const U = {
  owner: "74a03000-0000-4000-8000-0000000074c1",
  admin: "74a03000-0000-4000-8000-0000000074c2",
  ops: "74a03000-0000-4000-8000-0000000074c3",
};
const P1 = "74a03000-0000-4000-8000-0000000074d1";

let failed = 0;
const ok = (l, c, x) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${x !== undefined ? `  [${x}]` : ""}`);
  if (!c) failed++;
};

async function cleanup() {
  for (const id of Object.values(U)) await admin.auth.admin.deleteUser(id).catch(() => {});
  await admin.auth.admin.deleteUser("74a03000-0000-4000-8000-0000000074c4").catch(() => {});
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
  await cleanup();
  await admin.from("tenants").insert({ id: T, slug: "p3-proof", display_name: "P3 Proof" });
  for (const [k, id] of Object.entries(U)) {
    const c = await admin.auth.admin.createUser({
      id,
      email: `${k}@p3-proof.test`,
      password: "Proof-Passw0rd!",
      email_confirm: true,
    });
    if (c.error) return ok(`create ${k}`, false, c.error.message);
    await admin.from("profiles").update({ tenant_id: T, role: k }).eq("id", id);
  }
  await admin.rpc("marketing_materialise_defaults", { p_tenant: T, p_actor: U.owner });
  await admin.from("people").insert({ id: P1, tenant_id: T, display_name: "P3 Person" });

  // ── (1) authenticated JWTs cannot reach ANY new RPC ──
  if (ANON) {
    const base = createClient(URL, ANON, { auth: { persistSession: false } });
    const si = await base.auth.signInWithPassword({
      email: "ops@p3-proof.test",
      password: "Proof-Passw0rd!",
    });
    ok("ops signs in (real GoTrue JWT)", !si.error, si.error?.message);
    const asOps = createClient(URL, ANON, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${si.data.session.access_token}` } },
    });
    const denials = [
      [
        "settings",
        asOps.rpc("marketing_update_settings", {
          p_tenant: T,
          p_actor: U.ops,
          p_changes: {},
          p_expected_version: 1,
        }),
      ],
      [
        "lifecycle",
        asOps.rpc("marketing_lifecycle_admin", {
          p_tenant: T,
          p_actor: U.ops,
          p_op: "add",
          p_args: {},
        }),
      ],
      ["access_overview", asOps.rpc("marketing_access_overview", { p_tenant: T })],
      [
        "access_set",
        asOps.rpc("marketing_access_set", {
          p_tenant: T,
          p_actor: U.ops,
          p_profile: U.ops,
          p_permission: "marketing.view",
          p_mode: "grant",
          p_expected: "none",
        }),
      ],
      ["audit", asOps.rpc("marketing_audit_list", { p_tenant: T, p_args: {} })],
      [
        "tag_admin",
        asOps.rpc("marketing_tag_admin", {
          p_tenant: T,
          p_actor: U.ops,
          p_op: "rename",
          p_args: {},
        }),
      ],
      [
        "tag_bulk",
        asOps.rpc("marketing_tag_bulk", {
          p_tenant: T,
          p_actor: U.ops,
          p_op: "assign",
          p_tag: P1,
          p_person_ids: [P1],
          p_mode: "preflight",
        }),
      ],
      [
        "segment_mutate",
        asOps.rpc("marketing_segment_mutate", {
          p_tenant: T,
          p_actor: U.ops,
          p_op: "create",
          p_args: {},
        }),
      ],
      [
        "segment_evaluate",
        asOps.rpc("marketing_segment_evaluate", { p_tenant: T, p_actor: U.ops, p_args: {} }),
      ],
      [
        "import_row",
        asOps.rpc("marketing_import_contact_row", {
          p_tenant: T,
          p_import: P1,
          p_actor: U.ops,
          p_row_number: 1,
          p_record: {},
          p_options: {},
        }),
      ],
      ["import_match", asOps.rpc("marketing_import_match_contact", { p_tenant: T, p_record: {} })],
    ];
    for (const [name, p] of denials) {
      const r = await p;
      ok(
        `authenticated: ${name} RPC denied (42501)`,
        Boolean(r.error) && r.error.code === "42501",
        r.error?.code,
      );
    }
  } else {
    console.log("SKIP  authenticated-boundary checks (no SUPABASE_ANON_KEY)");
  }

  // ── (2) settings: update + history + stale conflict over PostgREST ──
  let r = await admin.rpc("marketing_update_settings", {
    p_tenant: T,
    p_actor: U.owner,
    p_changes: { timezone: "Europe/London" },
    p_expected_version: 1,
  });
  ok("settings: owner update succeeds", !r.error && r.data?.version === 2, r.error?.message);
  const hist = await admin
    .from("marketing_settings_history")
    .select("version,snapshot")
    .eq("tenant_id", T);
  ok(
    "settings: append-only history snapshot preserves the previous value",
    hist.data?.length === 1 && hist.data[0].snapshot?.timezone === "UTC",
  );
  r = await admin.rpc("marketing_update_settings", {
    p_tenant: T,
    p_actor: U.owner,
    p_changes: { tracking_enabled: true },
    p_expected_version: 1,
  });
  ok(
    "settings: stale version → MK409",
    Boolean(r.error) && r.error.code === "MK409",
    r.error?.code,
  );

  // ── (3) access: restricted enforcement + CONCURRENT lockout race ──
  r = await admin.rpc("marketing_access_set", {
    p_tenant: T,
    p_actor: U.owner,
    p_profile: U.ops,
    p_permission: "marketing.campaigns.launch",
    p_mode: "grant",
    p_expected: "none",
  });
  ok(
    "access: restricted grant to ops rejected",
    Boolean(r.error) && r.error.code === "22023",
    r.error?.code,
  );
  // F5 PROOF — exactly two effective managers (owner + admin) CONCURRENTLY
  // deny their own access.manage. Serialised per-tenant, one must succeed and
  // one must fail MK423 (lockout) or MK409 (stale under the lock); at least
  // one effective manager remains.
  {
    const denySelf = (who) =>
      admin.rpc("marketing_access_set", {
        p_tenant: T,
        p_actor: who,
        p_profile: who,
        p_permission: "marketing.access.manage",
        p_mode: "deny",
        p_expected: "none",
      });
    const [d1, d2] = await Promise.all([denySelf(U.owner), denySelf(U.admin)]);
    const successes = [d1, d2].filter((x) => !x.error).length;
    const blocked = [d1, d2].filter(
      (x) => x.error && ["MK423", "MK409"].includes(x.error.code),
    ).length;
    ok(
      "access RACE: concurrent self-denials → exactly one succeeds",
      successes === 1 && blocked === 1,
      `${successes} ok / ${d1.error?.code ?? "ok"},${d2.error?.code ?? "ok"}`,
    );
    const remaining = await Promise.all(
      [U.owner, U.admin].map((id) =>
        admin.rpc("marketing_effective_permissions", { p_profile_id: id }),
      ),
    );
    const managers = remaining.filter((x) =>
      (x.data?.permissions ?? []).includes("marketing.access.manage"),
    ).length;
    ok("access RACE: at least one effective manager remains", managers >= 1, managers);
    // restore: the surviving manager clears whichever self-deny landed
    const survivor = (remaining[0].data?.permissions ?? []).includes("marketing.access.manage")
      ? U.owner
      : U.admin;
    for (const who of [U.owner, U.admin]) {
      await admin.rpc("marketing_access_set", {
        p_tenant: T,
        p_actor: survivor,
        p_profile: who,
        p_permission: "marketing.access.manage",
        p_mode: "clear",
        p_expected: "denied",
      });
    }
  }
  r = await admin.rpc("marketing_access_set", {
    p_tenant: T,
    p_actor: U.owner,
    p_profile: U.admin,
    p_permission: "marketing.access.manage",
    p_mode: "deny",
    p_expected: "none",
  });
  ok("access: deny admin access.manage OK", !r.error, r.error?.message);
  r = await admin.rpc("marketing_access_set", {
    p_tenant: T,
    p_actor: U.owner,
    p_profile: U.owner,
    p_permission: "marketing.access.manage",
    p_mode: "deny",
    p_expected: "none",
  });
  ok(
    "access: last-manager deny → MK423 LOCKOUT",
    Boolean(r.error) && r.error.code === "MK423",
    r.error?.code,
  );
  await admin.rpc("marketing_access_set", {
    p_tenant: T,
    p_actor: U.owner,
    p_profile: U.admin,
    p_permission: "marketing.access.manage",
    p_mode: "clear",
    p_expected: "denied",
  });

  // ── (3b) VIEWER CEILING at PostgREST/RLS with HOSTILE raw grant rows ──
  if (ANON) {
    await admin.auth.admin.createUser({
      id: "74a03000-0000-4000-8000-0000000074c4",
      email: "viewer@p3-proof.test",
      password: "Proof-Passw0rd!",
      email_confirm: true,
    });
    await admin
      .from("profiles")
      .update({ tenant_id: T, role: "viewer" })
      .eq("id", "74a03000-0000-4000-8000-0000000074c4");
    // hostile raw rows: read grant (legitimate) + write grants (must be inert)
    await admin.from("marketing_access_grants").insert([
      {
        tenant_id: T,
        profile_id: "74a03000-0000-4000-8000-0000000074c4",
        permission: "marketing.view",
        granted: true,
      },
      {
        tenant_id: T,
        profile_id: "74a03000-0000-4000-8000-0000000074c4",
        permission: "marketing.contacts.manage",
        granted: true,
      },
      {
        tenant_id: T,
        profile_id: "74a03000-0000-4000-8000-0000000074c4",
        permission: "marketing.tags.manage",
        granted: true,
      },
    ]);
    const rv = await admin.rpc("marketing_effective_permissions", {
      p_profile_id: "74a03000-0000-4000-8000-0000000074c4",
    });
    ok(
      "viewer ceiling: hostile write grants INERT in the resolver",
      (rv.data?.permissions ?? []).includes("marketing.view") &&
        !(rv.data?.permissions ?? []).includes("marketing.contacts.manage") &&
        !(rv.data?.permissions ?? []).includes("marketing.tags.manage"),
      JSON.stringify(rv.data?.permissions ?? []),
    );
    const base2 = createClient(URL, ANON, { auth: { persistSession: false } });
    const vsi = await base2.auth.signInWithPassword({
      email: "viewer@p3-proof.test",
      password: "Proof-Passw0rd!",
    });
    const asViewer = createClient(URL, ANON, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${vsi.data.session.access_token}` } },
    });
    const w1 = await asViewer
      .from("marketing_tags")
      .insert({ tenant_id: T, key: "hostile", label: "Hostile" });
    ok("viewer ceiling: PostgREST table write denied", Boolean(w1.error), w1.error?.code);
    const w2 = await asViewer.rpc("marketing_tag_bulk", {
      p_tenant: T,
      p_actor: "74a03000-0000-4000-8000-0000000074c4",
      p_op: "assign",
      p_tag: P1,
      p_person_ids: [P1],
      p_mode: "apply",
    });
    ok(
      "viewer ceiling: mutation RPC execute denied for the viewer JWT",
      Boolean(w2.error) && w2.error.code === "42501",
      w2.error?.code,
    );
    // even through the SERVICE-ROLE path, tag create/assign/remove refuse a
    // viewer actor whose only authority is a hostile raw grant row
    const w3 = await admin.rpc("marketing_tag_mutate", {
      p_tenant: T,
      p_actor: "74a03000-0000-4000-8000-0000000074c4",
      p_op: "create",
      p_args: { label: "Hostile Tag" },
    });
    ok(
      "viewer ceiling: tag CREATE denied for the hostile-grant viewer actor",
      Boolean(w3.error) && w3.error.code === "42501",
      w3.error?.code,
    );
    const w4 = await admin.rpc("marketing_tag_mutate", {
      p_tenant: T,
      p_actor: "74a03000-0000-4000-8000-0000000074c4",
      p_op: "assign",
      p_args: { tag_id: P1, person_id: P1 },
    });
    ok(
      "viewer ceiling: tag ASSIGN denied for the hostile-grant viewer actor",
      Boolean(w4.error) && w4.error.code === "42501",
      w4.error?.code,
    );
    await admin
      .from("marketing_access_grants")
      .delete()
      .eq("profile_id", "74a03000-0000-4000-8000-0000000074c4");
    // viewer grant RPC rejection: write grants for a viewer are refused
    const g = await admin.rpc("marketing_access_set", {
      p_tenant: T,
      p_actor: U.owner,
      p_profile: "74a03000-0000-4000-8000-0000000074c4",
      p_permission: "marketing.contacts.manage",
      p_mode: "grant",
      p_expected: "none",
    });
    ok(
      "viewer ceiling: grant RPC refuses a viewer write grant",
      Boolean(g.error) && g.error.code === "22023",
      g.error?.code,
    );
    await admin.auth.admin.deleteUser("74a03000-0000-4000-8000-0000000074c4").catch(() => {});
  } else {
    console.log("SKIP  viewer-ceiling PostgREST checks (no SUPABASE_ANON_KEY)");
  }

  // ── (4) segments: create + immutable version + evaluate ──
  r = await admin.rpc("marketing_segment_mutate", {
    p_tenant: T,
    p_actor: U.owner,
    p_op: "create",
    p_args: { name: "Never contacted", definition: { field: "last_contact", never: true } },
  });
  ok("segments: create OK at v1", !r.error && r.data?.definition_version === 1, r.error?.message);
  const segId = r.data?.id;
  r = await admin.rpc("marketing_segment_evaluate", {
    p_tenant: T,
    p_actor: U.owner,
    p_args: { segment_id: segId },
  });
  ok(
    "segments: server-side evaluation counts the tenant person",
    !r.error && r.data?.count === 1,
    r.error?.message ?? r.data?.count,
  );
  r = await admin.rpc("marketing_segment_mutate", {
    p_tenant: T,
    p_actor: U.owner,
    p_op: "update",
    p_args: { segment_id: segId, expected_version: 9, name: "X" },
  });
  ok("segments: stale update → MK409", Boolean(r.error) && r.error.code === "MK409", r.error?.code);
  // VERSION CAPTURE race: change the definition to v2, then evaluate pinned to
  // the superseded v1 → MK409 and the stored count stays untouched
  r = await admin.rpc("marketing_segment_mutate", {
    p_tenant: T,
    p_actor: U.owner,
    p_op: "update",
    p_args: {
      segment_id: segId,
      expected_version: 1,
      definition: { field: "search", value: "p3 person" },
    },
  });
  ok(
    "segments: definition update → v2 + cleared count",
    !r.error && r.data?.definition_version === 2,
  );
  r = await admin.rpc("marketing_segment_evaluate", {
    p_tenant: T,
    p_actor: U.owner,
    p_args: { segment_id: segId, expected_version: 1 },
  });
  ok(
    "segments RACE: stale expected_version evaluation → MK409",
    Boolean(r.error) && r.error.code === "MK409",
    r.error?.code,
  );
  {
    const s = await admin
      .from("marketing_segments")
      .select("estimated_count,evaluated_at")
      .eq("id", segId)
      .single();
    ok(
      "segments RACE: conflicted evaluation left the stored count untouched",
      s.data?.estimated_count === null && s.data?.evaluated_at === null,
    );
  }
  r = await admin.rpc("marketing_segment_evaluate", {
    p_tenant: T,
    p_actor: U.owner,
    p_args: { definition: { field: "campaign_engagement", value: "opened" } },
  });
  ok(
    "segments: unsupported filter → clear 22023 error",
    Boolean(r.error) && r.error.code === "22023" && /unsupported/i.test(r.error.message ?? ""),
    `${r.error?.code}: ${r.error?.message}`,
  );

  // ── (5) bulk tags: preflight contract → bound apply → idempotent re-apply ──
  r = await admin.rpc("marketing_tag_mutate", {
    p_tenant: T,
    p_actor: U.owner,
    p_op: "create",
    p_args: { label: "P3 Bulk" },
  });
  const tagId = r.data?.id;
  // duplicates collapse to "unique", never "rejected"
  r = await admin.rpc("marketing_tag_bulk", {
    p_tenant: T,
    p_actor: U.owner,
    p_op: "assign",
    p_tag: tagId,
    p_person_ids: [P1, P1],
    p_mode: "preflight",
  });
  ok(
    "bulk: duplicate ids collapse (requested 2, unique 1, rejected 0)",
    !r.error && r.data?.requested === 2 && r.data?.unique === 1 && r.data?.rejected === 0,
    r.error?.message ?? JSON.stringify(r.data),
  );
  // apply without/with-mismatched contract is rejected
  r = await admin.rpc("marketing_tag_bulk", {
    p_tenant: T,
    p_actor: U.owner,
    p_op: "assign",
    p_tag: tagId,
    p_person_ids: [P1],
    p_mode: "apply",
  });
  ok(
    "bulk: apply without the preflight contract → MK409",
    Boolean(r.error) && r.error.code === "MK409",
    r.error?.code,
  );
  r = await admin.rpc("marketing_tag_bulk", {
    p_tenant: T,
    p_actor: U.owner,
    p_op: "assign",
    p_tag: tagId,
    p_person_ids: [P1],
    p_mode: "preflight",
  });
  const contract = r.data?.contract;
  r = await admin.rpc("marketing_tag_bulk", {
    p_tenant: T,
    p_actor: U.owner,
    p_op: "assign",
    p_tag: tagId,
    p_person_ids: [P1],
    p_mode: "apply",
    p_contract: contract,
  });
  ok("bulk: contract-bound assign applies", !r.error && r.data?.applied === 1, r.error?.message);
  r = await admin.rpc("marketing_tag_bulk", {
    p_tenant: T,
    p_actor: U.owner,
    p_op: "assign",
    p_tag: tagId,
    p_person_ids: [P1],
    p_mode: "apply",
    p_contract: contract,
  });
  ok(
    "bulk: re-apply idempotent",
    !r.error && r.data?.applied === 0 && r.data?.already_assigned === 1,
  );

  // ── (5b) single-contact tag lifecycle: an inactive tag can never be
  // assigned (parity with bulk/imports); history survives deactivation;
  // remove stays legal on an inactive tag; reactivation restores assignability
  let tagRow = await admin.from("marketing_tags").select("updated_at").eq("id", tagId).single();
  r = await admin.rpc("marketing_tag_admin", {
    p_tenant: T,
    p_actor: U.owner,
    p_op: "deactivate",
    p_args: { tag_id: tagId, expected_updated_at: tagRow.data.updated_at },
  });
  ok("tag lifecycle: deactivate", !r.error, r.error?.message);
  r = await admin.rpc("marketing_tag_mutate", {
    p_tenant: T,
    p_actor: U.owner,
    p_op: "assign",
    p_args: { tag_id: tagId, person_id: P1 },
  });
  ok(
    "tag lifecycle: single-contact assign of an INACTIVE tag → 22023",
    Boolean(r.error) && r.error.code === "22023",
    r.error?.code,
  );
  const kept = await admin
    .from("contact_tag_assignments")
    .select("person_id", { count: "exact", head: true })
    .eq("tenant_id", T)
    .eq("tag_id", tagId);
  ok("tag lifecycle: historical assignment survives deactivation", kept.count === 1, kept.count);
  r = await admin.rpc("marketing_tag_mutate", {
    p_tenant: T,
    p_actor: U.owner,
    p_op: "remove",
    p_args: { tag_id: tagId, person_id: P1 },
  });
  ok(
    "tag lifecycle: remove stays legal while the tag is inactive",
    !r.error && r.data?.removed === true,
    r.error?.message ?? JSON.stringify(r.data),
  );
  tagRow = await admin.from("marketing_tags").select("updated_at").eq("id", tagId).single();
  r = await admin.rpc("marketing_tag_admin", {
    p_tenant: T,
    p_actor: U.owner,
    p_op: "reactivate",
    p_args: { tag_id: tagId, expected_updated_at: tagRow.data.updated_at },
  });
  ok("tag lifecycle: reactivate", !r.error, r.error?.message);
  r = await admin.rpc("marketing_tag_mutate", {
    p_tenant: T,
    p_actor: U.owner,
    p_op: "assign",
    p_args: { tag_id: tagId, person_id: P1 },
  });
  ok(
    "tag lifecycle: reactivation restores single-contact assignability",
    !r.error && r.data?.assigned === true,
    r.error?.message ?? JSON.stringify(r.data),
  );

  // ── (6) PARALLEL same-row import applies → exactly one Person ──
  const SEALED = {
    source: "csv_upload",
    lifecycle_stage_key: "new_lead",
    relationship_type: "lead",
  };
  const imp = await admin
    .from("data_imports")
    .insert({
      tenant_id: T,
      source_system: "csv_upload",
      entity_type: "contacts",
      status: "previewed",
      file_checksum: "p3racecheck",
      row_count: 10,
      preview: { sealed: { contact_options: SEALED } },
    })
    .select("id")
    .single();
  const rowCall = (rowNumber, record) =>
    admin.rpc("marketing_import_contact_row", {
      p_tenant: T,
      p_import: imp.data.id,
      p_actor: U.owner,
      p_row_number: rowNumber,
      p_record: record,
      p_options: SEALED,
    });
  const [i1, i2] = await Promise.all([
    rowCall(9, { display_name: "Race Only Name" }), // name-only: NO identity lock
    rowCall(9, { display_name: "Race Only Name" }),
  ]);
  ok(
    "import race: both row applies complete",
    !i1.error && !i2.error,
    i1.error?.message ?? i2.error?.message,
  );
  const raceCount = await admin
    .from("people")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", T)
    .eq("display_name", "Race Only Name");
  ok(
    "import race: exactly ONE Person for the same row (per-row lock)",
    raceCount.count === 1,
    raceCount.count,
  );

  // ── (7) CONCURRENT finalisation: durable totals, no contradictory results ──
  await rowCall(2, { display_name: "Fin Row", primary_email: "fin@p3-proof.test" });
  const [f1, f2] = await Promise.all([
    admin.rpc("marketing_import_finalize", { p_tenant: T, p_import: imp.data.id }),
    admin.rpc("marketing_import_finalize", { p_tenant: T, p_import: imp.data.id }),
  ]);
  ok(
    "finalize race: both concurrent finalisations complete",
    !f1.error && !f2.error,
    f1.error?.message ?? f2.error?.message,
  );
  const impRow = await admin
    .from("data_imports")
    .select("status,created_records")
    .eq("id", imp.data.id)
    .single();
  ok(
    "finalize race: one consistent durable total (2 created, not completed — unprocessed rows remain)",
    impRow.data?.created_records === 2 && impRow.data?.status === "failed",
    JSON.stringify(impRow.data),
  );

  // ── (8) TERMINAL outcomes are never downgraded by a concurrent failed marker ──
  {
    const failedMarker = () =>
      admin.rpc("marketing_import_row_outcome", {
        p_tenant: T,
        p_import: imp.data.id,
        p_row_number: 3,
        p_outcome: "failed",
        p_reason: "concurrent failure marker",
      });
    // CONCURRENT successful apply + failed marker for the SAME row: whatever
    // the interleaving, the durable outcome ends TERMINAL, never failed
    const [a1, m1] = await Promise.all([
      rowCall(3, { display_name: "Downgrade Probe", primary_email: "downgrade@p3-proof.test" }),
      failedMarker(),
    ]);
    ok(
      "ledger race: apply + failed marker both complete",
      !a1.error && !m1.error,
      a1.error?.message ?? m1.error?.message,
    );
    const row3 = await admin
      .from("marketing_import_row_results")
      .select("outcome")
      .eq("import_id", imp.data.id)
      .eq("row_number", 3)
      .single();
    ok(
      "ledger race: the row ends TERMINAL — a failed marker never wins over success",
      row3.data?.outcome === "created",
      row3.data?.outcome,
    );
    // a LATE failed marker after the terminal result returns the authoritative
    // outcome without downgrading
    const late = await failedMarker();
    ok(
      "ledger: late failed marker returns the authoritative terminal outcome",
      !late.error && late.data?.already === true && late.data?.outcome === "created",
      JSON.stringify(late.data ?? late.error),
    );
  }

  // ── (9) SAME source+external_id, DIFFERENT rows, CONCURRENT: one Person ──
  {
    const extCall = (rowNumber, name) =>
      admin.rpc("marketing_import_contact_row", {
        p_tenant: T,
        p_import: imp.data.id,
        p_actor: U.owner,
        p_row_number: rowNumber,
        p_record: { display_name: name, external_id: "RACE-EXT-1" },
        p_options: SEALED,
      });
    const [e1, e2] = await Promise.all([extCall(4, "Ext Race A"), extCall(5, "Ext Race B")]);
    ok(
      "ext race: both rows complete",
      !e1.error && !e2.error,
      e1.error?.message ?? e2.error?.message,
    );
    const actions = [e1.data?.action, e2.data?.action].sort();
    const created = actions.filter((a) => a === "created").length;
    ok(
      "ext race: at most ONE Person created; the other row matched or conflicted",
      created === 1 && ["conflict", "created", "updated"].includes(actions[0]),
      JSON.stringify(actions),
    );
    const extPeople = await admin
      .from("import_row_provenance")
      .select("entity_id")
      .eq("tenant_id", T)
      .eq("entity_table", "people")
      .eq("source_system", "csv_upload")
      .eq("external_id", "RACE-EXT-1");
    ok(
      "ext race: exactly one canonical Person owns the external id namespace",
      new Set((extPeople.data ?? []).map((r) => r.entity_id)).size === 1,
      (extPeople.data ?? []).length,
    );
    // the SAME external id in a DIFFERENT source namespace stays independent
    const otherSealed = {
      source: "other_src",
      lifecycle_stage_key: "new_lead",
      relationship_type: "lead",
    };
    const imp2 = await admin
      .from("data_imports")
      .insert({
        tenant_id: T,
        source_system: "other_src",
        entity_type: "contacts",
        status: "previewed",
        file_checksum: "p3nscheck",
        row_count: 5,
        preview: { sealed: { contact_options: otherSealed } },
      })
      .select("id")
      .single();
    const ns = await admin.rpc("marketing_import_contact_row", {
      p_tenant: T,
      p_import: imp2.data.id,
      p_actor: U.owner,
      p_row_number: 2,
      p_record: { display_name: "Ext Other Namespace", external_id: "RACE-EXT-1" },
      p_options: otherSealed,
    });
    ok(
      "ext namespaces: the same external id in another source stays independent",
      !ns.error && ns.data?.action === "created",
      ns.error?.message ?? ns.data?.action,
    );
  }

  // ── (10) COMPLETED-IMPORT concurrent finalisation: identical FULL totals ──
  {
    const done = await admin
      .from("data_imports")
      .insert({
        tenant_id: T,
        source_system: "csv_upload",
        entity_type: "contacts",
        status: "previewed",
        file_checksum: "p3donecheck",
        row_count: 1,
        preview: { sealed: { contact_options: SEALED } },
      })
      .select("id")
      .single();
    await admin.rpc("marketing_import_contact_row", {
      p_tenant: T,
      p_import: done.data.id,
      p_actor: U.owner,
      p_row_number: 2,
      p_record: { display_name: "Done Row", primary_email: "done@p3-proof.test" },
      p_options: SEALED,
    });
    await admin.rpc("marketing_import_finalize", { p_tenant: T, p_import: done.data.id });
    const [g1, g2] = await Promise.all([
      admin.rpc("marketing_import_finalize", { p_tenant: T, p_import: done.data.id }),
      admin.rpc("marketing_import_finalize", { p_tenant: T, p_import: done.data.id }),
    ]);
    const full = (d) =>
      d &&
      d.status === "completed" &&
      d.created === 1 &&
      d.updated === 0 &&
      d.conflicts === 0 &&
      d.invalid === 0 &&
      d.failed === 0 &&
      d.unprocessed === 0 &&
      d.import?.status === "completed";
    ok(
      "completed finalize race: BOTH return the identical FULL totals/import shape",
      !g1.error &&
        !g2.error &&
        full(g1.data) &&
        full(g2.data) &&
        JSON.stringify(g1.data.import.id) === JSON.stringify(g2.data.import.id),
      JSON.stringify(g1.data ?? g1.error) + " / " + JSON.stringify(g2.data ?? g2.error),
    );
  }

  await cleanup();
  console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILURES`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
