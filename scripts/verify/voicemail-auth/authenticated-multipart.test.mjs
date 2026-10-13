import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { generateKeyPairSync } from "node:crypto";
import { Mp3Encoder } from "@breezystack/lamejs";
import { extractSignedVoicemail, verifySignature, signingDomain } from "./signed-voicemail.mjs";
import { decodeVoicemailAudio } from "./decode-audio.mjs";
const require = createRequire(import.meta.url), { dkimSign } = require("./node_modules/mailauth/lib/dkim/sign.js");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const keyRecord = "v=DKIM1; k=rsa; p=" + publicKey.export({ type: "spki", format: "der" }).toString("base64");
const internalDate = "1600000000000", expectedMailbox = "synthetic@example.invalid";
const identity = ["from", "to", "subject", "date", "message-id", "mime-version"];
const resolver = async (name, type) => {
  assert.equal(type, "TXT");
  assert.ok([`synthetic._domainkey.${signingDomain}`, "synthetic._domainkey.birchills-net.20230601.gappssmtp.com"].includes(name));
  return [[keyRecord]];
};
const encoder = new Mp3Encoder(1, 8000, 16), chunks = [];
for (let frame = 0; frame < 24000; frame += 1152) {
  const pcm = new Int16Array(Math.min(1152, 24000 - frame));
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(3000 * Math.sin(2 * Math.PI * 440 * (frame + i) / 8000));
  chunks.push(Buffer.from(encoder.encodeBuffer(pcm)));
}
chunks.push(Buffer.from(encoder.flush()));
const audio = Buffer.concat(chunks);
const text = "Dear Mailbox Owner,\r\n\r\nYou have a new message in mailbox 601 from 01234567890 (3 seconds).\r\n\r\nAutomated transcription:\r\nSynthetic authenticated-body test.\r\n\r\nSystem reference: aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee\r\n";
const part = "--root-boundary\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=message.mp3\r\nContent-Transfer-Encoding: base64\r\n\r\n" + audio.toString("base64") + "\r\n";
const message = () => [
  "From: synthetic@birchills.net", `To: ${expectedMailbox}`, "Subject: New message in mailbox 601 from 01234567890",
  `Date: ${new Date(Number(internalDate)).toUTCString()}`, "Message-ID: <synthetic@example.invalid>", "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="root-boundary"', "", "--root-boundary",
  'Content-Type: multipart/alternative; boundary="text-boundary"', "", "--text-boundary",
  "Content-Type: text/plain; charset=utf-8", "", text, "--text-boundary", "Content-Type: text/html; charset=utf-8", "",
  "<p>Synthetic authenticated-body test.</p>", "--text-boundary--", "", part + "--root-boundary--", "",
].join("\r\n");
async function sign(raw = message(), options = {}) {
  const signed = await dkimSign(raw, { strict: true, signTime: new Date(Number(internalDate)),
    signatureData: [{ signingDomain, selector: "synthetic", privateKey: privateKey.export({ type: "pkcs8", format: "pem" }), headerList: identity, ...options }] });
  assert.equal(signed.errors.length, 0);
  return Buffer.from(signed.signatures + raw);
}
const extract = (raw, extra = {}) => extractSignedVoicemail(raw, { internalDate, expectedMailbox, resolver, ...extra });

test("current-signer complete authenticated body supports the exact legacy MIME and real MP3", async () => {
  const raw = await sign(), result = await extract(raw);
  assert.equal(result.signature.contentSignatureVerified, true);
  assert.equal(result.signature.signedContentTypeVerified, false);
  assert.equal(result.signature.mimeInterpretation, "authenticated_body_boundary");
  assert.equal(result.signature.signatures[0].requiredHeadersSigned, false);
  assert.equal(result.signature.signatures[0].identityHeadersSigned, true);
  assert.deepEqual(Buffer.from(result.audio), audio);
  const decoded = await decodeVoicemailAudio(result.audio);
  assert.ok(Math.abs(decoded.durationSeconds - result.candidate.reportedDurationSeconds) < 1);
  const originalPath = await extract(await sign(message(), { headerList: [...identity, "content-type"] }));
  assert.equal(originalPath.signature.mimeInterpretation, "signed_content_type");
  assert.equal(originalPath.contentFingerprint, result.contentFingerprint);
  assert.equal(originalPath.audioSha256, result.audioSha256);
  assert.equal((await extract(raw)).contentFingerprint, result.contentFingerprint);
});

test("unsigned root MIME manipulation cannot select a different interpretation", async () => {
  const raw = await sign(), source = raw.toString();
  const variants = [
    source.replace('boundary="root-boundary"', 'boundary="text-boundary"'),
    source.replace("Content-Type: multipart/mixed", "Content-Type: text/plain"),
    source.replace('boundary="root-boundary"', 'boundary="root-boundary"; charset=utf-7'),
    "Content-Type: multipart/mixed; boundary=attacker\r\n" + source,
    "Content-Transfer-Encoding: base64\r\n" + source,
    "Content-Disposition: attachment; filename=attacker.mp3\r\n" + source,
    source.replace('Content-Type: multipart/mixed; boundary="root-boundary"\r\n', ""),
  ];
  for (const variant of variants) await assert.rejects(extract(Buffer.from(variant)), /signature_unverified|authenticated_mime_unverified/);
  const unchanged = await extract(Buffer.from("X-Untrusted-Hint: ignore me\r\n" + source));
  assert.deepEqual(Buffer.from(unchanged.audio), audio);
  assert.equal(unchanged.contentFingerprint, (await extract(raw)).contentFingerprint);
});

test("tampered signed identity/body and missing or duplicate identity headers are rejected", async () => {
  const raw = await sign();
  for (const modified of [raw.toString().replace("Synthetic authenticated-body test.", "Attacker text."),
    raw.toString().replace("Subject: New message", "Subject: Other message"),
    raw.toString().replace("To: synthetic@example.invalid", "To: attacker@example.invalid"),
    "To: attacker@example.invalid\r\n" + raw.toString(),
    "From: attacker@birchills.net\r\n" + raw.toString(),
    "MIME-Version: 2.0\r\n" + raw.toString()]) await assert.rejects(extract(Buffer.from(modified)), /signature_unverified/);
  for (const missing of identity.filter(x => x !== "from")) await assert.rejects(extract(await sign(message(), { headerList: identity.filter(x => x !== missing) })), /signature_unverified/);
  await assert.rejects(extract(raw, { expectedMailbox: "other@example.invalid" }), /recipient_unverified/);
  await assert.rejects(extract(Buffer.from("Authentication-Results: mx.google.com; dkim=pass\r\n" + message())), /signature_unverified/);
});

test("older signer, neutral key verification, body truncation and invalid chronology cannot use compatibility", async () => {
  await assert.rejects(extract(await sign(message(), { signingDomain: "birchills-net.20230601.gappssmtp.com" })), /signature_unverified/);
  await assert.rejects(extract(await sign(), { resolver: async () => { throw Object.assign(Error("No synthetic key"), { code: "ENOTFOUND" }); } }), /signature_unverified/);
  for (const length of [10, Buffer.byteLength(message().split("\r\n\r\n").slice(1).join("\r\n\r\n"))])
    await assert.rejects(extract(await sign(message(), { maxBodyLength: length })), /signature_unverified/);
  const raw = await sign();
  await assert.rejects(extract(raw, { internalDate: String(Number(internalDate) - 300001) }), /signature_unverified/);
  await assert.rejects(extract(await sign(message().replace(/^Date:.*$/m, "Date: invalid\r"))), /signature_unverified/);
});

test("even authenticated ambiguous or unsupported root MIME is refused", async () => {
  const variants = [
    message().replace("\r\n\r\n--root-boundary", "\r\n\r\nUnexpected preamble\r\n--root-boundary"),
    message() + "Unexpected epilogue\r\n",
    message().replace("--root-boundary--\r\n", part + "--root-boundary--\r\n"),
    message().replace("--root-boundary--\r\n", ""),
    message().replace("--root-boundary--\r\n", "--root-boundary-suffix\r\n--root-boundary--\r\n"),
    message().replace("Content-Type: application/octet-stream", "Content-Type: audio/mpeg\r\nContent-Type: application/octet-stream"),
    message().replace("Content-Transfer-Encoding: base64", "Content-Transfer-Encoding: binary"),
    message().replace('Content-Type: multipart/alternative; boundary="text-boundary"', "Content-Type: message/rfc822"),
    message().replace("Content-Disposition: attachment", "Content-Disposition: inline"),
    message().replace("Content-Type: application/octet-stream", "Content-Type: message/rfc822"),
  ];
  for (const variant of variants) await assert.rejects(extract(await sign(variant)), /authenticated_mime_unverified/);
});

test("attachment filename/format and signed template identity still use existing checks", async () => {
  await assert.rejects(extract(await sign(message().replace("filename=message.mp3", "filename=message.wav"))), /format_unverified/);
  await assert.rejects(extract(await sign(message().replace("mailbox 601 from 01234567890 (3 seconds)", "mailbox 602 from 01234567890 (3 seconds)"))), /identity_mismatch/);
});
