import assert from "node:assert/strict";
import test from "node:test";
import {
  FLAG,
  assessAudit,
  assessEnableScope,
  assessFlagScope,
  flagSql,
  switchLive,
} from "./new-dawn-m3-foc-closure-flag.mjs";
import { NAME, PROJECT, SOURCE_SHA256, TENANT } from "./new-dawn-m3-foc-closure-release.mjs";

const auditId = "decccccc-0000-4000-8000-000000000117";
const reason = "Reviewed Drummonds-only operator closure evidence";
function snapshot(on = false, withAudit = false) {
  return {
    project: { id: PROJECT, status: "ACTIVE_HEALTHY" },
    catalog: [
      {
        installed: true,
        function_sha256: "f3a8d3bc8e708c35feb2f819fc89037a446a97fc5051d92ef4d30c1fe4550697",
        authenticated_grant: true,
        anon_grant: false,
        service_grant: false,
        ledger_count: 1,
        ledger_name: NAME,
        ledger_hash: SOURCE_SHA256,
        active_tenant: 1,
        target_rows: Number(on),
        target_on: Number(on),
        global_on: Number(on),
        other_rows: 0,
        client_money_on: 0,
        audit_triggers: 2,
      },
    ],
    candidates: [{ candidate_count: 1 }],
    audit: withAudit
      ? [
          {
            id: auditId,
            tenant_id: TENANT,
            actor: "codex:delegated-openfolk-operator",
            action: `new_dawn.m3_foc_closure_review.${on ? "enable" : "disable"}`,
            resource_type: "feature_flag",
            resource_id: FLAG,
            before: { enabled: !on },
            after: { enabled: on },
            reason,
            source: "codex-release",
            view_as_active: false,
            correlation_id: auditId,
          },
        ]
      : [],
  };
}

test("enable needs exactly one current candidate, exact installed source and no client money", () => {
  assert.equal(assessEnableScope(snapshot(), false).candidateCount, 1);
  for (const change of [
    (s) => {
      s.candidates[0].candidate_count = 0;
    },
    (s) => {
      s.candidates[0].candidate_count = 2;
    },
    (s) => {
      s.catalog[0].ledger_hash = "0".repeat(64);
    },
    (s) => {
      s.catalog[0].authenticated_grant = false;
    },
    (s) => {
      s.catalog[0].other_rows = 1;
    },
    (s) => {
      s.catalog[0].client_money_on = 1;
    },
  ]) {
    const changed = snapshot();
    change(changed);
    assert.throws(() => assessEnableScope(changed, false));
  }
  const sql = flagSql(true, auditId, reason);
  assert.match(sql, /candidate_count|select count\(\*\)::int from eligible/);
  assert.match(sql, /value is distinct from 'false'::jsonb/);
  assert.match(sql, /lock table public\.feature_flags/);
  assert.match(sql, /lock table public\.controlplane_change_log/);
  assert.match(sql, /new_dawn\.owner_money/);
  assert.match(sql, /new_dawn\.m3_foc_closure_review\.enable/);
  assert.match(sql, /\ncommit;$/);
  assert.doesNotMatch(sql, /learn_commusoft_|learn_quickbooks_report_requests|http_request/);
});

test("reason is explicit and escaped, and audited state must match", () => {
  assert.throws(() => flagSql(true, auditId, ""), /reason_required/);
  assert.throws(() => flagSql(true, auditId, "line\nbreak"), /reason_required/);
  assert.match(flagSql(true, auditId, "Chris's reviewed reason"), /Chris''s reviewed reason/);
  assert.doesNotThrow(() => assessAudit(snapshot(true, true), auditId, true, reason));
  const changed = snapshot(true, true);
  changed.audit[0].tenant_id = "00000000-0000-0000-0000-000000000002";
  assert.throws(() => assessAudit(changed, auditId, true, reason), /audit_changed/);
});

test("disable works despite source drift, but requires the exact target ON", () => {
  const oldSource = snapshot(true);
  oldSource.candidates[0].candidate_count = 0;
  oldSource.catalog[0].ledger_hash = "0".repeat(64);
  assert.equal(assessFlagScope(oldSource, true, { withdrawal: true }).operatorFlagEnabled, true);
  assert.throws(() => assessFlagScope(snapshot(), true, { withdrawal: true }));
  const sql = flagSql(false, auditId, reason);
  assert.match(sql, /new_dawn\.m3_foc_closure_review\.disable/);
  assert.doesNotMatch(sql, /select count\(\*\)::int from eligible/);
});

test("uncertain write gets one independent audit readback and is never replayed", async () => {
  let reads = 0;
  let writes = 0;
  const enabled = await switchLive(true, {
    token: "synthetic",
    auditId,
    reason,
    readEnable: async () => (++reads === 1 ? snapshot() : snapshot(true, true)),
    write: async () => {
      writes++;
      throw Error("lost connection");
    },
  });
  assert.equal(enabled.operatorFlagEnabled, true);
  assert.equal(enabled.writeAcknowledged, false);
  assert.equal(reads, 2);
  assert.equal(writes, 1);
  reads = 0;
  await assert.rejects(
    switchLive(true, {
      token: "synthetic",
      auditId,
      reason,
      readEnable: async () => {
        reads++;
        return snapshot();
      },
      write: async () => {
        writes++;
        throw Error("uncertain");
      },
    }),
    /outcome_unverified_no_replay/,
  );
  assert.equal(reads, 2);
  assert.equal(writes, 2);
});

test("disable verifies its own audit and remains usable after source drift", async () => {
  let reads = 0;
  let writes = 0;
  const result = await switchLive(false, {
    token: "synthetic",
    auditId,
    reason,
    readFlag: async () => {
      const state = ++reads === 1 ? snapshot(true) : snapshot(false, true);
      state.catalog[0].ledger_hash = "0".repeat(64);
      return state;
    },
    write: async () => {
      writes++;
      return [{ marker: "m3-foc-flag-disabled/1" }];
    },
  });
  assert.equal(result.operatorFlagEnabled, false);
  assert.equal(result.readbackVerified, true);
  assert.equal(reads, 2);
  assert.equal(writes, 1);
});
