import test from "node:test";
import assert from "node:assert/strict";
import {
  runPhoneDerivedVersion,
  reconcilePhoneDerivedVersion,
  type DerivedScope,
} from "./phone-derived-version.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture(stage: "transcription" | "analysis", fault = "") {
  const scope: DerivedScope = {
    tenantId: id(1),
    recordingId: id(5),
    runId: id(4),
    stage,
    ...(stage === "analysis" ? { transcriptId: id(6) } : {}),
  };
  const output =
    stage === "transcription"
      ? { text: "Retained result", language: "en", model: "synthetic" }
      : { summary: "Retained result" };
  let invoked = 0,
    prepared = 0,
    completes = 0;
  const phases: string[] = [];
  let state = "running",
    saved: any = null,
    receipt: any = null;
  const base = { version: "learn-phone-derived-attempt/1", ...scope };
  const db = {
    rpc: async (_name: string, a: any) => {
      phases.push(a.p_phase);
      if (fault === a.p_phase) return { error: { message: "PRIVATE_FAILURE" }, data: null };
      if (a.p_phase === "dispatch") state = "dispatched";
      if (a.p_phase === "prepare") {
        state = "prepared";
        saved = a.p_data;
        if (fault === "lost_prepare") return { error: { message: "PRIVATE" }, data: null };
      }
      if (a.p_phase === "complete") {
        state = "succeeded";
        completes++;
        receipt = { ...base, state, resultId: id(6), result: saved, cached: false };
        if (fault === "lost_complete" && completes === 1) throw Error("PRIVATE");
        if (fault === "wrong_result")
          return { data: { ...receipt, result: { text: "different" } }, error: null };
        return { data: receipt, error: null };
      }
      if (a.p_phase === "fail") state = saved || state === "dispatched" ? "needs_review" : "failed";
      return {
        error: null,
        data: {
          ...base,
          state,
          replayed: fault === "replayed",
          source: { storagePath: "retained.wav" },
          prepared: saved,
          receipt,
          ...(fault === "foreign" ? { tenantId: id(99) } : {}),
        },
      };
    },
  };
  return {
    scope,
    db,
    phases,
    get invoked() {
      return invoked;
    },
    get prepared() {
      return prepared;
    },
    get state() {
      return state;
    },
    run: () =>
      runPhoneDerivedVersion({
        db,
        scope,
        request: { model: "synthetic", force: true },
        prepareInput: async () => {
          prepared++;
          if (fault === "missing_input") return { ok: false, code: "missing_audio" };
          return {
            ok: true,
            request: { sha256: "a".repeat(64), bytes: 123 },
            invoke: async () => {
              invoked++;
              if (fault === "network") throw Error("PRIVATE_NETWORK");
              return { ok: true, output };
            },
          };
        },
      }),
    resume: () => reconcilePhoneDerivedVersion(db, scope),
  };
}
for (const stage of ["transcription", "analysis"] as const) {
  test(`${stage}: exact result publication and lost completion acknowledgement never repeat paid work`, async () => {
    for (const fault of ["", "lost_complete"]) {
      const f = fixture(stage, fault);
      assert.equal((await f.run()).ok, true);
      assert.equal(f.invoked, 1);
      assert.equal(f.prepared, 1);
      assert.equal(f.phases.filter((x) => x === "complete").length, fault ? 2 : 1);
    }
  });
  test(`${stage}: held/replayed/foreign/uncertain admission stops before paid work`, async () => {
    for (const fault of ["claim", "foreign", "replayed", "dispatch", "missing_input"]) {
      const f = fixture(stage, fault);
      const r = await f.run();
      assert.equal(r.ok, false);
      assert.equal(f.invoked, 0);
      assert.ok(!JSON.stringify(r).includes("PRIVATE"));
    }
  });
  test(`${stage}: lost saved-output reply reconciles the same retained result without provider replay`, async () => {
    const f = fixture(stage, "lost_prepare");
    assert.equal((await f.run()).ok, false);
    assert.equal(f.invoked, 1);
    assert.equal(f.state, "prepared");
    assert.equal((await f.resume()).ok, true);
    assert.equal(f.invoked, 1);
    assert.equal(f.prepared, 1);
  });
  test(`${stage}: uncertain response and conflicting completion never become successful`, async () => {
    for (const fault of ["network", "wrong_result"]) {
      const f = fixture(stage, fault);
      assert.equal((await f.run()).ok, false);
      assert.equal(f.invoked, 1);
      if (fault === "network") {
        assert.equal(f.state, "needs_review");
        assert.equal((await f.resume()).ok, false);
        assert.equal(f.invoked, 1);
      }
    }
  });
}
