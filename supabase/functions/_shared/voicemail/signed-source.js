import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  parseBirchillsVoicemailEmail,
  voicemailCandidateFingerprint,
} from "../birchills_voicemail_email.ts";
export const signingDomain = "birchills-net.20251104.gappssmtp.com";
/** Dependency injection keeps identical verification rules in Node and Edge. */
export function createSignedVoicemailTools({ dkimVerify, PostalMime }) {
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const required = ["from", "subject", "to", "date", "message-id", "mime-version", "content-type"];
  async function verifySignature(bytes, publicKey) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 1048576)
      throw Error("Message exceeds bound");
    if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
    const boundary = bytes.indexOf("\r\n\r\n");
    if (boundary < 1 || boundary > 65536) throw Error("Header boundary invalid");
    const header = bytes.subarray(0, bytes.indexOf("\r\n\r\n")).toString("latin1");
    const fields = header
      .split("\r\n")
      .filter((l) => /^[^ \t:]+:/.test(l))
      .map((l) => l.slice(0, l.indexOf(":")).toLowerCase());
    if (fields.filter((f) => f === "dkim-signature").length > 8)
      throw Error("Signature budget exceeded");
    const result = await dkimVerify(bytes, {
      strict: true,
      minBitLength: 2048,
      resolver: publicKey,
    });
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
        status: ["pass", "fail", "neutral", "policy", "temperror", "none"].includes(
          r.status?.result,
        )
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
  /** Extract only from the SAME raw bytes whose signature was checked here.
   * The returned candidate still requires provider-account/mailbox ownership binding
   * and audio decoding before durable import. No access or storage is changed.
   */
  async function extractSignedVoicemail(input, { internalDate, expectedMailbox, resolver }) {
    if (!(input instanceof Uint8Array) || input.byteLength > 1048576)
      throw Error("Message exceeds bound");
    if (typeof expectedMailbox !== "string" || !/^[^\s@]+@[^\s@]+$/.test(expectedMailbox))
      throw Error("Expected recipient required");
    const raw = Buffer.from(input);
    try {
      const signature = await verifySignature(raw, resolver);
      if (!signature.contentSignatureVerified) throw Error("notification_signature_unverified");
      const email = await PostalMime.parse(raw, {
        attachmentEncoding: "arraybuffer",
        maxNestingDepth: 16,
        maxHeadersSize: 65536,
        maxPartCount: 100,
        maxRfc822NestingDepth: 0,
        forceRfc822Attachments: true,
      });
      if (
        email.from?.address?.split("@").at(-1)?.toLowerCase() !== "birchills.net" ||
        !Array.isArray(email.to) ||
        email.to.some((a) => a.group !== undefined) ||
        !email.to.some((a) => a.address?.toLowerCase() === expectedMailbox.toLowerCase())
      )
        throw Error("notification_recipient_unverified");
      const candidate = parseBirchillsVoicemailEmail({
        subject: email.subject,
        text: email.text,
        internalDate,
      });
      if (email.attachments?.length !== 1) throw Error("notification_audio_ambiguous");
      const part = email.attachments[0];
      if (
        part.rfc822DepthExceeded ||
        !/\.mp3$/i.test(part.filename ?? "") ||
        !["application/octet-stream", "audio/mpeg", "audio/mp3"].includes(part.mimeType) ||
        !(part.content instanceof ArrayBuffer) ||
        !part.content.byteLength ||
        part.content.byteLength > 26214400
      )
        throw Error("notification_audio_format_unverified");
      const audio = new Uint8Array(part.content),
        audioSha256 = sha256(audio);
      return {
        state: "signed_source_extracted_requires_mailbox_binding_and_audio_validation",
        signature,
        candidate,
        audio,
        audioSha256,
        rawSha256: sha256(raw),
        contentFingerprint: await voicemailCandidateFingerprint(candidate, audioSha256),
        recipientMatchedSignedTo: true,
      };
    } finally {
      raw.fill(0);
    }
  }

  return { verifySignature, extractSignedVoicemail };
}
