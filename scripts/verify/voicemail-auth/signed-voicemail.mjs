import { createRequire } from "node:module";
import { createSignedVoicemailTools } from "../../../supabase/functions/_shared/voicemail/signed-source.js";
export { signingDomain } from "../../../supabase/functions/_shared/voicemail/signed-source.js";
const require = createRequire(import.meta.url);
if (require("./node_modules/mailauth/package.json").version !== "7.3.0")
  throw Error("Verifier version differs");
const { dkimVerify } = require("mailauth/lib/dkim/verify.js");
const PostalMime = require("postal-mime").default;
export const { verifySignature, extractSignedVoicemail } = createSignedVoicemailTools({
  dkimVerify,
  PostalMime,
});
