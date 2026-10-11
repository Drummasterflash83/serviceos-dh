/** Isolated raw-message DKIM diagnostic. No credentials are accepted by this process.
 * Parent supplies one message on stdin. Only an observed provider key domain can
 * be resolved; raw content, addresses and signature values never leave stdout.
 * Install the pinned diagnostic dependency with --ignore-scripts as documented.
 */
import { providerKeyResolver } from "./voicemail-auth/provider-dkim-resolver.mjs";
import { verifySignature } from "./voicemail-auth/signed-voicemail.mjs";
const { resolve: publicKey, stats } = providerKeyResolver();
const chunks = [];
let count = 0;
for await (const chunk of process.stdin) {
  count += chunk.length;
  if (count > 1048576) throw Error("Message exceeds bound");
  chunks.push(chunk);
}
const raw = Buffer.concat(chunks);
const split = raw.indexOf("\r\n\r\n");
if (split < 1 || split > 65536) throw Error("Header boundary invalid");

try {
  const original = await verifySignature(raw, publicKey);
  const header = raw.subarray(0, split).toString("latin1"),
    body = raw.subarray(split);
  const changedSubject = Buffer.concat([
    Buffer.from(
      header.replace(
        /^Subject:[^\r\n]*(?:\r\n[ \t][^\r\n]*)*/im,
        "Subject: Synthetic changed subject",
      ),
      "latin1",
    ),
    body,
  ]);
  const forged = Buffer.concat([
    Buffer.from("Authentication-Results: mx.google.com; dkim=pass\r\n"),
    raw,
    Buffer.from("\r\nSynthetic modified body\r\n"),
  ]);
  const duplicateFrom = Buffer.concat([Buffer.from("From: synthetic@example.invalid\r\n"), raw]);
  const tamperedSubject = await verifySignature(changedSubject, publicKey);
  const tamperedBodyWithForgedPass = await verifySignature(forged, publicKey);
  const duplicateFromResult = await verifySignature(duplicateFrom, publicKey);
  process.stdout.write(
    JSON.stringify({
      version: "voicemail-dkim-probe/1",
      verifier: "mailauth@7.3.0",
      strict: true,
      original,
      negativeChecks: {
        changedSubjectRejected: !tamperedSubject.contentSignatureVerified,
        changedBodyWithForgedPassRejected: !tamperedBodyWithForgedPass.contentSignatureVerified,
        duplicateFromRejected: !duplicateFromResult.contentSignatureVerified,
      },
      ...stats,
      rawPersisted: false,
      limitations: [
        "Digital-signature evidence only; no mailbox ownership, provider-account binding, complete history or import is established.",
        "Expected signer is the previously observed provider Google signing domain; its provider-account association must be explicitly configured before automatic import.",
      ],
    }),
  );
} finally {
  raw.fill(0);
}
