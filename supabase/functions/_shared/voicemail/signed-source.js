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
  // RFC 6376 §3.5 permits reliable first-receipt time for verification. Only
  // extraction uses the archive path: workspace-import obtains internalDate
  // from authenticated Gmail, checks the actual mailbox/message and matches it
  // to the request; private-import also enforces the approved route's dates.
  // Gmail API imports can set internalDate, so it is provider metadata rather
  // than a universal proof of SMTP delivery. Signed chronology remains bounded.
  // Never derive this clock from an unsigned header or arbitrary caller date.
  const clockSkewMs = 5 * 60 * 1000;
  const maxDeliveryMs = 24 * 60 * 60 * 1000;
  async function verify(bytes, publicKey, receivedMillis = null) {
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
      ...(receivedMillis === null ? {} : { curTime: new Date(receivedMillis) }),
    });
    const uniqueHeaders = required.every((k) => fields.filter((f) => f === k).length === 1);
    const dateHeader = header.replace(/\r\n[ \t]+/g, " ").split("\r\n")
      .filter((line) => /^date:/i.test(line));
    const signedDate = dateHeader.length === 1 ? Date.parse(dateHeader[0].slice(5).trim()) : NaN;
    const fromDomainMatches =
      result.headerFrom?.length === 1 &&
      result.headerFrom[0].split("@").at(-1)?.toLowerCase() === "birchills.net";
    const signatures = result.results.map((r) => {
      // v7.3.0 source returns a colon-separated string, despite the documented array.
      const keys = r.signingHeaders?.keys;
      const signed = (
        Array.isArray(keys) ? keys : typeof keys === "string" ? keys.split(":") : []
      ).map((k) => k.trim().toLowerCase());
      const signTime = typeof r.signTime === "string" ? Date.parse(r.signTime) : NaN;
      const expiration = typeof r.expiresAfter === "string" ? Date.parse(r.expiresAfter) : null;
      // Google's stored receipt can precede the provider signature by seconds.
      // Permit at most five minutes of skew, without extending expiration or
      // accepting signatures/date headers far removed from receipt. Signing,
      // expiry and Date values are authenticated by the signature below;
      // receipt time instead comes from the bound provider response.
      const receiptTimingVerified = receivedMillis !== null &&
        Number.isFinite(signTime) && Number.isFinite(signedDate) &&
        signTime >= receivedMillis - maxDeliveryMs && signTime <= receivedMillis + clockSkewMs &&
        signedDate >= receivedMillis - maxDeliveryMs && signedDate <= receivedMillis + clockSkewMs &&
        Math.abs(signedDate - signTime) <= maxDeliveryMs &&
        (expiration === null || Number.isFinite(expiration) && expiration > signTime && expiration >= receivedMillis);
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
        signatureTimeValid: receivedMillis === null ? r.signatureTimeValid === true : receiptTimingVerified,
        ...(receivedMillis === null ? {} : {
          verifierSignatureTimeValid: r.signatureTimeValid === true,
          receiptClockSkewApplied: receiptTimingVerified && signTime > receivedMillis,
        }),
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
      ...(receivedMillis === null ? {} : {
        verificationTime: new Date(receivedMillis).toISOString(),
        verificationTimeBasis: "authenticated_gmail_internal_date",
        allowedSigningClockSkewSeconds: clockSkewMs / 1000,
      }),
    };
  }
  // Generic diagnostics keep current-time verification; no external clock option.
  async function verifySignature(bytes, publicKey) {
    return verify(bytes, publicKey);
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
    if (typeof internalDate !== "string" || !/^(0|[1-9][0-9]{0,14})$/.test(internalDate) ||
      !Number.isSafeInteger(Number(internalDate)) || Number(internalDate) > Date.now())
      throw Error("notification_receipt_time_unverified");
    const raw = Buffer.from(input);
    try {
      const signature = await verify(raw, resolver, Number(internalDate));
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
