// Customer-language vocabulary for contact eligibility and empty audiences.
//
// The engine speaks in enums (subscribed / unsubscribed / suppressed /
// unknown / invalid / no_contact_point). Customers need the same facts in
// plain words, plus the honest path forward — WITHOUT inventing consent:
// ServiceOS never fabricates a "subscribed" state; it explains what is
// missing and how a real consent fact would be recorded.

export interface EligibilityExplanation {
  label: string;
  /** one plain sentence about what this means for sending */
  meaning: string;
  /** whether a broadcast/sequence could reach this contact today */
  sendable: boolean;
}

export const ELIGIBILITY_LANGUAGE: Record<string, EligibilityExplanation> = {
  subscribed: {
    label: "Subscribed",
    meaning:
      "This person has an explicit marketing preference recorded — they can receive campaigns.",
    sendable: true,
  },
  unsubscribed: {
    label: "Unsubscribed",
    meaning: "This person opted out. Campaigns will always exclude them.",
    sendable: false,
  },
  suppressed: {
    label: "Suppressed",
    meaning:
      "Sending to this address is blocked (for example after a complaint or hard bounce). This cannot be bypassed.",
    sendable: false,
  },
  unknown: {
    label: "No preference recorded",
    meaning:
      "ServiceOS has no explicit marketing consent for this person, so campaigns exclude them. Consent is only ever recorded from a real action (a form, a written opt-in you record) — never assumed.",
    sendable: false,
  },
  invalid: {
    label: "Address looks invalid",
    meaning: "The stored email address is not usable, so campaigns exclude it.",
    sendable: false,
  },
  no_contact_point: {
    label: "No email address",
    meaning: "There is no email address on record for this person yet.",
    sendable: false,
  },
};

export function eligibilityLanguage(value: string | null | undefined): EligibilityExplanation {
  return (
    ELIGIBILITY_LANGUAGE[value ?? ""] ?? {
      label: value || "Unknown",
      meaning: "ServiceOS cannot say more about this state.",
      sendable: false,
    }
  );
}

/**
 * The honest start-to-finish path shown wherever an audience is empty.
 * Ordered: each item is a real, doable step — none of them invents consent.
 */
export const AUDIENCE_ONBOARDING_STEPS: { title: string; detail: string }[] = [
  {
    title: "Add or import your contacts",
    detail:
      "Use Contacts → New contact, or Imports to bring in a CSV. Importing someone does NOT subscribe them — it only creates the record.",
  },
  {
    title: "Record real marketing consent",
    detail:
      "A contact becomes eligible only when an explicit subscribed preference is recorded from a genuine action (a signup form, a written opt-in). ServiceOS never assumes consent.",
  },
  {
    title: "Group them with a segment",
    detail:
      'Create a saved segment (for example "Customers with a service due"). A campaign always sends to a segment, never to an ad-hoc list.',
  },
  {
    title: "Check the audience before you send",
    detail:
      "Every broadcast shows exactly how many people will receive it and lists everyone excluded, with the reason, before anything sends.",
  },
];
