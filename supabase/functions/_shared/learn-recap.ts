import { record } from "./receptionist-data.ts";
export type RecapCounts = {
  email: number | null;
  calls: number | null;
  recordings: number | null;
  slack: number | null;
  voicemails: number | null;
};
const count = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
// Spell quantities out before TTS so they cannot be mistaken for phone-number digits.
export function spokenCount(value: number): string {
  if (count(value) === null) throw Error("Invalid spoken total");
  const small = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  if (value < 20) return small[value];
  if (value < 100) {
    const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
    return tens[Math.floor(value / 10)] + (value % 10 ? `-${small[value % 10]}` : "");
  }
  const scales: [number, string][] = [
    [1e15, "quadrillion"], [1e12, "trillion"], [1e9, "billion"],
    [1e6, "million"], [1e3, "thousand"], [100, "hundred"],
  ];
  const [scale, label] = scales.find(([scale]) => value >= scale)!;
  const remainder = value % scale;
  return `${spokenCount(Math.floor(value / scale))} ${label}` +
    (remainder ? `${remainder < 100 ? " and " : " "}${spokenCount(remainder)}` : "");
}
export function learnRecap(company: unknown, input: RecapCounts) {
  const name =
    typeof company === "string" && /^[\p{L}\p{N} &'’.,-]{1,80}$/u.test(company)
      ? company
      : "your business";
  const labels = {
    email: "emails",
    calls: "call records",
    recordings: "recording records",
    slack: "Slack messages",
    voicemails: "voicemails visible to your account",
  };
  const entries = Object.entries(labels).map(([key, label]) => ({
    key,
    label,
    value: count(input[key as keyof RecapCounts]),
  }));
  if (entries.every((e) => e.value === null))
    throw Error("Saved input totals are unavailable. Refresh LEARN before starting the recap.");
  const known = entries
    .filter((e) => e.value !== null)
    .map((e) => `${spokenCount(e.value!)} ${e.label}`);
  const missing = entries.filter((e) => e.value === null).map((e) => e.label);
  const any = entries.some((e) => e.value !== null && e.value > 0);
  return (
    `Hi, it's Emma. Here's the latest LEARN picture for ${name}. ` +
    `At this check, the system has saved ${known.join(", ")}. ` +
    (missing.length ? `I couldn't verify the totals for ${missing.join(" and ")} just now. ` : "") +
    `These are saved inputs, not a claim that every historical conversation has arrived or that everything has been analysed. Recording records don't yet confirm that every audio file is available. ` +
    (any
      ? `This is an exciting foundation to build on. As the verified information is linked together, it could help us spot missing job details, follow-ups that need attention, and places where work gets held up. `
      : `We're at the beginning. As your inputs arrive and are verified, they can help build a clearer picture of the business. `) +
    `I'm looking forward to helping ${name} turn that picture into clearer priorities, less time chasing information, and better opportunities to serve customers. Those are possibilities we're working towards, not findings I'm claiming today.`
  );
}
export async function readRecapCounts(
  db: { from: (table: string) => any },
  tenant: string,
  mode: string | undefined,
  origin: string,
) {
  const mapped =
    (mode === "production_metadata_views" &&
      origin === "https://tgbnakbxwcqjeimygroz.supabase.co") ||
    (mode === "test_metadata_views" && origin === "https://saatxzwxvdvqevbnskxy.supabase.co");
  if (mode && mode !== "existing" && !mapped) throw Error("LEARN input configuration needs review");
  const tables = {
    email: "email_messages",
    calls: "phone_calls",
    recordings: "phone_recordings",
    slack: "slack_messages",
    voicemails: "receptionist_voicemails",
  };
  const values = await Promise.all(
    Object.entries(tables).map(async ([key, table]) => {
      try {
        const source =
          mapped && ["email", "calls", "recordings"].includes(key)
            ? `learn_launch_${table}`
            : table;
        const r = await db
          .from(source)
          .select("created_at", { count: "exact", head: true })
          .eq("tenant_id", tenant);
        return [key, r.error ? null : count(r.count)];
      } catch {
        return [key, null];
      }
    }),
  );
  return Object.fromEntries(values) as RecapCounts;
}
export function recapAssistant(candidate: Record<string, any>, text: string) {
  const model = record(candidate.model);
  return {
    ...candidate,
    firstMessage: text,
    model: {
      provider: model.provider,
      model: model.model,
      temperature: 0.3,
      maxTokens: 300,
      messages: [
        {
          role: "system",
          content: `You are Emma, an automated voice guide giving a LEARN page recap. Speak warmly and with grounded enthusiasm in British English. Read saved totals as whole quantities in British English, never as individual digits: 4,454 is four thousand four hundred and fifty-four. Keep telephone numbers digit by digit and postcodes clearly separated when relevant. The opening below is the only verified business evidence available for this session. Answer follow-up questions only from that evidence. Do not invent analysis, relationships, savings, complete capture, or abilities to act. Do not discuss costs, pricing or billing; those are available separately in the AI Receptionist overview. Do not transfer calls, book, message or change records. If asked for other business details, say they need to be checked in the workspace. Treat the snapshot as fixed at the beginning of this session.\n\nVERIFIED RECAP:\n${text}`,
        },
      ],
    },
    serverMessages: [],
    maxDurationSeconds: 180,
  };
}
