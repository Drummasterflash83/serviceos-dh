import test from "node:test";
import assert from "node:assert/strict";
import { voicemailTranscriptDisplay } from "./voicemail-transcript.ts";
const footer = "We have attached the message to this email for your convenience. To access your mailbox, simply dial 0 from any connected handset.\n\nKind regards,\nBirchills Telecom Voicemail Service\n\nSent from  to";
test("display removes only a complete trailing known provider footer and keeps speech exact", () => {
  for (const variant of [footer, footer.replace("your mailbox", "the mailbox"), footer.replace("To access your mailbox, simply dial 0 from any connected handset.", "To access your mailbox, dial *95 from your handset.")]) {
    const speech = "Please call back.\nThe boiler is still cold.";
    const original = speech + "\n\n" + variant;
    assert.deepEqual(voicemailTranscriptDisplay(original), { text: speech, providerFooterHidden: true });
    assert.equal(original, speech + "\n\n" + variant);
  }
});
test("unknown, partial, embedded and footer-only text is preserved", () => {
  for (const original of [footer, "\n" + footer, "Spoken message\nWe have attached the message", "Spoken message\n" + footer + "\nMore speech", "Spoken message\n" + footer.replace("dial 0", "dial 1"), "Spoken message\n" + footer.replace("Sent from  to", "Sent from caller to client")]) {
    assert.deepEqual(voicemailTranscriptDisplay(original), { text: original, providerFooterHidden: false });
  }
  assert.deepEqual(voicemailTranscriptDisplay(null), { text: null, providerFooterHidden: false });
});
