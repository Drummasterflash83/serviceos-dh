/** One bounded in-memory original message; stdout contains only sanitized evidence. */
import { extractSignedVoicemail } from "./voicemail-auth/signed-voicemail.mjs";
import { providerKeyResolver } from "./voicemail-auth/provider-dkim-resolver.mjs";
import { decodeVoicemailAudio } from "./voicemail-auth/decode-audio.mjs";
const decode = process.argv.slice(2).join(" ") === "--decode";
if (process.argv.length > 2 && !decode) throw Error("Unknown probe mode");
const chunks = [];
let size = 0;
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > 1500000) throw Error("Input exceeds bound");
  chunks.push(chunk);
}
const input = JSON.parse(Buffer.concat(chunks).toString());
if (
  typeof input.rawBase64 !== "string" ||
  !/^[a-zA-Z0-9_-]+={0,2}$/.test(input.rawBase64) ||
  !/^[a-f0-9]{64}$/.test(input.expectedAudioSha256) ||
  !Number.isInteger(input.expectedAudioBytes)
)
  throw Error("Bounded source and prior audio evidence required");
const raw = Buffer.from(input.rawBase64, "base64url");
input.rawBase64 = null;
const { resolve, stats } = providerKeyResolver();
let source;
try {
  source = await extractSignedVoicemail(raw, {
    internalDate: input.internalDate,
    expectedMailbox: input.expectedMailbox,
    resolver: resolve,
  });
  if (
    source.audioSha256 !== input.expectedAudioSha256 ||
    source.audio.length !== input.expectedAudioBytes
  )
    throw Error("Extracted audio differs from previously decoded sample");
  const portableDecode = decode ? await decodeVoicemailAudio(source.audio) : undefined;
  if (
    portableDecode &&
    Math.abs(portableDecode.durationSeconds - source.candidate.reportedDurationSeconds) > 2
  )
    throw Error("Decoded duration differs");
  process.stdout.write(
    JSON.stringify({
      state: source.state,
      signature: source.signature,
      recipientMatchedSignedTo: true,
      extractedAudioBytes: source.audio.length,
      extractedAudioSha256: source.audioSha256,
      matchesPreviouslyDecodedAudio: true,
      rawSha256: source.rawSha256,
      sourceContentFingerprint: source.contentFingerprint,
      parserVersion: source.candidate.version,
      reportedDurationSeconds: source.candidate.reportedDurationSeconds,
      transcriptPresent: source.candidate.providerTranscript !== null,
      timestampBasis: source.candidate.timestampBasis,
      contentBasis: "signature_verified_raw_mime_not_retained_email_copy",
      ...(portableDecode ? { portableDecode } : {}),
      rawPersisted: false,
      audioPersisted: false,
      ...stats,
      limitations: [
        "No mailbox-owner or provider-account association is established by a signed To match.",
        "One observed sample; not historical coverage or a deployed importer.",
        decode
          ? "Portable in-memory decode checked; no playback or transcription performed."
          : "Audio identity matches the earlier full local decode; no new playback or transcription performed.",
      ],
    }),
  );
} finally {
  raw.fill(0);
  source?.audio.fill(0);
}
