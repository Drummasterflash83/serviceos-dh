/** Parse the observed Birchills notification format, never authenticate it.
 * Callers must separately verify transport/sender, mailbox authority and audio.
 * Email text and the supplied provider transcript remain untrusted source data.
 */
export class VoicemailEmailError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "VoicemailEmailError";
  }
}
function fail(code: string): never {
  throw new VoicemailEmailError(code);
}
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const phone = /^(?:\+?[0-9]{3,20}|anonymous|unknown|withheld)$/i;
export type VoicemailEmailCandidate = {
  version: "birchills-voicemail-email/1";
  state: "candidate_requires_verification";
  extension: string;
  systemReference: string;
  callerNumber: string | null;
  callerName: string | null;
  reportedDurationSeconds: number;
  providerTranscript: string | null;
  /** Receipt of the email, not an asserted time the caller left the message. */
  emailReceivedAt: string;
  timestampBasis: "gmail_internal_date";
};
export function parseBirchillsVoicemailEmail(input: {
  subject: unknown;
  text: unknown;
  internalDate: unknown;
}): VoicemailEmailCandidate {
  const { subject, text, internalDate } = input;
  if (
    typeof subject !== "string" ||
    subject.length > 500 ||
    typeof text !== "string" ||
    text.length > 100000 ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(subject + text)
  )
    fail("notification_size_or_encoding");
  if (typeof internalDate !== "string" || !/^\d{1,15}$/.test(internalDate))
    fail("email_time_invalid");
  const millis = Number(internalDate);
  if (!Number.isSafeInteger(millis) || millis < 0 || millis > 8640000000000000)
    fail("email_time_invalid");
  const body = text.replace(/\r\n/g, "\n");
  if (body.includes("\r")) fail("notification_encoding");
  const title = /^New message in mailbox ([0-9]{3}) from (.+)$/.exec(subject);
  if (!title || !phone.test(title[2])) fail("notification_subject_changed");
  const intro =
    /^Dear Mailbox Owner,\n[ \t\n]*You have a new message in mailbox ([0-9]{3}) from (?:'([^'\n]{1,200})' )?([^\n]+) \(([0-9]{1,5}) seconds\)\.\n/.exec(
      body,
    );
  if (
    !intro ||
    !phone.test(intro[3]) ||
    intro[1] !== title[1] ||
    intro[3].toLowerCase() !== title[2].toLowerCase()
  )
    fail("notification_identity_mismatch");
  const rest = body.slice(intro[0].length);
  const transcriptionMarkers = (rest.match(/Automated transcription:/g) ?? []).length;
  if (
    transcriptionMarkers > 1 ||
    (rest.match(/System reference:/g) ?? []).length !== 1
  )
    fail("notification_sections_ambiguous");
  const transcribed =
    /^[ \t\n]*Automated transcription:[ \t]*\n([\s\S]*?)\n[ \t]*System reference:[ \t]*([^\n]+)[ \t\n]*$/.exec(
      rest,
    );
  // Observed signed legacy notifications omit transcription entirely and use
  // this fixed footer. Do not accept arbitrary text as an absent transcript or
  // use the footer's empty "Sent from / to" placeholders for routing.
  const untranscribed = transcriptionMarkers === 0
    ? /^[ \t\n]*We have attached the message to this email for your convenience\. (?:To access the mailbox, simply dial 0 from any connected handset\.|To access your mailbox, dial \*95 from your handset\.)\n\nKind regards,\nBirchills Telecom Voicemail Service\n\nSent from  to \nSystem reference:[ \t]*([^\n]+)[ \t\n]*$/.exec(rest)
    : null;
  const reference = transcribed?.[2] ?? untranscribed?.[1];
  if (!reference || !uuid.test(reference.trim())) fail("notification_reference_invalid");
  const duration = Number(intro[4]),
    transcript = transcribed?.[1].trim() ?? "";
  if (duration > 7200 || transcript.length > 50000) fail("notification_content_limit");
  return {
    version: "birchills-voicemail-email/1",
    state: "candidate_requires_verification",
    extension: title[1],
    systemReference: reference.trim().toLowerCase(),
    callerNumber: /^[+0-9]/.test(title[2]) ? title[2] : null,
    callerName: intro[2]?.trim() || null,
    reportedDurationSeconds: duration,
    providerTranscript: transcript || null,
    emailReceivedAt: new Date(millis).toISOString(),
    timestampBasis: "gmail_internal_date",
  };
}
export type VoicemailAudioPart = {
  partId: string;
  attachmentId: string;
  declaredBytes: number;
  declaredMime: string;
};
/** Metadata selection only. MIME/filename is not proof of valid, safe audio bytes. */
export function selectVoicemailAudioPart(payload: unknown): VoicemailAudioPart {
  let nodes = 0;
  const candidates: VoicemailAudioPart[] = [];
  const seen = new Set<string>();
  const walk = (value: unknown, depth: number) => {
    if (++nodes > 100 || depth > 8 || !value || typeof value !== "object" || Array.isArray(value))
      fail("notification_mime_invalid");
    const p = value as Record<string, any>;
    if (
      typeof p.mimeType !== "string" ||
      typeof p.filename !== "string" ||
      (p.parts !== undefined && !Array.isArray(p.parts))
    )
      fail("notification_mime_invalid");
    const looksAudio =
      /^audio\//i.test(p.mimeType) ||
      /\.(mp3|wav|wave|ogg|oga|m4a|gsm|aac|amr|flac)$/i.test(p.filename);
    if (looksAudio) {
      if (
        !/\.mp3$/i.test(p.filename) ||
        !["audio/mpeg", "audio/mp3", "application/octet-stream"].includes(p.mimeType.toLowerCase())
      )
        fail("notification_audio_format_unverified");
      if (
        typeof p.partId !== "string" ||
        !/^\d+(?:\.\d+)*$/.test(p.partId) ||
        typeof p.body?.attachmentId !== "string" ||
        !/^[-_a-zA-Z0-9]{1,4096}$/.test(p.body.attachmentId) ||
        !Number.isSafeInteger(p.body.size) ||
        p.body.size <= 0 ||
        p.body.size > 25 * 1024 * 1024 ||
        p.body.data
      )
        fail("notification_audio_metadata_invalid");
      if (seen.has(p.body.attachmentId)) fail("notification_audio_ambiguous");
      seen.add(p.body.attachmentId);
      candidates.push({
        partId: p.partId,
        attachmentId: p.body.attachmentId,
        declaredBytes: p.body.size,
        declaredMime: p.mimeType.toLowerCase(),
      });
    } else if (p.filename) fail("notification_unexpected_attachment");
    for (const child of p.parts ?? []) walk(child, depth + 1);
  };
  walk(payload, 0);
  if (candidates.length !== 1) fail("notification_audio_ambiguous");
  return candidates[0];
}
/** Canonical content for duplicate/conflict checks. Deliberately excludes recipient
 * and email receipt time, which can differ between copies of one notification.
 * The caller must still include tenant + verified mailbox in the storage key.
 */
export async function voicemailCandidateFingerprint(
  candidate: VoicemailEmailCandidate,
  audioSha256: string,
): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(audioSha256)) fail("audio_digest_invalid");
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      version: candidate.version,
      extension: candidate.extension,
      systemReference: candidate.systemReference,
      callerNumber: candidate.callerNumber,
      callerName: candidate.callerName,
      duration: candidate.reportedDurationSeconds,
      transcript: candidate.providerTranscript,
      audioSha256,
    }),
  );
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
}
