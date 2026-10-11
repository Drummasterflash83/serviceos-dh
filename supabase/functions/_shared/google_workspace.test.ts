import test from "node:test";
import assert from "node:assert/strict";
import { classifyDelegationError, getDelegatedToken, DelegationError } from "./google_workspace.ts";
import { isRetryable } from "./platform_queue.ts";

test("ambiguous service-account invalid_grant requires review without blaming the mailbox", () => {
  assert.deepEqual(classifyDelegationError("invalid_grant", 400), {
    code: "delegation_grant_invalid",
    permanent: true,
  });
  assert.equal(isRetryable("delegation_grant_invalid"), false);
  assert.equal(
    classifyDelegationError("unauthorized_client", 400).code,
    "admin_delegation_missing",
  );
  assert.equal(classifyDelegationError("invalid_scope", 400).code, "scopes_missing");
  assert.deepEqual(classifyDelegationError("unavailable", 503), {
    code: "provider_temporary",
    permanent: false,
  });
});

test("actual token exchange retains safe classification and never exposes provider description", async () => {
  const keys = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const der = await crypto.subtle.exportKey("pkcs8", keys.privateKey);
  const privateKey =
    "-----BEGIN PRIVATE KEY-----\n" +
    Buffer.from(der).toString("base64") +
    "\n-----END PRIVATE KEY-----";
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, "https://oauth2.googleapis.com/token");
    assert.equal(options?.redirect, "error");
    return Response.json(
      {
        error: "invalid_grant",
        error_description: "PRIVATE provider details and mailbox identity",
      },
      { status: 400 },
    );
  };
  try {
    await assert.rejects(
      getDelegatedToken({
        clientEmail: "synthetic@example.invalid",
        privateKey,
        subject: "mailbox@example.invalid",
        domain: "example.invalid",
      }),
      (e) => {
        assert.ok(e instanceof DelegationError);
        assert.equal(e.code, "delegation_grant_invalid");
        assert.equal(e.permanent, true);
        assert.ok(!e.message.includes("PRIVATE"));
        assert.ok(!e.message.includes("mailbox@example.invalid"));
        return true;
      },
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previous;
  }
});
