import { test } from "node:test";
import assert from "node:assert/strict";
import {
  voicemailRuntimeDependencies,
  inspectVoicemailRuntimes,
} from "./voicemail-runtime-monitor.mjs";
const row = (slug, n = 1) => ({
  slug,
  id: slug,
  version: n,
  ezbr_sha256: "a".repeat(64),
  verify_jwt: false,
  status: "ACTIVE",
  entrypoint_path: `file:///work/${slug}.ts`,
});
const baseline = () => [
  ...voicemailRuntimeDependencies.map((n) => row(n)),
  row("receptionist-calls"),
  row("receptionist-practice"),
  row("learn-slack-worker"),
];
test("independent Emma changes are recorded while the complete voicemail closure remains pinned", () => {
  const a = baseline(),
    b = structuredClone(a);
  for (const n of ["receptionist-calls", "receptionist-practice"]) {
    const x = b.find((x) => x.slug === n);
    x.version++;
    x.ezbr_sha256 = "b".repeat(64);
  }
  const r = inspectVoicemailRuntimes(a, b);
  assert.equal(r.verifiedDependencies, 10);
  assert.deepEqual(
    r.unrelated.map((x) => x.name),
    ["receptionist-calls", "receptionist-practice"],
  );
  assert.equal(r.unrelated[0].afterVersion, 2);
});
test("every relevant bundle, auth flag, entrypoint and missing dependency requires pause", () => {
  for (const name of voicemailRuntimeDependencies)
    for (const field of [
      "version",
      "ezbr_sha256",
      "verify_jwt",
      "entrypoint_path",
      "status",
      "missing",
    ]) {
      const a = baseline(),
        b = structuredClone(a),
        i = b.findIndex((x) => x.slug === name);
      if (field === "missing") b.splice(i, 1);
      else b[i][field] = field === "version" ? 2 : field === "verify_jwt" ? true : "changed";
      assert.throws(() => inspectVoicemailRuntimes(a, b), {
        message: "voicemail_dependency_runtime_changed",
      });
    }
});
test("unrelated addition/removal is retained as drift; duplicate metadata fails closed", () => {
  const a = baseline(),
    b = baseline().filter((x) => x.slug !== "receptionist-practice");
  b.push(row("other-service"));
  assert.equal(inspectVoicemailRuntimes(a, b).unrelated.length, 2);
  assert.throws(() => inspectVoicemailRuntimes(a, [...a, a[0]]), {
    message: "runtime_metadata_unverified",
  });
  assert.throws(
    () =>
      inspectVoicemailRuntimes(
        a.filter((x) => x.slug !== "platform-worker"),
        b,
      ),
    { message: "voicemail_dependency_runtime_changed" },
  );
});
