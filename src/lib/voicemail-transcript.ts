/** Display-only: immutable provider transcripts and original evidence stay intact. */
export function voicemailTranscriptDisplay(original: string | null) {
  if (original === null) return { text: null, providerFooterHidden: false };
  const normalized = original.replace(/\r\n/g, "\n");
  const footer = /\n[ \t\n]*We have attached the message to this email for your convenience\. (?:To access (?:the|your) mailbox, simply dial 0 from any connected handset\.|To access your mailbox, dial \*95 from your handset\.)\n\nKind regards,\nBirchills Telecom Voicemail Service\n\nSent from  to[ \t]*$/;
  const match = footer.exec(normalized);
  // Never conceal a footer-only message or edit similar phrases within speech.
  if (!match || !normalized.slice(0, match.index).trim())
    return { text: original, providerFooterHidden: false };
  return { text: normalized.slice(0, match.index), providerFooterHidden: true };
}
