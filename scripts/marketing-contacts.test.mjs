// ServiceOS — marketing-contacts RPC-boundary proof (Phase 2).
//
// Exercises the REAL service boundaries behind the `marketing-contacts` Edge
// Function via PostgREST (the production SQL, not copied logic):
//   1. The projection/mutation RPCs are SERVICE-ROLE ONLY — an authenticated
//      tenant user's real GoTrue JWT gets 42501 on every one (list, counts,
//      detail, classify, create) and anon likewise: no direct-RPC bypass of the
//      Edge Function's permission gate exists.
//   2. The service role (the Edge Function's credential) runs the projection
//      end-to-end over real rows: list + inclusion flag, detail, classify
//      (audit + version), create (conflict-not-merge). Concurrency proofs are
//      REAL parallel PostgREST calls: same-key name-only and same-key
//      identified creates serialise on the tenant+key lock (one Person,
//      identical results); overlapping identifiers serialise on identity
//      locks; different-key namesakes stay two People; null key → 22023 with
//      no writes; changed first/last names break the fingerprint (55000);
//      concurrent contact-point updates → one winner + one MK409.
// The function's own HTTP layer is covered by
// scripts/marketing-contacts-http.test.mjs (requires a served edge runtime).
// Self-cleaning synthetic tenants.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!SR) {
  console.error("MISSING SUPABASE_SERVICE_ROLE_KEY env");
  process.exit(2);
}
const admin = createClient(URL, SR, { auth: { persistSession: false } });
const T = "54a07700-0000-4000-8000-0000000054ab";
const T2 = "54a07700-0000-4000-8000-0000000054ac";
const U = {
  admin: "54a07700-0000-4000-8000-0000000054c1",
  ops: "54a07700-0000-4000-8000-0000000054c2",
};
const P1 = "54a07700-0000-4000-8000-0000000054d1";
const P2 = "54a07700-0000-4000-8000-0000000054d2"; // discovered (no relationship)
const PB = "54a07700-0000-4000-8000-0000000054d3"; // tenant-B person

let failed = 0;
const ok = (l, c, x) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${x !== undefined ? `  [${x}]` : ""}`);
  if (!c) failed++;
};

async function cleanup() {
  for (const id of Object.values(U)) await admin.auth.admin.deleteUser(id).catch(() => {});
  for (const t of [T, T2]) {
    for (const table of [
      "contact_tag_assignments",
      "marketing_tags",
      "contact_suppressions",
      "communication_preferences",
      "contact_points",
      "contact_relationships",
      "marketing_access_grants",
      "marketing_identity_conflicts",
      "marketing_request_keys",
      "marketing_lifecycle_stages",
      "marketing_settings",
      "customer_cards",
      "audit_logs",
      "platform_events",
    ]) {
      await admin.from(table).delete().eq("tenant_id", t);
    }
    await admin.from("people").delete().eq("tenant_id", t);
    await admin.from("tenants").delete().eq("id", t);
  }
}

async function main() {
  await cleanup();
  await admin.from("tenants").insert([
    { id: T, slug: "mkt-contacts-proof", display_name: "Contacts Proof" },
    { id: T2, slug: "mkt-contacts-proof-2", display_name: "Contacts Proof 2" },
  ]);
  for (const [k, id] of Object.entries(U)) {
    const c = await admin.auth.admin.createUser({
      id,
      email: `${k}@mkt-contacts.test`,
      password: "Proof-Passw0rd!",
      email_confirm: true,
    });
    if (c.error) return ok(`create ${k}`, false, c.error.message);
    await admin
      .from("profiles")
      .update({ tenant_id: T, role: k === "admin" ? "admin" : "ops" })
      .eq("id", id);
  }
  await admin.rpc("marketing_materialise_defaults", { p_tenant: T, p_actor: U.admin });
  await admin.from("people").insert([
    { id: P1, tenant_id: T, display_name: "Proof Person", primary_email: "pp@proof.test" },
    { id: P2, tenant_id: T, display_name: "Discovered Person" },
    { id: PB, tenant_id: T2, display_name: "Foreign Person" },
  ]);
  await admin.from("contact_relationships").insert({
    tenant_id: T,
    person_id: P1,
    relationship_type: "lead",
    lifecycle_stage_key: "new_lead",
  });

  // ── (1) Authenticated JWTs cannot reach the RPCs directly ──
  if (ANON) {
    const base = createClient(URL, ANON, { auth: { persistSession: false } });
    const si = await base.auth.signInWithPassword({
      email: "ops@mkt-contacts.test",
      password: "Proof-Passw0rd!",
    });
    ok("ops signs in (real GoTrue JWT)", !si.error, si.error?.message);
    const asOps = createClient(URL, ANON, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${si.data.session.access_token}` } },
    });
    const checks = [
      ["list", asOps.rpc("marketing_contacts_list", { p_tenant: T, p_args: {} })],
      ["counts", asOps.rpc("marketing_contacts_counts", { p_tenant: T })],
      ["detail", asOps.rpc("marketing_contact_detail", { p_tenant: T, p_person: P1 })],
      [
        "classify",
        asOps.rpc("marketing_classify_contact", {
          p_tenant: T,
          p_person: P1,
          p_actor: U.ops,
          p_changes: {},
        }),
      ],
      [
        "create",
        asOps.rpc("marketing_create_contact", {
          p_tenant: T,
          p_actor: U.ops,
          p_details: { display_name: "X" },
          p_idempotency_key: crypto.randomUUID(),
        }),
      ],
      [
        "update",
        asOps.rpc("marketing_update_contact", {
          p_tenant: T,
          p_person: P1,
          p_actor: U.ops,
          p_changes: {},
        }),
      ],
      [
        "tag_mutate",
        asOps.rpc("marketing_tag_mutate", {
          p_tenant: T,
          p_actor: U.ops,
          p_op: "create",
          p_args: { label: "x" },
        }),
      ],
      ["owners_list", asOps.rpc("marketing_owners_list", { p_tenant: T })],
    ];
    for (const [name, p] of checks) {
      const r = await p;
      ok(
        `authenticated: ${name} RPC denied (no fn bypass)`,
        Boolean(r.error) && r.error.code === "42501",
        r.error?.code,
      );
    }
    const pureAnon = createClient(URL, ANON, { auth: { persistSession: false } });
    const ar = await pureAnon.rpc("marketing_contacts_list", { p_tenant: T });
    ok(
      "anonymous: list RPC denied",
      Boolean(ar.error) && ar.error.code === "42501",
      ar.error?.code,
    );
  } else {
    console.log("SKIP  authenticated-boundary checks (no SUPABASE_ANON_KEY)");
  }

  // ── (2) Service role runs the projection end-to-end (the fn's path) ──
  let r = await admin.rpc("marketing_contacts_list", { p_tenant: T, p_args: { limit: 10 } });
  ok(
    "service: list includes discovered person under include-all",
    !r.error && r.data?.items?.length === 2,
    r.error?.message ?? r.data?.items?.length,
  );
  await admin
    .from("marketing_settings")
    .update({ include_all_discovered: false })
    .eq("tenant_id", T);
  r = await admin.rpc("marketing_contacts_list", { p_tenant: T, p_args: { limit: 10 } });
  ok(
    "service: classified-only excludes the discovered person",
    !r.error && r.data?.items?.length === 1,
    r.data?.items?.length,
  );
  await admin
    .from("marketing_settings")
    .update({ include_all_discovered: true })
    .eq("tenant_id", T);

  r = await admin.rpc("marketing_contact_detail", { p_tenant: T, p_person: P1 });
  ok("service: detail projects the person", !r.error && r.data?.display_name === "Proof Person");
  r = await admin.rpc("marketing_contact_detail", { p_tenant: T, p_person: PB });
  ok("service: detail refuses a foreign-tenant person", Boolean(r.error));

  const relRow = await admin
    .from("contact_relationships")
    .select("id,version")
    .eq("tenant_id", T)
    .eq("person_id", P1)
    .eq("status", "active")
    .single();
  r = await admin.rpc("marketing_classify_contact", {
    p_tenant: T,
    p_person: P1,
    p_actor: U.admin,
    p_changes: {
      relationship_id: relRow.data.id,
      expected_version: relRow.data.version,
      lifecycle_stage_key: "qualified",
    },
  });
  ok(
    "service: classify targets explicit relationship + versions",
    !r.error && r.data?.lifecycle_stage_key === "qualified" && r.data?.version === 2,
    r.error?.message,
  );
  const audit = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", T)
    .eq("action", "marketing.contact.classified");
  ok("service: classify audited", audit.count === 1, audit.count);

  r = await admin.rpc("marketing_create_contact", {
    p_tenant: T,
    p_actor: U.admin,
    p_details: { display_name: "Dup Probe", email: "PP@proof.test" },
    p_idempotency_key: crypto.randomUUID(),
  });
  ok(
    "service: single match returns 'existing' candidate (no merge, no arbitrary pick)",
    !r.error &&
      r.data?.created === false &&
      r.data?.status === "existing" &&
      Array.isArray(r.data?.candidate?.matched_on),
    r.error?.message,
  );

  // ── (3) Concurrency: two PARALLEL creates, same identity, different keys ──
  const k1 = crypto.randomUUID();
  const k2 = crypto.randomUUID();
  const mk = (k) =>
    admin.rpc("marketing_create_contact", {
      p_tenant: T,
      p_actor: U.admin,
      p_details: { display_name: "Race Person", email: "race@proof.test" },
      p_idempotency_key: k,
    });
  const [c1, c2] = await Promise.all([mk(k1), mk(k2)]);
  ok(
    "concurrency: both requests complete",
    !c1.error && !c2.error,
    c1.error?.message ?? c2.error?.message,
  );
  const outcomes = [c1.data, c2.data];
  const createdCount = outcomes.filter((o) => o?.created === true).length;
  const existingCount = outcomes.filter((o) => o?.status === "existing").length;
  ok(
    "concurrency: exactly ONE create wins; the other sees the existing person",
    createdCount === 1 && existingCount === 1,
    `created=${createdCount} existing=${existingCount}`,
  );
  const racePeople = await admin
    .from("people")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", T)
    .eq("primary_email", "race@proof.test");
  ok("concurrency: exactly one Person row exists", racePeople.count === 1, racePeople.count);

  // ── (4) Idempotent retry: same key → byte-identical stored result ──
  const winnerKey = outcomes[0]?.created ? k1 : k2;
  const retry = await admin.rpc("marketing_create_contact", {
    p_tenant: T,
    p_actor: U.admin,
    p_details: { display_name: "Race Person", email: "race@proof.test" },
    p_idempotency_key: winnerKey,
  });
  const winner = outcomes.find((o) => o?.created);
  ok(
    "idempotency: retry with the winner's key returns the SAME result",
    !retry.error && JSON.stringify(retry.data) === JSON.stringify(winner),
    retry.error?.message,
  );

  // ── (4b) OVERLAPPING (not identical) identity: same email, one adds a phone —
  //         different fingerprints/keys, but the shared-email lock must still
  //         serialise them: exactly one Person is created. ──
  const ok1 = crypto.randomUUID();
  const ok2 = crypto.randomUUID();
  const [o1, o2] = await Promise.all([
    admin.rpc("marketing_create_contact", {
      p_tenant: T,
      p_actor: U.admin,
      p_details: { display_name: "Overlap A", email: "overlap@proof.test" },
      p_idempotency_key: ok1,
    }),
    admin.rpc("marketing_create_contact", {
      p_tenant: T,
      p_actor: U.admin,
      p_details: {
        display_name: "Overlap B",
        email: "overlap@proof.test",
        phone: "+44 7700 900777",
      },
      p_idempotency_key: ok2,
    }),
  ]);
  ok(
    "overlap concurrency: both complete",
    !o1.error && !o2.error,
    o1.error?.message ?? o2.error?.message,
  );
  const oCreated = [o1.data, o2.data].filter((x) => x?.created === true).length;
  const oExisting = [o1.data, o2.data].filter((x) => x?.status === "existing").length;
  ok(
    "overlap concurrency: shared identifier serialises — one create, one existing",
    oCreated === 1 && oExisting === 1,
    `created=${oCreated} existing=${oExisting}`,
  );
  const oPeople = await admin
    .from("people")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", T)
    .eq("primary_email", "overlap@proof.test");
  ok("overlap concurrency: exactly one Person", oPeople.count === 1, oPeople.count);

  // ── (4c) Fingerprint binding over PostgREST: same key + changed payload → 55000 ──
  const fpProbe = await admin.rpc("marketing_create_contact", {
    p_tenant: T,
    p_actor: U.admin,
    p_details: { display_name: "Overlap A CHANGED", email: "overlap@proof.test" },
    p_idempotency_key: oCreated === 1 && o1.data?.created ? ok1 : ok2,
  });
  ok(
    "idempotency: same key + different payload → 55000 over PostgREST",
    Boolean(fpProbe.error) && fpProbe.error.code === "55000",
    fpProbe.error?.code,
  );

  // ── (4d) SAME KEY, NAME-ONLY, PARALLEL: the key lock (not identity locks)
  //         must serialise them — exactly one Person, identical results. ──
  const sameKey = crypto.randomUUID();
  const nameOnly = { display_name: "Same Key Solo" };
  const [s1, s2] = await Promise.all([
    admin.rpc("marketing_create_contact", {
      p_tenant: T,
      p_actor: U.admin,
      p_details: nameOnly,
      p_idempotency_key: sameKey,
    }),
    admin.rpc("marketing_create_contact", {
      p_tenant: T,
      p_actor: U.admin,
      p_details: nameOnly,
      p_idempotency_key: sameKey,
    }),
  ]);
  ok(
    "same-key name-only parallel: both complete",
    !s1.error && !s2.error,
    s1.error?.message ?? s2.error?.message,
  );
  ok(
    "same-key name-only parallel: IDENTICAL results (stored result returned)",
    JSON.stringify(s1.data) === JSON.stringify(s2.data) && s1.data?.person_id,
  );
  const soloCount = await admin
    .from("people")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", T)
    .eq("display_name", "Same Key Solo");
  ok(
    "same-key name-only parallel: exactly ONE Person committed (no orphan duplicate)",
    soloCount.count === 1,
    soloCount.count,
  );

  // ── (4e) SAME KEY + IDENTIFIED identity, parallel → one Person ──
  const idKey = crypto.randomUUID();
  const idDetails = { display_name: "Same Key Ident", email: "samekey@proof.test" };
  const [i1, i2] = await Promise.all([
    admin.rpc("marketing_create_contact", {
      p_tenant: T,
      p_actor: U.admin,
      p_details: idDetails,
      p_idempotency_key: idKey,
    }),
    admin.rpc("marketing_create_contact", {
      p_tenant: T,
      p_actor: U.admin,
      p_details: idDetails,
      p_idempotency_key: idKey,
    }),
  ]);
  ok("same-key identified parallel: both complete", !i1.error && !i2.error);
  const idCount = await admin
    .from("people")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", T)
    .eq("primary_email", "samekey@proof.test");
  ok("same-key identified parallel: exactly one Person", idCount.count === 1, idCount.count);

  // ── (4f) first/last names are MATERIAL: same key + changed first_name → 55000 ──
  const nmProbe = await admin.rpc("marketing_create_contact", {
    p_tenant: T,
    p_actor: U.admin,
    p_details: { display_name: "Same Key Solo", first_name: "Different" },
    p_idempotency_key: sameKey,
  });
  ok(
    "same key + changed first_name → 55000",
    Boolean(nmProbe.error) && nmProbe.error.code === "55000",
    nmProbe.error?.code,
  );

  // ── (4g) NULL key at SQL → 22023 with no writes ──
  const preNull = await admin
    .from("people")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", T);
  const nullKey = await admin.rpc("marketing_create_contact", {
    p_tenant: T,
    p_actor: U.admin,
    p_details: { display_name: "Null Key Person" },
    p_idempotency_key: null,
  });
  ok(
    "null key → 22023 over PostgREST",
    Boolean(nullKey.error) && nullKey.error.code === "22023",
    nullKey.error?.code,
  );
  const postNull = await admin
    .from("people")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", T);
  ok("null key wrote nothing", postNull.count === preNull.count);

  // ── (4h) DIFFERENT keys + identical name-only requests → two People stay allowed ──
  const [d1, d2] = await Promise.all([
    admin.rpc("marketing_create_contact", {
      p_tenant: T,
      p_actor: U.admin,
      p_details: { display_name: "Namesake Person" },
      p_idempotency_key: crypto.randomUUID(),
    }),
    admin.rpc("marketing_create_contact", {
      p_tenant: T,
      p_actor: U.admin,
      p_details: { display_name: "Namesake Person" },
      p_idempotency_key: crypto.randomUUID(),
    }),
  ]);
  ok(
    "different-key name-only: both create",
    d1.data?.created === true && d2.data?.created === true,
  );
  const nsCount = await admin
    .from("people")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", T)
    .eq("display_name", "Namesake Person");
  ok(
    "different-key name-only: two People allowed (no accidental identity)",
    nsCount.count === 2,
    nsCount.count,
  );

  // ── (5) Ambiguity: two People share an inbox → ambiguous + durable record ──
  await admin.from("contact_points").insert([
    {
      tenant_id: T,
      person_id: P1,
      channel: "email",
      value: "shared@proof.test",
      normalized_value: "shared@proof.test",
    },
    {
      tenant_id: T,
      person_id: P2,
      channel: "email",
      value: "shared@proof.test",
      normalized_value: "shared@proof.test",
    },
  ]);
  r = await admin.rpc("marketing_create_contact", {
    p_tenant: T,
    p_actor: U.admin,
    p_details: { display_name: "Shared Probe", email: "shared@proof.test" },
    p_idempotency_key: crypto.randomUUID(),
  });
  ok(
    "ambiguity: multiple matches → explicit ambiguous result with both candidates",
    !r.error && r.data?.status === "ambiguous" && r.data?.candidates?.length === 2,
    r.error?.message ?? r.data?.status,
  );
  const conflictRow = await admin
    .from("marketing_identity_conflicts")
    .select("id,status,identifiers", { count: "exact" })
    .eq("tenant_id", T);
  ok("ambiguity: durable identity-conflict record persisted", (conflictRow.count ?? 0) >= 1);
  ok(
    "ambiguity: per-identifier evidence recorded",
    Array.isArray(conflictRow.data?.[0]?.identifiers) &&
      conflictRow.data[0].identifiers[0]?.candidate_person_ids?.length >= 2,
  );

  // ── (6) Optimistic concurrency at the service boundary ──
  const stale = await admin.rpc("marketing_classify_contact", {
    p_tenant: T,
    p_person: P1,
    p_actor: U.admin,
    p_changes: {
      relationship_id: relRow.data.id,
      lifecycle_stage_key: "engaged",
      expected_version: 999,
    },
  });
  ok(
    "version: stale expected_version → MK409 VERSION_CONFLICT",
    Boolean(stale.error) && stale.error.code === "MK409",
    stale.error?.code,
  );

  // ── (7) Update surface end-to-end ──
  r = await admin.rpc("marketing_update_contact", {
    p_tenant: T,
    p_person: P2,
    p_actor: U.admin,
    p_changes: {
      person: { display_name: "Discovered Renamed" },
      contact_points: {
        add: [{ channel: "email", value: "renamed@proof.test", make_primary: true }],
      },
    },
  });
  ok("update: person + contact point applied", !r.error, r.error?.message);
  const upd = await admin.rpc("marketing_contact_detail", { p_tenant: T, p_person: P2 });
  ok(
    "update: detail reflects rename + primary point",
    upd.data?.display_name === "Discovered Renamed" &&
      upd.data?.contact_points?.some(
        (c) => c.normalized_value === "renamed@proof.test" && c.is_primary,
      ),
  );

  // ── (8) CONCURRENT contact-point updates with the same token: exactly one
  //        wins; the other gets MK409 from the exact opaque-timestamp compare ──
  const cpRow = upd.data.contact_points.find((c) => c.normalized_value === "renamed@proof.test");
  const [u1, u2] = await Promise.all([
    admin.rpc("marketing_update_contact", {
      p_tenant: T,
      p_person: P2,
      p_actor: U.admin,
      p_changes: {
        contact_points: {
          update: [{ id: cpRow.id, expected_updated_at: cpRow.updated_at, label: "editor one" }],
        },
      },
    }),
    admin.rpc("marketing_update_contact", {
      p_tenant: T,
      p_person: P2,
      p_actor: U.admin,
      p_changes: {
        contact_points: {
          update: [{ id: cpRow.id, expected_updated_at: cpRow.updated_at, label: "editor two" }],
        },
      },
    }),
  ]);
  const cpWins = [u1, u2].filter((x) => !x.error).length;
  const cpConflicts = [u1, u2].filter((x) => x.error?.code === "MK409").length;
  ok(
    "concurrent cp updates: one wins, one VERSION_CONFLICT (MK409)",
    cpWins === 1 && cpConflicts === 1,
    `wins=${cpWins} conflicts=${cpConflicts}`,
  );

  await cleanup();
  console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILURES`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
