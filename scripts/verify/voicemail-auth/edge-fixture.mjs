// Generates synthetic mail. The ephemeral signing key never leaves this process.
import { generateKeyPairSync, createHash } from "node:crypto";
import { Mp3Encoder } from "@breezystack/lamejs";
import { decodeVoicemailAudio } from "./decode-audio.mjs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { dkimSign } = require("mailauth/lib/dkim/sign.js");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const signingDomain = "birchills-net.20251104.gappssmtp.com";
const encoder = new Mp3Encoder(1, 8000, 16);
const chunks = [];
for (let frame = 0; frame < 8000 * 28; frame += 1152) {
  const pcm = new Int16Array(Math.min(1152, 8000 * 28 - frame));
  for (let i = 0; i < pcm.length; i++)
    pcm[i] = Math.round(4000 * Math.sin((2 * Math.PI * 440 * (frame + i)) / 8000));
  chunks.push(Buffer.from(encoder.encodeBuffer(pcm)));
}
chunks.push(Buffer.from(encoder.flush()));
const audio = Buffer.concat(chunks);
const decoded = await decodeVoicemailAudio(audio);
if (decoded.sampleRate !== 8000 || decoded.durationSeconds < 28 || decoded.durationSeconds > 29)
  throw Error("Synthetic MP3 duration invalid");
const message = [
  "From: synthetic@birchills.net",
  "To: synthetic@example.invalid",
  "Subject: New message in mailbox 601 from 01234567890",
  "Date: Sun, 11 Oct 2026 12:00:00 +0000",
  "Message-ID: <synthetic@example.invalid>",
  "MIME-Version: 1.0",
  "Content-Type: multipart/mixed; boundary=synthetic",
  "",
  "--synthetic",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Dear Mailbox Owner,",
  "",
  "You have a new message in mailbox 601 from 01234567890 (28 seconds).",
  "",
  "Automated transcription:",
  "Synthetic voicemail runtime check.",
  "",
  "System reference: aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  "",
  "--synthetic",
  "Content-Type: application/octet-stream",
  "Content-Disposition: attachment; filename=message.mp3",
  "Content-Transfer-Encoding: base64",
  "",
  audio.toString("base64"),
  "--synthetic--",
  "",
].join("\r\n");
const signed = await dkimSign(message, {
  strict: true,
  signatureData: [
    {
      signingDomain,
      selector: "synthetic",
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
    },
  ],
});
if (signed.errors.length) throw Error("Synthetic signing failed");
process.stdout.write(
  JSON.stringify({
    raw: signed.signatures + message,
    dnsName: `synthetic._domainkey.${signingDomain}`,
    keyRecord:
      "v=DKIM1; k=rsa; p=" + publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    audioBytes: audio.length,
    audioSha256: createHash("sha256").update(audio).digest("hex"),
    decoded,
  }),
);
