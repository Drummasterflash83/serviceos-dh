import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { dkimSign } = require("./voicemail-auth/node_modules/mailauth/lib/dkim/sign.js");
const raw =
  "From: synthetic@birchills.net\r\nTo: synthetic@example.invalid\r\nSubject: Synthetic test\r\nDate: Sun, 11 Oct 2026 12:00:00 +0000\r\nMessage-ID: <synthetic@example.invalid>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain\r\n\r\nSynthetic body\r\n";
function probe(input) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [new URL("./learn-voicemail-dkim-probe.mjs", import.meta.url).pathname],
      { input, env: {}, encoding: "utf8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] },
    ),
  );
}
test("unsigned message cannot gain trust from a forged authentication-results header", () => {
  const result = probe("Authentication-Results: mx.google.com; dkim=pass\r\n" + raw);
  assert.equal(result.original.contentSignatureVerified, false);
  assert.equal(result.dnsQueries, 0);
  assert.ok(Object.values(result.negativeChecks).every(Boolean));
});
test("real signed-header result shape is handled and unknown signer performs no DNS", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const signed = await dkimSign(raw, {
    strict: true,
    signatureData: [
      {
        signingDomain: "example.invalid",
        selector: "synthetic",
        privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
      },
    ],
  });
  assert.equal(signed.errors.length, 0);
  const result = probe(signed.signatures + raw);
  assert.equal(result.original.contentSignatureVerified, false);
  assert.equal(result.dnsQueries, 0);
  assert.ok(result.refusedQueries >= 1 && result.refusedQueries <= 4);
  assert.ok(Object.values(result.negativeChecks).every(Boolean));
});
