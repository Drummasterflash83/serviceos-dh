import test from "node:test";
import assert from "node:assert/strict";
import {
  capturePhoneRecordingVersion,
  reconcilePhoneRecordingVersion,
} from "./phone-download-version.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { tenantId: id(1), runId: id(2), recordingId: id(3) };
const definition = {
  accountId: id(4),
  connectorId: id(5),
  customerId: "3950",
  source: { storagePath: "retained-original.wav" },
};
function fixture(options: any = {}) {
  const phases: any[] = [];
  const uploads: any[] = [];
  const objects = new Map([["retained-original.wav", new Blob(["old audio"])]]);
  let fetched = 0,
    state = "running",
    prepared: any = null,
    completions = 0;
  const db: any = {
    rpc: async (name: string, args: any) => {
      assert.equal(name, "learn_phone_download_attempt");
      assert.equal(args.p_tenant, scope.tenantId);
      assert.equal(args.p_run, scope.runId);
      assert.equal(args.p_recording, scope.recordingId);
      const phase = args.p_phase;
      phases.push(args);
      if (options.refuse === phase)
        return { data: null, error: { message: options.error ?? "PRIVATE_DIAGNOSTIC" } };
      if (phase === "prepare") {
        prepared = args.p_data;
        state = "prepared";
      }
      if (phase === "complete") {
        assert.deepEqual(args.p_data, prepared);
        state = "succeeded";
        completions++;
        if (options.lostCompletion && completions === 1) throw Error("PRIVATE_RESPONSE");
      }
      if (phase === "fail") state = prepared ? "needs_review" : "failed";
      return {
        data: {
          version: "learn-phone-download-attempt/1",
          ...scope,
          state,
          replayed: options.replayed ?? false,
          ...(prepared ? { prepared } : {}),
          ...(options.foreign ? { tenantId: id(99) } : {}),
        },
        error: null,
      };
    },
    storage: {
      from: (bucket: string) => {
        assert.equal(bucket, "phone-recordings");
        return {
          upload: async (path: string, blob: Blob, config: any) => {
            uploads.push({ path, config });
            assert.equal(config.upsert, false);
            if (!options.uploadMissing) objects.set(path, blob);
            if (options.uploadThrows) throw Error("PRIVATE_UPLOAD");
            return { error: options.uploadMissing ? { message: "private" } : null };
          },
          download: async (path: string) => ({
            data: options.corrupt ? new Blob(["abc"]) : (objects.get(path) ?? null),
            error: null,
          }),
        };
      },
    },
  };
  return {
    phases,
    uploads,
    objects,
    get state() {
      return state;
    },
    get fetched() {
      return fetched;
    },
    run: () =>
      capturePhoneRecordingVersion({
        db,
        scope,
        definition,
        fetchAudio: async () => {
          fetched++;
          if (options.audioError) return { ok: false, code: options.audioError };
          return { ok: true, bytes: new Uint8Array(options.empty ? [] : [1, 2, 3]) };
        },
      }),
  };
}
test("immutable version upload is read back and hashed before the single atomic publication", async () => {
  const f = fixture();
  const r = await f.run();
  assert.equal(r.ok, true);
  assert.equal(f.fetched, 1);
  assert.deepEqual(
    f.phases.map((p) => p.p_phase),
    ["claim", "prepare", "complete"],
  );
  assert.equal(f.uploads.length, 1);
  assert.notEqual(f.uploads[0].path, "retained-original.wav");
  assert.equal(await f.objects.get("retained-original.wav")!.text(), "old audio");
  assert.equal(
    f.phases[1].p_data.sha256,
    "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
  );
});
test("held, foreign, rejected or replayed claims perform no provider/storage work", async () => {
  for (const options of [
    { refuse: "claim", error: "phone_recording_processing_held" },
    { refuse: "claim" },
    { foreign: true },
    { replayed: true },
  ]) {
    const f = fixture(options);
    const r = await f.run();
    assert.equal(r.ok, false);
    assert.equal(f.fetched, 0);
    assert.equal(f.uploads.length, 0);
    assert.ok(!JSON.stringify(r).includes("PRIVATE"));
  }
});
test("source/pause/unknown preparation refusal stops before uploading", async () => {
  for (const error of ["phone_attempt_source_changed", "learn_capture_paused", "PRIVATE_DETAIL"]) {
    const f = fixture({ refuse: "prepare", error });
    assert.equal((await f.run()).ok, false);
    assert.equal(f.fetched, 1);
    assert.equal(f.uploads.length, 0);
    assert.ok(!f.phases.some((p) => p.p_phase === "complete"));
  }
});
test("uncertain upload acknowledgement recovers by exact readback without a second upload", async () => {
  const f = fixture({ uploadThrows: true });
  assert.equal((await f.run()).ok, true);
  assert.equal(f.uploads.length, 1);
  assert.equal(f.fetched, 1);
});
test("missing or corrupt stored audio keeps a review hold and does not publish the pointer", async () => {
  for (const options of [{ uploadMissing: true }, { corrupt: true }]) {
    const f = fixture(options);
    const r = await f.run();
    assert.equal(r.ok, false);
    assert.equal(f.state, "needs_review");
    assert.ok(!f.phases.some((p) => p.p_phase === "complete"));
    assert.equal(await f.objects.get("retained-original.wav")!.text(), "old audio");
  }
});
test("lost atomic completion response replays only the exact completion receipt", async () => {
  const f = fixture({ lostCompletion: true });
  assert.equal((await f.run()).ok, true);
  assert.deepEqual(
    f.phases.map((p) => p.p_phase),
    ["claim", "prepare", "complete", "complete"],
  );
  assert.equal(f.fetched, 1);
  assert.equal(f.uploads.length, 1);
  assert.deepEqual(f.phases[2].p_data, f.phases[3].p_data);
});
test("pre-upload provider failures release only the known no-upload attempt, with redacted diagnostics", async () => {
  for (const options of [
    { audioError: "provider_rate_limited" },
    { audioError: "PRIVATE_PROVIDER_DETAIL" },
    { empty: true },
  ]) {
    const f = fixture(options);
    const r = await f.run();
    assert.equal(r.ok, false);
    assert.equal(f.state, "failed");
    assert.equal(f.uploads.length, 0);
    assert.ok(!JSON.stringify(r).includes("PRIVATE"));
  }
});

test("reconciliation refuses missing, corrupt, foreign or unprepared evidence and never starts external work", async () => {
  const output = {
    storagePath: `${scope.tenantId}/simwood/recordings/versions/${scope.recordingId}/${scope.runId}.wav`,
    bytes: 3,
    sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
  };
  for (const issue of [
    "none",
    "missing",
    "corrupt",
    "foreign",
    "running",
    "arbitrary_path",
    "pause",
    "unknown_reply",
  ]) {
    const phases: string[] = [];
    let reads = 0;
    const db: any = {
      rpc: async (_name: string, a: any) => {
        phases.push(a.p_phase);
        if (a.p_phase === "complete" && ["pause", "unknown_reply"].includes(issue))
          return {
            error: { message: issue === "pause" ? "learn_capture_paused" : "PRIVATE_DETAIL" },
          };
        return {
          error: null,
          data: {
            version: "learn-phone-download-attempt/1",
            ...scope,
            ...(issue === "foreign" ? { tenantId: id(99) } : {}),
            state:
              a.p_phase === "complete"
                ? "succeeded"
                : issue === "running"
                  ? "running"
                  : "needs_review",
            prepared: {
              ...output,
              ...(issue === "arbitrary_path" ? { storagePath: "other-tenant.wav" } : {}),
            },
          },
        };
      },
      storage: {
        from: () => ({
          download: async (path: string) => {
            reads++;
            assert.equal(path, output.storagePath);
            return {
              data:
                issue === "missing"
                  ? null
                  : new Blob([issue === "corrupt" ? "abc" : new Uint8Array([1, 2, 3])]),
              error: null,
            };
          },
        }),
      },
    };
    const result = await reconcilePhoneRecordingVersion(db, scope);
    assert.equal(result.ok, issue === "none");
    if (["foreign", "running", "arbitrary_path"].includes(issue)) assert.equal(reads, 0);
    if (["missing", "corrupt", "foreign", "running", "arbitrary_path"].includes(issue))
      assert.deepEqual(phases, ["inspect"]);
    assert.ok(!JSON.stringify(result).includes("PRIVATE"));
  }
});
