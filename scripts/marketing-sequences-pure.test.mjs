// Marketing Phase 6 — pure proofs. Run:
//   node --test scripts/marketing-sequences-pure.test.mjs
//
// Layers, no network, no DB:
//  1. The SEQUENCE envelope: an exact third allowlist, disjoint from the test
//     and broadcast shapes. Neither can smuggle the other's fields, and the
//     discriminated dispatcher routes purely on `purpose`.
//  2. The CONTACT-ACTION envelope for the internal capability: exact
//     allowlist, uuid discipline, intent-type ↔ action coherence.
//  3. MOCKED ADAPTER BOUNDARIES — the real execute() against scripted
//     clients:
//       * the Gmail adapter calls the SEQUENCE send authority (not the
//         broadcast one) before its single provider call, and a policy refusal
//         is a permanent policy_* skip with ZERO provider calls;
//       * the internal actions adapter never touches the network, refuses a
//         cross-tenant envelope, refuses a deactivated tag truthfully, and
//         converges idempotently when a follow-up already exists.

import test from "node:test";
import assert from "node:assert/strict";

import {
  SEQUENCE_ENVELOPE_KEYS,
  validateBroadcastEnvelope,
  validateMarketingEnvelope,
  validateSendEnvelope,
  validateSequenceEnvelope,
} from "../supabase/functions/_shared/marketing_email.ts";
import {
  CONTACT_ACTION_ENVELOPE_KEYS,
  marketingActionsAdapter,
  validateContactActionEnvelope,
} from "../supabase/functions/_shared/connectors/marketing_actions.ts";
import { marketingEmailAdapter } from "../supabase/functions/_shared/connectors/marketing_email.ts";

const U = (n) => `${"0".repeat(8 - String(n).length)}${n}-0000-4000-8000-000000000000`;
const HASH = "a".repeat(64);
const TOKEN = "b".repeat(48);
const UNSUB = `https://unsub.test/functions/v1/marketing-unsubscribe?t=${TOKEN}`;

function sequenceEnvelope(over = {}) {
  return {
    sender_profile_id: U(1),
    source_kind: "gmail_oauth",
    mailbox_address: "sender@t.test",
    recipient_profile_id: null,
    recipient_email: "person@x.test",
    subject: "Hello Pat",
    body_text: `Hi Pat.\n\nUnsubscribe: ${UNSUB}`,
    body_html: `<div>Hi Pat. <a href="${UNSUB}">Unsubscribe</a></div>`,
    preview_text: null,
    from_name: "Drummonds",
    reply_to: null,
    signature_text: null,
    purpose: "sequence",
    content_version: "1",
    content_hash: HASH,
    actor_profile_id: U(2),
    request_id: "sq-abcdefabcdef-g1",
    delivery_id: U(3),
    campaign_id: U(4),
    sequence_revision_id: U(5),
    sequence_approval_id: U(6),
    bundle_hash: HASH,
    sequence_enrolment_id: U(7),
    sequence_execution_id: U(8),
    sequence_step_id: U(9),
    step_order: 1,
    generation: 1,
    person_id: U(10),
    contact_point_id: U(11),
    unsubscribe_token_id: U(12),
    unsubscribe_url: UNSUB,
    ...over,
  };
}

function actionEnvelope(over = {}) {
  return {
    tenant_id: U(20),
    person_id: U(10),
    campaign_id: U(4),
    sequence_revision_id: U(5),
    sequence_enrolment_id: U(7),
    sequence_execution_id: U(8),
    sequence_step_id: U(9),
    step_order: 3,
    action_type: "apply_tag",
    config: { tag_id: U(30) },
    authorised_by: U(2),
    request_id: "sa-abcdefabcdef-g1",
    ...over,
  };
}

/* ── 1 · the sequence envelope ───────────────────────────────────────────── */

test("sequence envelope: the exact allowlist validates; every omission fails", () => {
  const ok = validateSequenceEnvelope(sequenceEnvelope());
  assert.equal(ok.ok, true, ok.ok ? "" : ok.error);
  for (const k of SEQUENCE_ENVELOPE_KEYS) {
    const clone = sequenceEnvelope();
    delete clone[k];
    const r = validateSequenceEnvelope(clone);
    assert.equal(r.ok, false, `omitting ${k} must fail`);
  }
  const extra = validateSequenceEnvelope({ ...sequenceEnvelope(), bcc: "attacker@x.test" });
  assert.equal(extra.ok, false, "an undeclared field is refused");
  assert.match(extra.error, /undeclared envelope field bcc/);
});

test("sequence envelope: the unsubscribe link must be in BOTH bodies", () => {
  assert.equal(validateSequenceEnvelope(sequenceEnvelope({ body_text: "Hi Pat." })).ok, false);
  assert.equal(
    validateSequenceEnvelope(sequenceEnvelope({ body_html: "<div>Hi Pat.</div>" })).ok,
    false,
  );
});

test("sequence envelope: a Person is addressed, never a profile", () => {
  const r = validateSequenceEnvelope(sequenceEnvelope({ recipient_profile_id: U(99) }));
  assert.equal(r.ok, false);
  assert.match(r.error, /recipient_profile_id must be null/);
});

test("sequence envelope: header material can never reach the envelope", () => {
  assert.equal(
    validateSequenceEnvelope(sequenceEnvelope({ subject: "Hi\r\nBcc: victim@x.test" })).ok,
    false,
  );
  assert.equal(
    validateSequenceEnvelope(sequenceEnvelope({ recipient_email: "a@b.test\nBcc: x@y.test" })).ok,
    false,
  );
});

test("discrimination: the three purposes cannot smuggle each other's shapes", () => {
  // a sequence envelope routed by purpose
  const seq = validateMarketingEnvelope(sequenceEnvelope());
  assert.equal(seq.ok, true);
  assert.equal(seq.envelope.purpose, "sequence");
  // the broadcast validator rejects a sequence envelope outright
  assert.equal(validateBroadcastEnvelope(sequenceEnvelope()).ok, false);
  // the test validator rejects it too
  assert.equal(validateSendEnvelope(sequenceEnvelope()).ok, false);
  // and a sequence envelope claiming to be a broadcast fails its own allowlist
  const mislabelled = validateMarketingEnvelope(sequenceEnvelope({ purpose: "broadcast" }));
  assert.equal(mislabelled.ok, false);
});

/* ── 2 · the internal contact-action envelope ────────────────────────────── */

test("contact-action envelope: exact allowlist and uuid discipline", () => {
  assert.equal(validateContactActionEnvelope(actionEnvelope()).ok, true);
  for (const k of CONTACT_ACTION_ENVELOPE_KEYS) {
    const clone = actionEnvelope();
    delete clone[k];
    assert.equal(validateContactActionEnvelope(clone).ok, false, `omitting ${k} must fail`);
  }
  assert.equal(
    validateContactActionEnvelope({ ...actionEnvelope(), shell: "rm -rf /" }).ok,
    false,
    "an undeclared field is refused",
  );
  assert.equal(validateContactActionEnvelope(actionEnvelope({ person_id: "nope" })).ok, false);
  assert.equal(
    validateContactActionEnvelope(actionEnvelope({ action_type: "delete_everything" })).ok,
    false,
  );
});

test("contact-action adapter: validate() enforces intent-type ↔ action coherence", () => {
  const base = {
    tenantId: U(20),
    intentId: U(40),
    capabilityKey: "marketing.contact_action",
    operationType: "apply",
    idempotencyKey: "k",
    correlationId: null,
  };
  assert.equal(
    marketingActionsAdapter.validate({
      ...base,
      intentType: "marketing_apply_tag",
      parameters: actionEnvelope(),
    }).ok,
    true,
  );
  // an intent type that disagrees with the envelope's action is refused
  const mismatch = marketingActionsAdapter.validate({
    ...base,
    intentType: "marketing_change_lifecycle",
    parameters: actionEnvelope(),
  });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.errorMessage, /does not match action/);
  // the wrong capability is refused
  assert.equal(
    marketingActionsAdapter.validate({
      ...base,
      capabilityKey: "email.send_marketing",
      intentType: "marketing_apply_tag",
      parameters: actionEnvelope(),
    }).ok,
    false,
  );
});

/* ── 3 · mocked adapter boundaries ──────────────────────────────────────── */

// the SAME scripted-client shape the proven Phase-5 suite uses: each table is a
// QUEUE of {data,error} results consumed in call order.
function scriptedDb(script) {
  const tables = structuredClone(script.tables ?? {});
  const rpcCalls = [];
  return {
    rpcCalls,
    from(table) {
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        // a bare .limit() terminates the chain (used for list reads)
        limit() {
          const queue = tables[table];
          if (!queue || queue.length === 0) {
            return Promise.resolve({ data: null, error: { message: `unscripted ${table}` } });
          }
          return Promise.resolve(queue.shift());
        },
        maybeSingle() {
          const queue = tables[table];
          if (!queue || queue.length === 0) {
            return Promise.resolve({ data: null, error: { message: `unscripted ${table}` } });
          }
          return Promise.resolve(queue.shift());
        },
        single() {
          return q.maybeSingle();
        },
        insert(v) {
          const queue = tables[`${table}:insert`] ?? [];
          const result = queue.shift() ?? { data: { id: "inserted" }, error: null };
          return {
            select: () => ({ single: () => Promise.resolve(result) }),
            then: (res) => res(result),
          };
        },
      };
      return q;
    },
    rpc(name, args) {
      rpcCalls.push({ name, args });
      return Promise.resolve(
        script.rpcs?.[name] ?? { data: null, error: { message: `unscripted rpc ${name}` } },
      );
    },
  };
}

const SEQ_INPUT = {
  tenantId: "t1",
  intentId: "i1",
  intentType: "send_marketing_sequence_email",
  capabilityKey: "email.send_marketing",
  operationType: "send_marketing_sequence_email",
  parameters: sequenceEnvelope(),
  idempotencyKey: "idem-seq-1",
  correlationId: null,
};

const healthySequenceScript = () => ({
  tables: {
    marketing_settings: [{ data: { marketing_enabled: true }, error: null }],
    profiles: [{ data: { id: sequenceEnvelope().actor_profile_id, tenant_id: "t1" }, error: null }],
    marketing_sender_profiles: [
      {
        data: {
          id: sequenceEnvelope().sender_profile_id,
          tenant_id: "t1",
          source_kind: "gmail_oauth",
          email_account_id: "acc-1",
          workspace_mailbox_id: null,
          mailbox_address: "sender@t.test",
          enabled: true,
        },
        error: null,
      },
    ],
    tenant_connector_capabilities: [{ data: { enabled: true }, error: null }],
    email_oauth_tokens: [
      {
        data: {
          access_token: "tok",
          refresh_token: "ref",
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          scope:
            "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
        },
        error: null,
      },
    ],
  },
  rpcs: {
    marketing_effective_permissions: {
      data: { enabled: true, permissions: ["marketing.view", "marketing.campaigns.launch"] },
      error: null,
    },
    marketing_sender_readiness: {
      data: { ready: true, state: "ready", enabled: true },
      error: null,
    },
    marketing_sequence_send_authority: { data: { allowed: true, code: "ok" }, error: null },
  },
});

async function runEmail(script, { expectProviderCall = false, providerResponse } = {}) {
  const realFetch = globalThis.fetch;
  let calls = 0;
  let sentBody = null;
  const db = scriptedDb(script);
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    sentBody = init?.body ?? null;
    if (!expectProviderCall) throw new Error("provider must not be reached");
    return providerResponse();
  };
  try {
    const result = await marketingEmailAdapter.execute(SEQ_INPUT, {
      supabaseAdmin: db,
      now: "2026-07-30T12:00:00.000Z",
      signal: null,
    });
    return { result, calls, sentBody, rpcCalls: db.rpcCalls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("gmail adapter: exactly three registered marketing intent types", () => {
  assert.deepEqual(marketingEmailAdapter.supportedIntentTypes, [
    "send_marketing_test_email",
    "send_marketing_broadcast_email",
    "send_marketing_sequence_email",
  ]);
  // the intent type must agree with the envelope's declared purpose
  const mismatched = marketingEmailAdapter.validate({
    ...SEQ_INPUT,
    intentType: "send_marketing_broadcast_email",
  });
  assert.equal(mismatched.ok, false);
  assert.match(mismatched.errorMessage ?? "", /does not match envelope purpose/);
  assert.equal(marketingEmailAdapter.validate(SEQ_INPUT).ok, true);
});

test("gmail adapter: a sequence send consults the SEQUENCE authority pre-provider", async () => {
  const script = healthySequenceScript();
  script.rpcs.marketing_sequence_send_authority = {
    data: { allowed: false, code: "not_subscribed", state: "unsubscribed" },
    error: null,
  };
  const { result, calls, rpcCalls } = await runEmail(script);
  assert.equal(result.outcome, "failed_permanent");
  assert.equal(result.errorCode, "policy_not_subscribed");
  assert.equal(calls, 0, "ZERO provider calls on a policy skip");
  const names = rpcCalls.map((c) => c.name);
  assert.ok(
    names.includes("marketing_sequence_send_authority"),
    "the SEQUENCE authority was consulted",
  );
  assert.ok(
    !names.includes("marketing_broadcast_send_authority"),
    "the broadcast authority is NOT used for a sequence send",
  );
});

test("gmail adapter: an authority READ ERROR is a safe retryable pre-provider failure", async () => {
  const script = healthySequenceScript();
  script.rpcs.marketing_sequence_send_authority = {
    data: null,
    error: { message: "boom" },
  };
  const { result, calls } = await runEmail(script);
  assert.equal(result.outcome, "failed_transient");
  assert.equal(calls, 0, "an unreadable authority NEVER reaches the provider");
});

test("gmail adapter: the healthy sequence path sends ONE multipart provider call", async () => {
  const { result, calls, sentBody } = await runEmail(healthySequenceScript(), {
    expectProviderCall: true,
    providerResponse: () =>
      new Response(JSON.stringify({ id: "gm-1", threadId: "th-1" }), { status: 200 }),
  });
  assert.equal(result.outcome, "succeeded");
  assert.equal(calls, 1, "exactly ONE provider call");
  const raw = JSON.parse(sentBody).raw;
  const msg = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  assert.ok(msg.includes("multipart/alternative"), "sequence sends use multipart MIME");
  assert.ok(msg.includes("List-Unsubscribe-Post: List-Unsubscribe=One-Click"));
});

/* ── 4 · the internal actions adapter ───────────────────────────────────── */

async function runAction(script, parameters, intentType = "marketing_apply_tag", tenantId = U(20)) {
  const realFetch = globalThis.fetch;
  let calls = 0;
  const db = scriptedDb(script);
  globalThis.fetch = () => {
    calls += 1;
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  try {
    const result = await marketingActionsAdapter.execute(
      {
        tenantId,
        intentId: "i2",
        intentType,
        capabilityKey: "marketing.contact_action",
        operationType: intentType,
        parameters,
        idempotencyKey: "idem-act-1",
        correlationId: null,
      },
      { supabaseAdmin: db, now: "2026-07-30T12:00:00.000Z" },
    );
    return { result, calls, rpcCalls: db.rpcCalls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const ACTION_ENV = () => actionEnvelope();

test("actions adapter: never calls the network and refuses a cross-tenant envelope", async () => {
  // the executing tenant differs from the tenant frozen in the envelope
  const { result, calls } = await runAction({}, actionEnvelope(), "marketing_apply_tag", U(21));
  assert.equal(result.outcome, "failed_permanent");
  assert.equal(result.errorCode, "cross_tenant_reference");
  assert.equal(calls, 0, "an internal adapter makes NO network call");
});

test("actions adapter: a policy-blocked enrolment stops the internal action", async () => {
  const { result, calls } = await runAction(
    {
      rpcs: {
        marketing_sequence_authority_core: {
          data: { allowed: false, code: "enrolment_not_active" },
          error: null,
        },
      },
    },
    ACTION_ENV(),
  );
  assert.equal(result.outcome, "failed_permanent");
  assert.match(result.errorCode, /^policy_/);
  assert.equal(calls, 0);
});

test("actions adapter: an EMAIL-only precondition never blocks an internal action", async () => {
  const { result, rpcCalls } = await runAction(
    {
      rpcs: {
        // the recipient is unsubscribed — that governs SENDING, not tagging
        marketing_sequence_authority_core: {
          data: { allowed: false, code: "not_subscribed" },
          error: null,
        },
        marketing_tag_mutate: { data: { assigned: true }, error: null },
      },
      tables: {
        people: [{ data: { id: U(10), tenant_id: U(20), display_name: "Pat" }, error: null }],
        marketing_tags: [{ data: { id: U(30), tenant_id: U(20), active: true }, error: null }],
      },
    },
    ACTION_ENV(),
  );
  assert.equal(result.outcome, "succeeded");
  assert.ok(
    rpcCalls.some((c) => c.name === "marketing_tag_mutate"),
    "the canonical governed tag RPC did the work — not a direct table write",
  );
});

test("actions adapter: a tag deactivated after approval fails TRUTHFULLY", async () => {
  const { result } = await runAction(
    {
      rpcs: {
        marketing_sequence_authority_core: { data: { allowed: true, code: "ok" }, error: null },
      },
      tables: {
        people: [{ data: { id: U(10), tenant_id: U(20), display_name: "Pat" }, error: null }],
        marketing_tags: [{ data: { id: U(30), tenant_id: U(20), active: false }, error: null }],
      },
    },
    ACTION_ENV(),
  );
  assert.equal(result.outcome, "failed_permanent");
  assert.equal(result.errorCode, "target_inactive");
});

test("actions adapter: a Person from another tenant is refused", async () => {
  const { result } = await runAction(
    {
      rpcs: {
        marketing_sequence_authority_core: { data: { allowed: true, code: "ok" }, error: null },
      },
      tables: {
        people: [{ data: { id: U(10), tenant_id: U(99), display_name: "Pat" }, error: null }],
      },
    },
    ACTION_ENV(),
  );
  assert.equal(result.outcome, "failed_permanent");
  assert.equal(result.errorCode, "person_invalid");
});

test("actions adapter: a follow-up converges idempotently on retry", async () => {
  const { result, calls } = await runAction(
    {
      rpcs: {
        marketing_sequence_authority_core: { data: { allowed: true, code: "ok" }, error: null },
        // the GOVERNED follow-up RPC reports an existing work item
        marketing_sequence_create_follow_up: {
          data: { work_item_id: "work-1", idempotent: true },
          error: null,
        },
      },
      tables: {
        people: [{ data: { id: U(10), tenant_id: U(20), display_name: "Pat" }, error: null }],
      },
    },
    actionEnvelope({
      action_type: "create_follow_up",
      config: { subject: "Call this customer", due_in_days: 2 },
    }),
    "marketing_create_follow_up",
  );
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.result.idempotent, true, "a retry converges, never a second work item");
  assert.equal(result.result.work_item_id, "work-1");
  assert.equal(calls, 0, "creating a work item is internal — no network");
});

test("actions adapter: an unprogressable-platform refusal is PERMANENT, never retried", async () => {
  // Second-pass audit lock. The canonical seam refuses with MK428 when the
  // platform has no ('core','Action') state machine. That is a configuration
  // fact — retrying it can never succeed. Classifying it transient would make
  // the Automation Engine retry a permanent refusal until it exhausted its
  // attempts, and would report a configuration problem as a flaky failure.
  const { result, calls } = await runAction(
    {
      rpcs: {
        marketing_sequence_authority_core: { data: { allowed: true, code: "ok" }, error: null },
        marketing_sequence_create_follow_up: {
          data: null,
          error: { code: "MK428", message: "no state_transitions for (core, Action)" },
        },
      },
      tables: {
        people: [{ data: { id: U(10), tenant_id: U(20), display_name: "Pat" }, error: null }],
      },
    },
    actionEnvelope({
      action_type: "create_follow_up",
      config: { subject: "Call this customer", due_in_days: 2 },
    }),
    "marketing_create_follow_up",
  );
  assert.equal(result.outcome, "failed_permanent", "a configuration refusal must not be retried");
  assert.equal(result.errorCode, "configuration_required");
  assert.match(result.errorMessage ?? "", /state machine for core Actions/);
  assert.equal(calls, 0, "no network call is ever made for an internal action");
});

/* ── 5 · AUDIT REGRESSION LOCKS: internal-action convergence ──────────────
 * The canonical marketing_classify_contact REFUSES to create a second
 * classification when an active relationship exists, and REFUSES a no-op
 * update. A step that blindly created therefore failed on the COMMON case (a
 * Person who already has a relationship), and a retry after a successful
 * mutation failed as a no-op — turning completed work into a permanent
 * failure and a held enrolment. These lock the corrected behaviour. */

test("actions adapter: lifecycle UPDATES an existing relationship with its version token", async () => {
  const { result, rpcCalls } = await runAction(
    {
      rpcs: {
        marketing_sequence_authority_core: { data: { allowed: true, code: "ok" }, error: null },
        marketing_classify_contact: { data: { updated: ["lifecycle_stage_key"] }, error: null },
      },
      tables: {
        people: [{ data: { id: U(10), tenant_id: U(20), display_name: "Pat" }, error: null }],
        marketing_lifecycle_stages: [
          { data: { stage_key: "customer", tenant_id: U(20), active: true }, error: null },
        ],
        contact_relationships: [
          {
            data: [{ id: U(70), version: 4, lifecycle_stage_key: "lead", owner_id: null }],
            error: null,
          },
        ],
      },
    },
    actionEnvelope({ action_type: "change_lifecycle", config: { stage_key: "customer" } }),
    "marketing_change_lifecycle",
  );
  assert.equal(result.outcome, "succeeded", JSON.stringify(result));
  const call = rpcCalls.find((c) => c.name === "marketing_classify_contact");
  assert.ok(call, "the canonical RPC was used");
  assert.equal(call.args.p_changes.relationship_id, U(70), "targets the existing relationship");
  assert.equal(call.args.p_changes.expected_version, 4, "carries the optimistic token");
  assert.equal(
    call.args.p_changes.allow_new,
    undefined,
    "never asks to CREATE when an active relationship exists",
  );
});

test("actions adapter: a lifecycle retry after canonical success CONVERGES", async () => {
  const { result, rpcCalls } = await runAction(
    {
      rpcs: {
        marketing_sequence_authority_core: { data: { allowed: true, code: "ok" }, error: null },
      },
      tables: {
        people: [{ data: { id: U(10), tenant_id: U(20), display_name: "Pat" }, error: null }],
        marketing_lifecycle_stages: [
          { data: { stage_key: "customer", tenant_id: U(20), active: true }, error: null },
        ],
        // the first attempt already applied it before the crash
        contact_relationships: [
          {
            data: [{ id: U(70), version: 5, lifecycle_stage_key: "customer", owner_id: null }],
            error: null,
          },
        ],
      },
    },
    actionEnvelope({ action_type: "change_lifecycle", config: { stage_key: "customer" } }),
    "marketing_change_lifecycle",
  );
  assert.equal(result.outcome, "succeeded", "a completed change is not reported as a failure");
  assert.equal(result.result.converged, true);
  assert.ok(
    !rpcCalls.some((c) => c.name === "marketing_classify_contact"),
    "convergence mutates nothing — no duplicate lifecycle history",
  );
});

test("actions adapter: a concurrent human change HOLDS instead of clobbering", async () => {
  const { result } = await runAction(
    {
      rpcs: {
        marketing_sequence_authority_core: { data: { allowed: true, code: "ok" }, error: null },
        marketing_classify_contact: { data: null, error: { code: "MK409", message: "changed" } },
      },
      tables: {
        people: [{ data: { id: U(10), tenant_id: U(20), display_name: "Pat" }, error: null }],
        marketing_lifecycle_stages: [
          { data: { stage_key: "customer", tenant_id: U(20), active: true }, error: null },
        ],
        contact_relationships: [
          {
            data: [{ id: U(70), version: 4, lifecycle_stage_key: "lead", owner_id: null }],
            error: null,
          },
        ],
      },
    },
    actionEnvelope({ action_type: "change_lifecycle", config: { stage_key: "customer" } }),
    "marketing_change_lifecycle",
  );
  assert.equal(result.outcome, "failed_permanent");
  assert.equal(result.errorCode, "policy_target_changed", "newer human work is never overwritten");
});

test("actions adapter: owner assignment converges and never clobbers", async () => {
  // already the owner → converge without mutating
  const converged = await runAction(
    {
      rpcs: {
        marketing_sequence_authority_core: { data: { allowed: true, code: "ok" }, error: null },
      },
      tables: {
        people: [{ data: { id: U(10), tenant_id: U(20), display_name: "Pat" }, error: null }],
        profiles: [{ data: { id: U(2), tenant_id: U(20), role: "ops" }, error: null }],
        contact_relationships: [
          {
            data: [{ id: U(70), version: 3, lifecycle_stage_key: "lead", owner_id: U(2) }],
            error: null,
          },
        ],
      },
    },
    actionEnvelope({ action_type: "assign_owner", config: { owner_profile_id: U(2) } }),
    "marketing_assign_owner",
  );
  assert.equal(converged.result.outcome, "succeeded");
  assert.equal(converged.result.result.converged, true);
  assert.ok(!converged.rpcCalls.some((c) => c.name === "marketing_classify_contact"));

  // a different owner → optimistic update; a conflict holds
  const conflict = await runAction(
    {
      rpcs: {
        marketing_sequence_authority_core: { data: { allowed: true, code: "ok" }, error: null },
        marketing_classify_contact: { data: null, error: { code: "MK409", message: "changed" } },
      },
      tables: {
        people: [{ data: { id: U(10), tenant_id: U(20), display_name: "Pat" }, error: null }],
        profiles: [{ data: { id: U(2), tenant_id: U(20), role: "ops" }, error: null }],
        contact_relationships: [
          {
            data: [{ id: U(70), version: 3, lifecycle_stage_key: "lead", owner_id: U(99) }],
            error: null,
          },
        ],
      },
    },
    actionEnvelope({ action_type: "assign_owner", config: { owner_profile_id: U(2) } }),
    "marketing_assign_owner",
  );
  assert.equal(conflict.result.outcome, "failed_permanent");
  assert.equal(conflict.result.errorCode, "policy_target_changed");
});
