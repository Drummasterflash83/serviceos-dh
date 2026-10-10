import test from "node:test";
import assert from "node:assert/strict";
import { secretMetadata, exactRuntimeRefresh } from "./learn-test-commusoft-key.mjs";
test("CLI metadata parser accepts only name/digest inventory without secret material", () => {
  const digest = "a".repeat(64),
    row = { name: "LEARN_COMMUSOFT_WORKER_KEY", digest };
  assert.deepEqual(secretMetadata(JSON.stringify([row])), [row]);
  assert.deepEqual(
    secretMetadata(`NAME | DIGEST\n-----|------\nLEARN_COMMUSOFT_WORKER_KEY | ${digest}\n`),
    [row],
  );
  for (const bad of [
    "unexpected",
    "{}",
    '[{"name":"KEY","value":"plaintext"}]',
    "NAME | DIGEST\nKEY | secret",
  ])
    assert.throws(() => secretMetadata(bad));
});
test("runtime refresh permits only one version increment per exact existing endpoint", () => {
  const before = [
    {
      id: "one",
      slug: "existing",
      version: 3,
      status: "ACTIVE",
      verify_jwt: true,
      ezbr_sha256: "source",
      entrypoint_path: "source/index.ts",
    },
  ];
  const after = [{ ...before[0], version: 4 }];
  assert.equal(exactRuntimeRefresh(before, after), true);
  for (const changed of [
    [{ ...after[0], version: 5 }],
    [{ ...after[0], ezbr_sha256: "other" }],
    [{ ...after[0], verify_jwt: false }],
    [{ ...after[0], updated_at: 1 }],
    [...after, after[0]],
    [],
  ])
    assert.equal(exactRuntimeRefresh(before, changed), false);
  assert.equal(exactRuntimeRefresh(before, before), false);
});
