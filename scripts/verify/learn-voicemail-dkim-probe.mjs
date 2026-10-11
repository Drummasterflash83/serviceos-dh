/** Isolated raw-message DKIM diagnostic. No credentials are accepted by this process.
 * Parent supplies one message on stdin. Only an observed provider key domain can
 * be resolved; raw content, addresses and signature values never leave stdout.
 * Install the pinned diagnostic dependency with --ignore-scripts as documented.
 */
import { createRequire } from "node:module";
import { Resolver } from "node:dns/promises";
const require = createRequire(import.meta.url);
const root = "./voicemail-auth/node_modules/mailauth/";
if (require(root + "package.json").version !== "7.3.0") throw Error("Verifier version differs");
const { dkimVerify } = require(root + "lib/dkim/verify.js");
const signingDomain = "birchills-net.20251104.gappssmtp.com";
const resolver = new Resolver({ timeout: 5000, tries: 1 });
const cache = new Map();
let dnsQueries = 0,
  refusedQueries = 0;
async function publicKey(name, type) {
  name = String(name).toLowerCase();
  if (
    type !== "TXT" ||
    !/^[a-z0-9_-]{1,63}\._domainkey\./.test(name) ||
    !name.endsWith("._domainkey." + signingDomain)
  ) {
    refusedQueries++;
    throw Object.assign(Error("Unapproved signing domain"), { code: "ENOTFOUND" });
  }
  if (!cache.has(name)) {
    if (++dnsQueries > 3) throw Error("DNS budget exceeded");
    cache.set(name, resolver.resolveTxt(name));
  }
  return cache.get(name);
}
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
const required = ["from", "subject", "to", "date", "message-id", "mime-version", "content-type"];
async function verify(bytes) {
  const header = bytes.subarray(0, bytes.indexOf("\r\n\r\n")).toString("latin1");
  const fields = header
    .split("\r\n")
    .filter((l) => /^[^ \t:]+:/.test(l))
    .map((l) => l.slice(0, l.indexOf(":")).toLowerCase());
  if (fields.filter((f) => f === "dkim-signature").length > 8)
    throw Error("Signature budget exceeded");
  const result = await dkimVerify(bytes, { strict: true, minBitLength: 2048, resolver: publicKey });
  const uniqueHeaders = required.every((k) => fields.filter((f) => f === k).length === 1);
  const fromDomainMatches =
    result.headerFrom?.length === 1 &&
    result.headerFrom[0].split("@").at(-1)?.toLowerCase() === "birchills.net";
  const signatures = result.results.map((r) => {
    // v7.3.0 source returns a colon-separated string, despite the documented array.
    const keys = r.signingHeaders?.keys;
    const signed = (
      Array.isArray(keys) ? keys : typeof keys === "string" ? keys.split(":") : []
    ).map((k) => k.trim().toLowerCase());
    return {
      expectedSigningDomain: r.signingDomain?.toLowerCase() === signingDomain,
      status: ["pass", "fail", "neutral", "policy", "temperror", "none"].includes(r.status?.result)
        ? r.status.result
        : "unknown",
      rsaSha256: r.algo === "rsa-sha256",
      keyBits: Number.isInteger(r.modulusLength) ? r.modulusLength : null,
      completeBody:
        r.canonBodyLengthLimited === false && r.canonBodyLength === r.canonBodyLengthTotal,
      requiredHeadersSigned: required.every((k) => signed.includes(k)),
      signatureTimeValid: r.signatureTimeValid === true,
    };
  });
  return {
    uniqueRequiredHeaders: uniqueHeaders,
    fromDomainMatches,
    contentSignatureVerified:
      uniqueHeaders &&
      fromDomainMatches &&
      signatures.some(
        (r) =>
          r.expectedSigningDomain &&
          r.status === "pass" &&
          r.rsaSha256 &&
          r.keyBits >= 2048 &&
          r.completeBody &&
          r.requiredHeadersSigned &&
          r.signatureTimeValid,
      ),
    signatures,
  };
}
try {
  const original = await verify(raw);
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
  const tamperedSubject = await verify(changedSubject);
  const tamperedBodyWithForgedPass = await verify(forged);
  const duplicateFromResult = await verify(duplicateFrom);
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
      dnsQueries,
      refusedQueries,
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
