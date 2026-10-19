import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installCandidateIntake } from "./receptionist-intake-installation.ts";
import { launchPromotionIds as ids } from "./receptionist-launch-promotion.ts";
import { clearLaunchModel } from "./receptionist-launch-clear-contract.ts";

const secret = "TEST_ONLY_" + "x".repeat(45);
const actor = "30000000-0000-0000-0000-000000000001";

function fixture() {
  const orgId = "10000000-0000-0000-0000-000000000001";
  const candidate: any = {
    id: ids.candidate, orgId, firstMessage: "openfolk_holidays", voice: { voiceId: "unchanged" },
    model: {
      provider: "openai", model: "gpt-4.1", toolIds: [ids.handoff],
      tools: [{ type: "transferCall", function: { name: "ordinary" }, destinations: Array.from({ length: 10 }, (_, n) => ({
        type: "number", number: `+44179437810${n}`, description: `Approved ${n}`, message: "", transferPlan: { mode: "blind-transfer" },
      })) }],
    },
  };
  candidate.model = clearLaunchModel(candidate);
  const graph: any = {
    [`assistant/${ids.candidate}`]: candidate,
    [`tool/${ids.handoff}`]: { id: ids.handoff, orgId, type: "handoff", function: { name: "Route-Emergency-to-Rob-or-Tony" }, destinations: [{ type: "assistant", assistantId: ids.helper }] },
    [`assistant/${ids.live}`]: { id: ids.live, orgId, model: { toolIds: [ids.ordinary] }, voice: { voiceId: "Live Emma" } },
    [`assistant/${ids.helper}`]: { id: ids.helper, orgId, model: { toolIds: [ids.emergency] }, voice: { voiceId: "Live Emma" } },
    "phone-number": [{ id: "40000000-0000-0000-0000-000000000001", assistantId: ids.live }],
  };
  const source = { candidate_id: ids.candidate, helper_id: ids.helper, handoff_id: ids.handoff, source_assistant: { orgId } };
  const state: any = {
    audit: null, denied: false, auditError: false, reserveError: false, updateError: false, sourceError: false,
    reads: [], writes: [], rpcs: [], inserts: [], updates: [], failBefore: new Set<string>(), failAfter: new Set<string>(),
    readFailures: new Set<string>(), onPatch: null, onRead: null,
  };
  const db = {
    rpc: async (name: string, args: unknown) => { state.rpcs.push({ name, args }); return { error: state.denied ? "denied" : null }; },
    from(table: string) {
      assert.ok(["receptionist_test_candidates", "receptionist_intake_installation"].includes(table), "Only approved private tables");
      return {
        select(fields: string) {
          return { eq(key: string, value: string) {
            assert.equal(key, "tenant_id"); assert.equal(value, ids.tenant);
            return {
              maybeSingle: async () => {
                assert.equal(table, "receptionist_intake_installation"); assert.equal(fields, "state,verified_at");
                return { data: state.audit ? { state: state.audit.state, verified_at: state.audit.verified_at } : null, error: state.auditError ? "private" : null };
              },
              single: async () => { assert.equal(table, "receptionist_test_candidates"); return { data: structuredClone(source), error: state.sourceError ? "error" : null }; },
            };
          } };
        },
        insert(row: unknown) {
          assert.equal(table, "receptionist_intake_installation"); state.inserts.push({ table, row: structuredClone(row) });
          if (!state.reserveError) state.audit = structuredClone(row);
          return Promise.resolve({ error: state.reserveError ? "unique conflict" : null });
        },
        update(fields: unknown) {
          assert.equal(table, "receptionist_intake_installation");
          return { eq(key: string, value: string) {
            assert.equal(key, "tenant_id"); assert.equal(value, ids.tenant);
            return { eq(key: string, value: string) {
              assert.equal(key, "state"); assert.equal(value, "prepared");
              state.updates.push({ table, fields: structuredClone(fields) });
              if (!state.updateError) state.audit = { ...state.audit, ...(fields as object) };
              return Promise.resolve({ error: state.updateError ? "failed audit" : null });
            } };
          } };
        },
      };
    },
  };
  const api = async (path: string, method = "GET", payload?: any) => {
    assert.ok(Object.hasOwn(graph, path), "No new endpoint or provider resource");
    if (method === "GET") {
      state.reads.push(path);
      state.onRead?.(path, state.reads.filter((p: string) => p === path).length);
      if (state.readFailures.has(path)) throw Error("Provider read unavailable");
      return structuredClone(graph[path]);
    }
    assert.equal(method, "PATCH");
    assert.ok([`tool/${ids.handoff}`, `assistant/${ids.candidate}`].includes(path), "No live/helper/phone writes");
    state.writes.push({ path, payload: structuredClone(payload) });
    if (state.failBefore.has(path)) throw Error("Write failed before application");
    graph[path] = { ...graph[path], ...structuredClone(payload) };
    state.onPatch?.(path);
    if (state.failAfter.has(path)) throw Error("Ambiguous response after application");
    return structuredClone(graph[path]);
  };
  return { state, source, graph, run: () => installCandidateIntake(db, api, actor, secret), db, api };
}

test("installation patches only the isolated handoff and candidate, verifies readback and preserves original baseline", async () => {
  const f = fixture(), before = structuredClone(f.graph), source = structuredClone(f.source);
  const result = await f.run();
  assert.equal(result.state, "verified"); assert.equal(result.configurationReadBack, true);
  assert.equal(result.liveAndPhoneBindingsUnchanged, true);
  assert.deepEqual(f.state.writes.map((w: any) => w.path), [`tool/${ids.handoff}`, `assistant/${ids.candidate}`]);
  for (const path of [`assistant/${ids.live}`, `assistant/${ids.helper}`, "phone-number"]) assert.deepEqual(f.graph[path], before[path]);
  assert.deepEqual(f.source, source);
  assert.deepEqual(f.state.audit.before_candidate, before[`assistant/${ids.candidate}`]);
  assert.deepEqual(f.state.audit.before_handoff, before[`tool/${ids.handoff}`]);
  assert.match(f.state.audit.candidate_hash, /^[a-f0-9]{64}$/);
  assert.match(f.state.audit.handoff_hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(f.state.rpcs, [{ name: "care_release_actor", args: { p_actor: actor } }]);
  for (const key of ["voiceTestPassed", "webhookCallProven", "paidRunStarted", "retrySent"] as const) assert.equal(result[key], false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(f.state.audit).includes(secret), false, "Scoped new credential is not stored in the before snapshot");
  assert.equal(f.state.writes[0].payload.destinations[0].server.headers["X-OpenFolk-Intake-Token"], secret);
});

test("invalid credential and non-Chris authority fail before provider reads or writes", async () => {
  const f = fixture(); await assert.rejects(installCandidateIntake(f.db, f.api, actor, "short"), /credential/);
  assert.equal(f.state.reads.length, 0); assert.equal(f.state.inserts.length, 0);
  f.state.denied = true; await assert.rejects(f.run(), /administrator/);
  assert.equal(f.state.reads.length, 0); assert.equal(f.state.writes.length, 0);
});

test("an existing reservation never retries a prepared, failed or verified operation", async () => {
  for (const state of ["prepared", "review_required", "verified"]) {
    const f = fixture(); f.state.audit = { state, verified_at: null, privateSecret: "SHOULD_NOT_RETURN" };
    const result = await f.run();
    assert.equal(result.alreadyReserved, true); assert.equal(result.retrySent, false);
    assert.equal(f.state.reads.length, 0); assert.equal(f.state.writes.length, 0);
    assert.equal(JSON.stringify(result).includes("SHOULD_NOT_RETURN"), false);
  }
});

test("failed private audit read or competing reservation does not mutate provider state", async () => {
  const f = fixture(); f.state.auditError = true; await assert.rejects(f.run(), /audit unavailable/);
  assert.equal(f.state.reads.length, 0);
  f.state.auditError = false; f.state.reserveError = true; await assert.rejects(f.run(), /not reserved/);
  assert.equal(f.state.writes.length, 0);
});

test("wrong provider/source identities and a direct candidate telephone binding fail before reservation", async () => {
  for (const kind of ["source", "org", "liveTool", "helperTool", "phone", "squadId", "squad", "embeddedAssistant", "extraCandidateTool"] as const) {
    const f = fixture();
    if (kind === "source") f.source.candidate_id = ids.live;
    if (kind === "org") f.graph[`tool/${ids.handoff}`].orgId = "other";
    if (kind === "liveTool") f.graph[`assistant/${ids.live}`].model.toolIds.push(ids.handoff);
    if (kind === "helperTool") f.graph[`assistant/${ids.helper}`].model.toolIds.push(ids.handoff);
    if (kind === "phone") f.graph["phone-number"][0].assistantId = ids.candidate;
    if (kind === "squadId") f.graph["phone-number"][0].squadId = "another-squad";
    if (kind === "squad") f.graph["phone-number"][0].squad = { members: [{ assistantId: ids.candidate }] };
    if (kind === "embeddedAssistant") f.graph["phone-number"][0].assistant = { id: ids.helper };
    if (kind === "extraCandidateTool") f.graph[`assistant/${ids.candidate}`].model.toolIds.push(ids.emergency);
    await assert.rejects(f.run(), /binding requires review/);
    assert.equal(f.state.inserts.length, 0); assert.equal(f.state.writes.length, 0);
  }
});

test("unreviewed candidate prompt is not silently overwritten", async () => {
  const f = fixture(); f.graph[`assistant/${ids.candidate}`].model.messages[0].content += "\nUnreviewed instructions";
  await assert.rejects(f.run(), /Unreviewed/);
  assert.equal(f.state.writes.length, 0); assert.equal(f.state.inserts.length, 0);
});

test("provider change between initial inspection and reservation stops before any write", async () => {
  for (const path of [`assistant/${ids.candidate}`, `tool/${ids.handoff}`]) {
    const f = fixture();
    f.state.onRead = (readPath: string, count: number) => {
      if (readPath === path && count === 2) f.graph[path].externalChange = "new provider edit";
    };
    await assert.rejects(f.run(), /changed before reservation/);
    assert.equal(f.state.inserts.length, 0);
    assert.equal(f.state.writes.length, 0);
  }
});

test("ambiguous but proven-applied writes are read back, never retried, and uncertainty remains visible", async () => {
  const f = fixture(); f.state.failAfter.add(`tool/${ids.handoff}`); f.state.failAfter.add(`assistant/${ids.candidate}`);
  const result = await f.run();
  assert.equal(result.state, "verified"); assert.equal(result.providerUncertain, true); assert.equal(result.retrySent, false);
  assert.equal(f.state.writes.length, 2);
  await f.run(); assert.equal(f.state.writes.length, 2);
});

test("unproven tool write stops before candidate edit and cannot claim verified", async () => {
  const f = fixture(); f.state.failBefore.add(`tool/${ids.handoff}`);
  const result = await f.run();
  assert.equal(result.state, "review_required"); assert.equal(result.configurationReadBack, false);
  assert.equal(f.state.writes.length, 1); assert.equal(f.state.audit.verified_at, null);
});

test("unproven candidate write records review-required without retry or success claim", async () => {
  const f = fixture(); f.state.failBefore.add(`assistant/${ids.candidate}`);
  const result = await f.run();
  assert.equal(result.state, "review_required"); assert.equal(result.configurationReadBack, false);
  assert.equal(f.state.writes.length, 2); assert.equal(f.state.audit.verified_at, null);
});

test("failed provider readback leaves reservation intact and a later request cannot retry", async () => {
  const f = fixture(); f.state.onPatch = (path: string) => f.state.readFailures.add(path);
  await assert.rejects(f.run(), /read unavailable/);
  assert.equal(f.state.audit.state, "prepared"); assert.equal(f.state.writes.length, 1);
  const result = await f.run(); assert.equal(result.alreadyReserved, true); assert.equal(f.state.writes.length, 1);
});

test("concurrent changes to live assistant, helper or phone bindings prevent verified status", async () => {
  for (const path of [`assistant/${ids.live}`, `assistant/${ids.helper}`, "phone-number"]) {
    const f = fixture(); f.state.onPatch = () => {
      if (path === "phone-number") f.graph[path][0].assistantId = ids.helper;
      else f.graph[path].voice.voiceId = "externally changed";
    };
    const result = await f.run();
    assert.equal(result.state, "review_required"); assert.equal(result.liveAndPhoneBindingsUnchanged, false);
    assert.equal(result.configurationReadBack, false);
    assert.ok(f.state.writes.every((w: any) => ![`assistant/${ids.live}`, `assistant/${ids.helper}`, "phone-number"].includes(w.path)));
  }
});

test("audit persistence failure cannot return a verified result", async () => {
  const f = fixture(); f.state.updateError = true;
  await assert.rejects(f.run(), /audit reconciliation/);
  assert.equal(f.state.audit.state, "prepared"); assert.equal(f.state.writes.length, 2);
});

test("migration explicitly fences both tables and decision RPC to service role", () => {
  const sql = readFileSync(new URL("../../migrations/20261028180000_emma_candidate_intake_check.sql", import.meta.url), "utf8");
  for (const table of ["receptionist_intake_decisions", "receptionist_intake_installation"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from public,\\s*anon,\\s*authenticated`));
    assert.match(sql, new RegExp(`grant all on public\\.${table} to service_role`));
  }
  assert.match(sql, /if auth\.role\(\) is distinct from 'service_role'/);
  assert.match(sql, /security definer set search_path = public/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /old\.payload_hash is distinct from p_payload_hash/);
  assert.match(sql, /old\.call_id is distinct from p_call_id/);
  assert.match(sql, /where call_id=p_call_id and accepted/);
  assert.match(sql, /No request can choose a tenant\/destination/);
  assert.match(sql, /p_reason not in \('accepted','untrusted_binding'/);
  assert.match(sql, /p_accepted is distinct from \(p_reason='accepted'\)/);
  assert.match(sql, /if p_response is distinct from result then raise exception 'Invalid rejection'/);
  assert.ok(!sql.includes("result := p_response"), "No arbitrary caller-data string may become persisted rejection text");
  assert.ok(!/update public\.receptionist_test_candidates/i.test(sql));
  assert.ok(!/create policy/i.test(sql), "No client-role access policy is introduced");
});
