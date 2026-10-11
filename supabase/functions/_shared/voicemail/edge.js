/** Server-only Edge adapter. No credential loading, routes or capture activation. */
import verifier from "npm:mailauth@7.3.0/lib/dkim/verify.js";
import PostalMime from "npm:postal-mime@4.0.5";
import { MPEGDecoder } from "npm:mpg123-decoder@1.0.3";
import { createSignedVoicemailTools } from "./signed-source.js";
import { createVoicemailAudioDecoder } from "./decode-audio.js";
import { createPrivateVoicemailImporter } from "./private-import.js";
export const { verifySignature, extractSignedVoicemail } = createSignedVoicemailTools({
  dkimVerify: verifier.dkimVerify,
  PostalMime,
});
export const decodeVoicemailAudio = createVoicemailAudioDecoder(MPEGDecoder);
export const importPrivateVoicemail = createPrivateVoicemailImporter({
  extractSignedVoicemail,
  decodeVoicemailAudio,
});
