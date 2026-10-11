import { MPEGDecoder } from "mpg123-decoder";
import { createVoicemailAudioDecoder } from "../../../supabase/functions/_shared/voicemail/decode-audio.js";
export const decodeVoicemailAudio = createVoicemailAudioDecoder(MPEGDecoder);
