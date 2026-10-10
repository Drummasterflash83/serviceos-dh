import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { bindEmailInternalKey, INTERNAL_KEY_NAME } from "./learn-test-email-runtime-key.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
import { EMAIL_RUNTIME_DATABASE } from "./learn-test-email-runtime-deploy.mjs";
const token = "sbp_" + "0".repeat(40),
  key =
    "header." +
    Buffer.from(JSON.stringify({ ref: TEST_PROJECT, role: "service_role" })).toString("base64url") +
    ".synthetic",
  digest = createHash("sha256").update(key).digest("hex");
function fixture(existing = false) {
  let written = false,
    journal,
    calls = 0;
  return {
    get calls() {
      return calls;
    },
    persistJournal: async (j) => {
      journal = j;
    },
    fetcher: async (url) => {
      if (String(url).endsWith("/read-only"))
        return Response.json([{ catalog: { functions: [] }, fingerprint: EMAIL_RUNTIME_DATABASE }]);
      if (String(url).endsWith("/functions"))
        return Response.json([
          {
            id: "worker",
            slug: "worker",
            version: written ? 2 : 1,
            status: "ACTIVE",
            verify_jwt: true,
            ezbr_sha256: "source",
          },
        ]);
      if (String(url).endsWith("/secrets"))
        return Response.json(
          written
            ? [{ name: INTERNAL_KEY_NAME, digest }]
            : existing
              ? [{ name: INTERNAL_KEY_NAME, digest: "1".repeat(64) }]
              : [],
        );
      if (String(url).endsWith("/api-keys?reveal=true"))
        return Response.json([{ name: "service_role", api_key: key }]);
      throw Error("Unexpected request");
    },
    runCli: (_bin, args, opts) => {
      calls++;
      assert.ok(journal);
      assert.equal(args.join(" ").includes(key), false);
      assert.ok(args.includes("/dev/stdin"));
      assert.equal(opts.input, `${INTERNAL_KEY_NAME}=${key}\n`);
      written = true;
      return { status: 0, stdout: key };
    },
  };
}
test("existing TEST credential is bound through stdin and verified without returning its value", async () => {
  const f = fixture();
  const r = await bindEmailInternalKey({ allowProjectRef: TEST_PROJECT, token, ...f });
  assert.equal(r.state, "binding_verified");
  assert.equal(f.calls, 1);
  assert.doesNotMatch(JSON.stringify(r), new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
test("different preexisting binding and wrong project are rejected without mutation", async () => {
  const f = fixture(true);
  await assert.rejects(
    bindEmailInternalKey({ allowProjectRef: TEST_PROJECT, token, ...f }),
    /binding differs/,
  );
  assert.equal(f.calls, 0);
  await assert.rejects(
    bindEmailInternalKey({ allowProjectRef: "production", token, ...f }),
    /Explicit TEST/,
  );
  assert.equal(f.calls, 0);
});
test("journal failure prevents the credential alias write", async () => {
  const f = fixture();
  await assert.rejects(
    bindEmailInternalKey({
      allowProjectRef: TEST_PROJECT,
      token,
      ...f,
      persistJournal: async () => {
        throw Error("disk full");
      },
    }),
    /disk full/,
  );
  assert.equal(f.calls, 0);
});
