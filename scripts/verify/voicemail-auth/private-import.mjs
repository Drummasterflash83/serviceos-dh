import { extractSignedVoicemail } from "./signed-voicemail.mjs";
import { decodeVoicemailAudio } from "./decode-audio.mjs";
import { createPrivateVoicemailImporter } from "../../../supabase/functions/_shared/voicemail/private-import.js";
export const importPrivateVoicemail = createPrivateVoicemailImporter({
  extractSignedVoicemail,
  decodeVoicemailAudio,
});
