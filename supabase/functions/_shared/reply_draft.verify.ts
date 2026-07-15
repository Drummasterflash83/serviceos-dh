// Unit tests for the PURE ReplyDraft model. No DB/network.
// Run: node supabase/functions/_shared/reply_draft.verify.ts

import { buildReplyDraft, replySubject } from "./reply_draft.ts";

let failures = 0;
function check(name, cond, detail) {
  if (!cond) failures++;
  console.log(
    `  [${cond ? "PASS" : "FAIL"}] ${name}${!cond ? ` — got ${JSON.stringify(detail)}` : ""}`,
  );
}

console.log("Reply subject normalisation:");
check("prefixes Re:", replySubject("Boiler quote") === "Re: Boiler quote");
check("idempotent (no Re: Re:)", replySubject("Re: Boiler quote") === "Re: Boiler quote");
check("case-insensitive Re:", replySubject("RE: hi") === "RE: hi");
check("empty subject handled", replySubject(null) === "Re: (no subject)");

console.log("Reply draft construction:");
const ok = buildReplyDraft({
  recipient: "ann@acme.co.uk",
  originalSubject: "Boiler",
  body: "Thanks, we'll help.",
  sourceInteraction: "int-1",
});
check(
  "builds a structured email reply draft with provenance",
  ok.ok === true &&
    ok.draft.channel === "email" &&
    ok.draft.recipient === "ann@acme.co.uk" &&
    ok.draft.subject === "Re: Boiler" &&
    ok.draft.body === "Thanks, we'll help." &&
    ok.draft.source_interaction === "int-1",
  ok,
);
check(
  "no recipient ⇒ explicit error (never an unaddressed reply)",
  buildReplyDraft({ recipient: null, originalSubject: "x", body: "b", sourceInteraction: "i" })
    .ok === false,
);
check(
  "empty body ⇒ explicit error (never an empty reply)",
  buildReplyDraft({ recipient: "a@b.c", originalSubject: "x", body: "   ", sourceInteraction: "i" })
    .ok === false,
);
check(
  "missing source interaction ⇒ explicit error",
  buildReplyDraft({ recipient: "a@b.c", originalSubject: "x", body: "b", sourceInteraction: null })
    .ok === false,
);
check(
  "body is bounded",
  (() => {
    const r = buildReplyDraft({
      recipient: "a@b.c",
      originalSubject: "x",
      body: "z".repeat(9000),
      sourceInteraction: "i",
    });
    return r.ok && r.draft.body.length === 4000;
  })(),
);
check(
  "deterministic — same inputs, same draft",
  JSON.stringify(
    buildReplyDraft({
      recipient: "a@b.c",
      originalSubject: "S",
      body: "B",
      sourceInteraction: "I",
    }),
  ) ===
    JSON.stringify(
      buildReplyDraft({
        recipient: "a@b.c",
        originalSubject: "S",
        body: "B",
        sourceInteraction: "I",
      }),
    ),
);

console.log(
  failures === 0 ? "\nALL REPLY-DRAFT UNIT CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
