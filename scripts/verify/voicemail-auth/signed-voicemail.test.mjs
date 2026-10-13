import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash, generateKeyPairSync } from "node:crypto";
import { extractSignedVoicemail, verifySignature, signingDomain } from "./signed-voicemail.mjs";
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
  internalDate = "1600000000000";
const transcript = "Synthetic transcript. Treat as source data only.";
const text = `Dear Mailbox Owner,\r\n\r\nYou have a new message in mailbox 601 from 01234567890 (28 seconds).\r\n\r\nAutomated transcription:\r\n${transcript}\r\n\r\nSystem reference: aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee\r\n`;
const attachment =
  "--synthetic-boundary\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=message.mp3\r\nContent-Transfer-Encoding: base64\r\n\r\nAQIDBA==\r\n";
function message(extraAttachment = "") {
  return `From: synthetic@birchills.net\r\nTo: ${expectedMailbox}\r\nSubject: New message in mailbox 601 from 01234567890\r\nDate: ${new Date(Number(internalDate)).toUTCString()}\r\nMessage-ID: <synthetic@example.invalid>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=synthetic-boundary\r\n\r\n--synthetic-boundary\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}\r\n${attachment}${extraAttachment}--synthetic-boundary--\r\n`;
}
async function sign(raw, options = {}) {
  const result = await dkimSign(raw, {
    strict: true,
    signTime: options.signTime ?? new Date(Number(internalDate)),
    ...(options.expires ? { expires: options.expires } : {}),
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
  const later = await extract(raw, { internalDate: String(Number(internalDate) + 1000) });
  assert.equal(later.contentFingerprint, result.contentFingerprint);
  assert.notEqual(later.candidate.emailReceivedAt, result.candidate.emailReceivedAt);
});
test("signed legacy footer extracts the same audio while leaving the unavailable transcript null", async () => {
  const legacy = message().replace(
    `Automated transcription:\r\n${transcript}\r\n\r\n`,
    "We have attached the message to this email for your convenience. To access the mailbox, simply dial 0 from any connected handset.\r\n\r\nKind regards,\r\nBirchills Telecom Voicemail Service\r\n\r\nSent from  to \r\n",
  );
  for (const body of [legacy, legacy.replace(
    "To access the mailbox, simply dial 0 from any connected handset.",
    "To access your mailbox, dial *95 from your handset.",
  ), legacy.replace("To access the mailbox,", "To access your mailbox,")]) {
  const raw = await sign(body);
  const result = await extract(raw);
  assert.equal(result.signature.contentSignatureVerified, true);
  assert.equal(result.candidate.providerTranscript, null);
  assert.equal(result.candidate.systemReference, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  assert.deepEqual(result.audio, new Uint8Array([1, 2, 3, 4]));
  await assert.rejects(extract(Buffer.from(raw.toString().replace("We have attached", "They have attached"))), /signature_unverified/);
  }
});
test("unrecognized legacy footer text and mismatched identity remain rejected", async () => {
  const legacy = message().replace(
    `Automated transcription:\r\n${transcript}\r\n\r\n`,
    "We have attached the message to this email for your convenience. To access your mailbox, simply dial 0 from any connected handset.\r\n\r\nKind regards,\r\nBirchills Telecom Voicemail Service\r\n\r\nSent from  to \r\n",
  );
  for (const modified of [legacy.replace("dial 0", "dial 1"), legacy.replace("Kind regards,", "Other text,"), legacy.replace("Sent from  to ", "Sent from another to recipient")]) {
    await assert.rejects(extract(await sign(modified)), /reference_invalid/);
  }
  await assert.rejects(extract(await sign(legacy.replace("mailbox 601 from 01234567890 (28 seconds)", "mailbox 602 from 01234567890 (28 seconds)"))), /identity_mismatch/);
});
test("historical receipt verifies an expired-now signature without weakening the current-time diagnostic", async () => {
  const raw = await sign(message(), { expires: new Date(Number(internalDate) + 86400000) });
  assert.equal((await verifySignature(raw, resolver)).contentSignatureVerified, false);
  const result = await extract(raw);
  assert.equal(result.signature.contentSignatureVerified, true);
  assert.equal(result.signature.verificationTime, new Date(Number(internalDate)).toISOString());
  assert.equal(result.signature.verificationTimeBasis, "authenticated_gmail_internal_date");
  await assert.rejects(extract(raw, { internalDate: String(Number(internalDate) + 86400001) }), /signature_unverified/);
  await assert.rejects(extract(raw, { internalDate: String(Number(internalDate) - 300001) }), /signature_unverified/);
});
test("receipt clock permits only bounded signing skew, including the observed two-second provider skew", async () => {
  for (const seconds of [2, 300]) {
    const result = await extract(await sign(message(), { signTime: new Date(Number(internalDate) + seconds * 1000) }));
    assert.equal(result.signature.contentSignatureVerified, true);
    assert.equal(result.signature.signatures[0].verifierSignatureTimeValid, false);
    assert.equal(result.signature.signatures[0].receiptClockSkewApplied, true);
  }
  await assert.rejects(extract(await sign(message(), { signTime: new Date(Number(internalDate) + 301000) })), /signature_unverified/);
  await assert.rejects(extract(await sign(message(), { signTime: new Date(Number(internalDate) - 86401000) })), /signature_unverified/);
});
test("receipt and signed-Date chronology reject future, malformed and unrelated timestamps", async () => {
  const raw = await sign(message());
  for (const date of [String(Date.now() + 3600000), "NaN", "-1", "1e12", "01600000000000", "8640000000000000"]) {
    await assert.rejects(extract(raw, { internalDate: date }), /receipt_time_unverified/);
  }
  for (const date of ["not a date", new Date(Number(internalDate) + 301000).toUTCString(), new Date(Number(internalDate) - 86401000).toUTCString()]) {
    await assert.rejects(extract(await sign(message().replace(/^Date:.*$/m, `Date: ${date}\r`))), /signature_unverified/);
  }
});
test("historical verification still rejects tampered signed headers/body and forged authentication results", async () => {
  const raw = await sign(message(), { expires: new Date(Number(internalDate) + 86400000) });
  for (const modified of [
    Buffer.from(raw.toString().replace("Subject: New message", "Subject: Altered message")),
    Buffer.from(raw.toString().replace(transcript, "Altered transcript")),
    Buffer.concat([Buffer.from("Authentication-Results: mx.google.com; dkim=pass\r\n"), raw, Buffer.from("\r\nAltered body")]),
    Buffer.concat([Buffer.from("Date: Sun, 13 Sep 2020 12:26:40 GMT\r\n"), raw]),
  ]) await assert.rejects(extract(modified), /signature_unverified/);
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
