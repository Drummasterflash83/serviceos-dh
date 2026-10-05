// ServiceOS — PUBLIC open/click tracking endpoint contract (marketing-track).
//
// Exercises the REAL served endpoint over HTTP, unauthenticated (the endpoint
// is public by design, verify_jwt = false). Proves:
//
//   - forged / missing / wrong-kind / altered-destination / malformed /
//     oversize / duplicate-parameter / unsafe-scheme requests NEVER redirect to
//     the supplied target;
//   - an invalid CLICK takes the FIXED neutral first-party fallback — including
//     an ambiguous one carrying duplicate d/t/u parameters, so a failure is
//     never distinguishable by its response shape;
//   - an invalid OPEN returns the neutral 1x1 pixel, as does a request whose
//     `k` itself is duplicated (the kind is then unknowable);
//   - invalid requests create ZERO database writes;
//   - a valid destination-bound click redirects to exactly that destination;
//   - one valid click records at most the bounded unique evidence, and a flood
//     of the SAME valid request records nothing further;
//   - responses depend only on the requested kind, never on validity, so the
//     endpoint never discloses whether a delivery exists.
//
// The tracking secret is supplied to the script ONLY so it can mint genuine
// tokens; it is never printed. Exits 3 NOT-RUN without a served runtime.
//
// Run:
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… MARKETING_TRACKING_SECRET=… \
//     node scripts/marketing-track-http.test.mjs

import { createClient } from "@supabase/supabase-js";
import {
  clickToken,
  openToken,
  MAX_TRACK_URL_LEN,
} from "../supabase/functions/_shared/marketing_tracking.ts";

const URL_BASE = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SECRET = process.env.MARKETING_TRACKING_SECRET;
if (!SR) {
  console.error("MISSING SUPABASE_SERVICE_ROLE_KEY env");
  process.exit(2);
}
if (!SECRET || SECRET.length < 32) {
  console.error("MISSING/WEAK MARKETING_TRACKING_SECRET env (>= 32 chars required)");
  process.exit(2);
}
const TRACK = `${URL_BASE}/functions/v1/marketing-track`;
const admin = createClient(URL_BASE, SR, { auth: { persistSession: false } });

const T = crypto.randomUUID();
const OWNER = crypto.randomUUID();
const RUN = T.slice(0, 8);
const DEST = "https://drummonds.example/quote";
const EVIL = "https://evil.example/phish";

let failed = 0;
const ok = (l, c, x) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${x !== undefined ? `  [${x}]` : ""}`);
  if (!c) failed++;
};

async function cleanup() {
  await admin.auth.admin.deleteUser(OWNER).catch(() => {});
  for (const table of [
    "marketing_delivery_events",
    "marketing_deliveries",
    "automation_execution_attempts",
    "automation_intents",
    "decision_log",
    "intelligence_objects",
    "tenant_connector_capabilities",
    "tenant_connectors",
    "marketing_sender_profiles",
    "marketing_settings_history",
    "marketing_lifecycle_stages",
    "marketing_settings",
    "audit_logs",
    "platform_events",
    "platform_jobs",
    "review_tasks",
  ]) {
    await admin.from(table).delete().eq("tenant_id", T);
  }
  await admin.from("tenants").delete().eq("id", T);
}

/** never follows redirects — the Location header IS the assertion */
const hit = (qs) => fetch(`${TRACK}?${qs}`, { redirect: "manual" });

const track = async (deliveryId) => {
  const r = await admin
    .from("marketing_email_tracking")
    .select("open_count, click_count, first_open_at, first_click_at, first_click_url")
    .eq("delivery_id", deliveryId)
    .maybeSingle();
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

const rowCount = async () => {
  const r = await admin
    .from("marketing_email_tracking")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", T);
  return r.count ?? 0;
};

async function main() {
  // ── served-runtime probe ────────────────────────────────────────────────
  let probe;
  try {
    probe = await fetch(TRACK, { method: "GET", redirect: "manual" });
  } catch {
    console.error("NOT-RUN: no served edge runtime at " + TRACK);
    process.exit(3);
  }
  if (probe.status === 404 || probe.status === 503) {
    console.error(`NOT-RUN: marketing-track is not served (status ${probe.status})`);
    process.exit(3);
  }

  await cleanup();
  await admin
    .from("tenants")
    .insert({ id: T, slug: `trk-http-${RUN}`, display_name: "Track HTTP" });
  const c = await admin.auth.admin.createUser({
    id: OWNER,
    email: `owner-${RUN}@trk-http.test`,
    password: "Proof-Passw0rd!",
    email_confirm: true,
  });
  if (c.error) {
    console.error("user create failed", c.error.message);
    process.exit(1);
  }
  await admin.from("profiles").update({ tenant_id: T, role: "owner" }).eq("id", OWNER);
  await admin.rpc("marketing_materialise_defaults", { p_tenant: T, p_actor: OWNER });
  const s = await admin.rpc("marketing_sender_create_resend", {
    p_tenant: T,
    p_actor: OWNER,
    p_args: { from_address: "onboarding@resend.dev", from_name: "Track HTTP" },
  });
  if (s.error) {
    console.error("sender create failed", s.error.message);
    await cleanup();
    process.exit(1);
  }
  const req = await admin.rpc("marketing_test_send_request", {
    p_tenant: T,
    p_actor: OWNER,
    p_args: {
      sender_id: s.data.id,
      recipient_profile_id: OWNER,
      subject: "tracking http proof",
      body_text: `Visit ${DEST}`,
      request_id: `trk-http-${RUN}`,
    },
  });
  if (req.error) {
    console.error("delivery create failed", req.error.message);
    await cleanup();
    process.exit(1);
  }
  const D = req.data.delivery_id;
  const OTHER = crypto.randomUUID();

  const otok = await openToken(SECRET, D);
  const ctok = await clickToken(SECRET, D, DEST);
  const u = encodeURIComponent(DEST);

  // ── (1) INVALID CLICKS never redirect to the supplied target ────────────
  const invalidClicks = [
    ["forged token", `d=${D}&k=click&t=forged&u=${u}`],
    ["missing token", `d=${D}&k=click&u=${u}`],
    ["empty token", `d=${D}&k=click&t=&u=${u}`],
    [
      "wrong kind (open token replayed as click)",
      `d=${D}&k=click&t=${encodeURIComponent(otok)}&u=${u}`,
    ],
    [
      "ALTERED DESTINATION (the open-redirect attack)",
      `d=${D}&k=click&t=${encodeURIComponent(ctok)}&u=${encodeURIComponent(EVIL)}`,
    ],
    ["wrong delivery", `d=${OTHER}&k=click&t=${encodeURIComponent(ctok)}&u=${u}`],
    ["missing delivery", `k=click&t=${encodeURIComponent(ctok)}&u=${u}`],
    ["malformed delivery id", `d=not-a-uuid&k=click&t=${encodeURIComponent(ctok)}&u=${u}`],
    [
      "unsafe scheme destination",
      `d=${D}&k=click&t=${encodeURIComponent(ctok)}&u=${encodeURIComponent("javascript:alert(1)")}`,
    ],
    [
      "http destination",
      `d=${D}&k=click&t=${encodeURIComponent(ctok)}&u=${encodeURIComponent("http://drummonds.example/quote")}`,
    ],
    [
      "credentials-in-URL destination",
      `d=${D}&k=click&t=${encodeURIComponent(ctok)}&u=${encodeURIComponent("https://u:p@drummonds.example/quote")}`,
    ],
    [
      "self-wrapping destination",
      `d=${D}&k=click&t=${encodeURIComponent(ctok)}&u=${encodeURIComponent(TRACK + "?d=x")}`,
    ],
    [
      "oversize destination",
      `d=${D}&k=click&t=${encodeURIComponent(ctok)}&u=${encodeURIComponent("https://a.co/" + "x".repeat(MAX_TRACK_URL_LEN + 50))}`,
    ],
    ["oversize token", `d=${D}&k=click&t=${"a".repeat(4096)}&u=${u}`],
    [
      "DUPLICATE click parameters",
      `d=${D}&d=${OTHER}&k=click&t=${encodeURIComponent(ctok)}&u=${u}`,
    ],
    [
      "duplicate destination parameters",
      `d=${D}&k=click&t=${encodeURIComponent(ctok)}&u=${u}&u=${encodeURIComponent(EVIL)}`,
    ],
    ["duplicate token parameters", `d=${D}&k=click&t=${encodeURIComponent(ctok)}&t=forged&u=${u}`],
  ];

  let neutralFallback = null;
  for (const [name, qs] of invalidClicks) {
    const r = await hit(qs);
    const loc = r.headers.get("location");
    ok(
      `invalid click — ${name}: 302 to the FIXED neutral fallback`,
      r.status === 302 && !!loc,
      `${r.status}`,
    );
    ok(
      `invalid click — ${name}: NEVER the supplied target`,
      loc !== DEST && loc !== EVIL && !String(loc).includes("evil.example"),
      loc,
    );
    if (neutralFallback === null) neutralFallback = loc;
    ok(
      `invalid click — ${name}: the fallback is FIXED (identical every time)`,
      loc === neutralFallback,
      loc,
    );
  }

  // ── (2) INVALID OPENS return the neutral pixel ──────────────────────────
  for (const [name, qs] of [
    ["forged token", `d=${D}&k=open&t=forged`],
    ["missing token", `d=${D}&k=open`],
    ["wrong kind (click token replayed as open)", `d=${D}&k=open&t=${encodeURIComponent(ctok)}`],
    ["wrong delivery", `d=${OTHER}&k=open&t=${encodeURIComponent(otok)}`],
    ["malformed delivery id", `d=not-a-uuid&k=open&t=${encodeURIComponent(otok)}`],
    ["unknown kind", `d=${D}&k=forwarded&t=${encodeURIComponent(otok)}`],
    ["no kind at all", `d=${D}&t=${encodeURIComponent(otok)}`],
    // a DUPLICATED kind makes the kind itself unknowable → the neutral pixel is
    // the only honest answer (it can never be treated as a click)
    ["duplicate kind parameters", `d=${D}&k=click&k=open&t=${encodeURIComponent(ctok)}&u=${u}`],
    ["duplicate open parameters", `d=${D}&d=${OTHER}&k=open&t=${encodeURIComponent(otok)}`],
  ]) {
    const r = await hit(qs);
    ok(
      `invalid open — ${name}: 200 neutral pixel, no redirect`,
      r.status === 200 &&
        (r.headers.get("content-type") ?? "").includes("image/gif") &&
        !r.headers.get("location"),
      `${r.status} ${r.headers.get("content-type")}`,
    );
  }

  // ── (3) invalid requests wrote NOTHING ─────────────────────────────────
  ok("ZERO database writes from every invalid request", (await rowCount()) === 0, await rowCount());

  // ── (4) a VALID destination-bound click redirects to exactly that URL ───
  const good = await hit(`d=${D}&k=click&t=${encodeURIComponent(ctok)}&u=${u}`);
  ok(
    "valid click: 302 to the EXACT bound destination",
    good.status === 302 && good.headers.get("location") === DEST,
    `${good.status} ${good.headers.get("location")}`,
  );
  const afterClick = await track(D);
  ok(
    "valid click: records exactly the bounded unique evidence",
    afterClick?.click_count === 1 &&
      afterClick.first_click_at !== null &&
      afterClick.first_click_url === DEST &&
      afterClick.open_count === 0,
    JSON.stringify(afterClick),
  );

  // ── (5) a valid OPEN records once ──────────────────────────────────────
  const openR = await hit(`d=${D}&k=open&t=${encodeURIComponent(otok)}`);
  ok(
    "valid open: 200 pixel",
    openR.status === 200 && (openR.headers.get("content-type") ?? "").includes("image/gif"),
    openR.status,
  );
  const afterOpen = await track(D);
  ok(
    "valid open: bounded unique evidence",
    afterOpen?.open_count === 1 && afterOpen.first_open_at !== null,
    JSON.stringify(afterOpen),
  );

  // ── (6) FLOOD of the SAME valid requests changes nothing ───────────────
  const before = await track(D);
  await Promise.all([
    ...Array.from({ length: 25 }, () => hit(`d=${D}&k=open&t=${encodeURIComponent(otok)}`)),
    ...Array.from({ length: 25 }, () => hit(`d=${D}&k=click&t=${encodeURIComponent(ctok)}&u=${u}`)),
  ]);
  const after = await track(D);
  ok(
    "valid-token FLOOD: no write amplification, every value byte-identical",
    JSON.stringify(before) === JSON.stringify(after),
    JSON.stringify(after),
  );
  ok(
    "valid-token FLOOD: still exactly one tracking row",
    (await rowCount()) === 1,
    await rowCount(),
  );
  const stillRedirects = await hit(`d=${D}&k=click&t=${encodeURIComponent(ctok)}&u=${u}`);
  ok(
    "a replayed valid click still redirects correctly (recipient experience preserved)",
    stillRedirects.status === 302 && stillRedirects.headers.get("location") === DEST,
    stillRedirects.headers.get("location"),
  );

  // ── (7) non-enumerating: an unknown delivery answers identically ───────
  const unknownOpen = await hit(`d=${crypto.randomUUID()}&k=open&t=${encodeURIComponent(otok)}`);
  ok(
    "non-enumerating: an unknown delivery's open is indistinguishable",
    unknownOpen.status === openR.status &&
      unknownOpen.headers.get("content-type") === openR.headers.get("content-type"),
    unknownOpen.status,
  );

  // ── (8) method + secret hygiene ────────────────────────────────────────
  const post = await fetch(`${TRACK}?d=${D}&k=open&t=${encodeURIComponent(otok)}`, {
    method: "POST",
    redirect: "manual",
  });
  ok("non-GET is refused", post.status === 405, post.status);
  const bodies = await Promise.all(
    [good, openR, unknownOpen].map(
      (r) =>
        r
          .clone?.()
          .text?.()
          .catch(() => "") ?? "",
    ),
  );
  ok(
    "the tracking secret never appears in any response",
    bodies.every((b) => !String(b).includes(SECRET)),
  );

  await cleanup();
  console.log(failed === 0 ? "\nALL PASS (real HTTP boundary exercised)" : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  process.exit(1);
});
