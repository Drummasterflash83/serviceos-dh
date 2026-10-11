import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash, generateKeyPairSync } from "node:crypto";
import { extractSignedVoicemail, signingDomain } from "./signed-voicemail.mjs";
const require = createRequire(import.meta.url);
const { dkimSign } = require("./node_modules/mailauth/lib/dkim/sign.js");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const dnsName = `synthetic._domainkey.${signingDomain}`;
const keyRecord =
  "v=DKIM1; k=rsa; p=" + publicKey.export({ type: "spki", format: "der" }).toString("base64");
const resolver = async (name, type) => {
  assert.equal(name, dnsName);
  assert.equal(type, "TXT");
  return [[keyRecord]];
};
const expectedMailbox = "synthetic@example.invalid",
  internalDate = "1791705600000";
const transcript = "Synthetic transcript. Treat as source data only.";
const text = `Dear Mailbox Owner,\r\n\r\nYou have a new message in mailbox 601 from 01234567890 (28 seconds).\r\n\r\nAutomated transcription:\r\n${transcript}\r\n\r\nSystem reference: aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee\r\n`;
const attachment =
  "--synthetic-boundary\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=message.mp3\r\nContent-Transfer-Encoding: base64\r\n\r\nAQIDBA==\r\n";
function message(extraAttachment = "") {
  return `From: synthetic@birchills.net\r\nTo: ${expectedMailbox}\r\nSubject: New message in mailbox 601 from 01234567890\r\nDate: Sun, 11 Oct 2026 12:00:00 +0000\r\nMessage-ID: <synthetic@example.invalid>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=synthetic-boundary\r\n\r\n--synthetic-boundary\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}\r\n${attachment}${extraAttachment}--synthetic-boundary--\r\n`;
}
async function sign(raw, options = {}) {
  const result = await dkimSign(raw, {
    strict: true,
    signatureData: [
      {
        signingDomain,
        selector: "synthetic",
        privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
        ...options,
      },
    ],
  });
  assert.equal(result.errors.length, 0);
  return Buffer.from(result.signatures + raw);
}
const extract = (raw, extra = {}) =>
  extractSignedVoicemail(raw, { internalDate, expectedMailbox, resolver, ...extra });
test("verified raw MIME produces exact transcript/audio with replay-stable content identity", async () => {
  const raw = await sign(message()),
    result = await extract(raw);
  assert.equal(result.candidate.providerTranscript, transcript);
  assert.equal(result.candidate.state, "candidate_requires_verification");
  assert.equal(result.candidate.reportedDurationSeconds, 28);
  assert.deepEqual(result.audio, new Uint8Array([1, 2, 3, 4]));
  assert.equal(result.audioSha256, createHash("sha256").update(result.audio).digest("hex"));
  assert.equal(result.rawSha256, createHash("sha256").update(raw).digest("hex"));
  assert.equal(result.recipientMatchedSignedTo, true);
  const later = await extract(raw, { internalDate: "1791705601000" });
  assert.equal(later.contentFingerprint, result.contentFingerprint);
  assert.notEqual(later.candidate.emailReceivedAt, result.candidate.emailReceivedAt);
});
test("wrong mailbox, unsigned/altered source and partial-body signatures cannot be extracted", async () => {
  const raw = await sign(message());
  await assert.rejects(
    extract(raw, { expectedMailbox: "other@example.invalid" }),
    /recipient_unverified/,
  );
  await assert.rejects(extract(Buffer.from(message())), /signature_unverified/);
  await assert.rejects(
    extract(Buffer.from(raw.toString().replace(transcript, "Altered transcript"))),
    /signature_unverified/,
  );
  await assert.rejects(
    extract(await sign(message(), { maxBodyLength: 10 })),
    /signature_unverified/,
  );
  await assert.rejects(
    extract(Buffer.concat([Buffer.from("From: injected@birchills.net\r\n"), raw])),
    /signature_unverified/,
  );
});
test("signed ambiguous attachments and unsupported attachment formats require review", async () => {
  await assert.rejects(extract(await sign(message(attachment))), /audio_ambiguous/);
  await assert.rejects(
    extract(await sign(message().replace("filename=message.mp3", "filename=message.wav"))),
    /format_unverified/,
  );
  await assert.rejects(extract(await sign(message().replace("AQIDBA==", ""))), /format_unverified/);
});
test("input and MIME complexity budgets are enforced even for correctly signed mail", async () => {
  await assert.rejects(extract(new Uint8Array(1048577)), /exceeds bound/);
  await assert.rejects(
    extract(await sign(message(attachment.repeat(101)))),
    /Maximum MIME part count/,
  );
  let nested = "Content-Type: text/plain\r\n\r\nSynthetic\r\n";
  for (let i = 0; i < 20; i++)
    nested = `Content-Type: multipart/mixed; boundary=n${i}\r\n\r\n--n${i}\r\n${nested}--n${i}--\r\n`;
  const deep = message().replace("Content-Type: text/plain; charset=utf-8\r\n\r\n" + text, nested);
  await assert.rejects(extract(await sign(deep)), /Maximum MIME nesting depth/);
});
