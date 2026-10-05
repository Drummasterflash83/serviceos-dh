export type RecordedPhoneRoute = { title: string; detail: string; date: string };
export type PhoneRouteRow = {
  trigger: string;
  destination: string;
  extension?: string;
  fallback?: boolean;
};
export type PhoneRouteSection = {
  title: string;
  menu?: string;
  note?: string;
  rows: PhoneRouteRow[];
  kind: "office" | "closed" | "fallback" | "voicemail" | "reference";
};

/** Format only recognised documentary structures. Unknown/new wording is shown
 * verbatim, never guessed into destinations. The original record stays accessible. */
export function phoneRouteSections(route: RecordedPhoneRoute): PhoneRouteSection[] {
  const office = route.detail.match(
    /^Recorded menu (\d+): option 1 → (.+?) \((\d+)\), 2 → (.+?) \((\d+)\), 3 → (.+?) \((\d+)\), 4 → (.+?) \((\d+)\)\. No selection or an invalid choice → ring group (\d+)\.$/,
  );
  if (office)
    return [
      {
        title: route.title,
        menu: office[1],
        kind: "office",
        rows: [0, 1, 2, 3]
          .map<PhoneRouteRow>((i) => ({
            trigger: `Press ${i + 1}`,
            destination: office[2 + i * 2]!,
            extension: office[3 + i * 2]!,
          }))
          .concat([
            {
              trigger: "No choice / invalid choice",
              destination: "Ring group",
              extension: office[10]!,
              fallback: true,
            },
          ]),
      },
    ];
  const closed = route.detail.match(
    /^Recorded menu (\d+): option 1 → (.+?) \((\d+)\); option 2, no selection or an invalid choice → shared voicemail \((\d+)\)\. Also recorded for (.+?) holidays\.$/,
  );
  if (closed)
    return [
      {
        title: route.title,
        menu: closed[1],
        kind: "closed",
        note: `Also used for ${closed[5]} holidays in this record.`,
        rows: [
          { trigger: "Press 1", destination: closed[2]!, extension: closed[3]! },
          { trigger: "Press 2", destination: "Shared voicemail", extension: closed[4]! },
          {
            trigger: "No choice / invalid choice",
            destination: "Shared voicemail",
            extension: closed[4]!,
            fallback: true,
          },
        ],
      },
    ];
  const fallback = route.detail.match(
    /^Desk extensions (\d+[–-]\d+) have voicemail fallback\. (.+?)[’']s busy route is the exception: extension (\d+)\. Shared mailbox (\d+) sends notifications to (.+?)\.$/,
  );
  if (fallback)
    return [
      {
        title: "When someone cannot answer",
        kind: "fallback",
        rows: [
          { trigger: `Desk extensions ${fallback[1]}`, destination: "Voicemail fallback" },
          {
            trigger: `${fallback[2]}’s line is busy`,
            destination: "Extension",
            extension: fallback[3]!,
            fallback: true,
          },
        ],
      },
      {
        title: "Voicemail notifications",
        kind: "voicemail",
        rows: [{ trigger: `Shared mailbox ${fallback[4]}`, destination: fallback[5]! }],
        note: "Email notifications from the shared mailbox.",
      },
    ];
  return [{ title: route.title, kind: "reference", note: route.detail, rows: [] }];
}
