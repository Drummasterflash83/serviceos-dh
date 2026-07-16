// Controlled in-process proof of HUMAN REFINEMENT BEFORE APPROVAL, driven through the REAL
// pure modules exactly as deployed. No DB, no UI, no transmission:
//
//   inbound email → business context → context-AWARE AI draft (the proposal)
//     → human EDIT (append-only revision)
//       → approve = resolve the effective (reviewed) version
//         → the reply_draft artifact the connector records CONTAINS THE EDITED VERSION,
//            while the original AI proposal stays immutable and provenance is preserved.
//
// This is the audit trail made concrete: AI proposal → human changes → approved artifact.
// Run: node supabase/functions/_shared/response_refinement.integration.ts

import { buildResponseContext } from "./response_context.ts";
import { draftResponse } from "./response_draft.ts";
import {
  buildResponseProposal,
  buildResponseRevision,
  resolveEffectiveResponse,
} from "./response_proposal.ts";
import { buildReplyDraft } from "./reply_draft.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (!cond) failures++;
  console.log(
    `  [${cond ? "PASS" : "FAIL"}] ${name}${!cond ? ` — got ${JSON.stringify(detail)}` : ""}`,
  );
}

const GEN_AT = "2026-07-27T09:00:00Z";
const EDIT_AT = "2026-07-27T09:05:00Z";

// ── inbound email → business context → context-aware AI draft (the proposal) ──
console.log("inbound email → context-aware AI draft:");
const ctx = buildResponseContext({
  current: {
    id: "int-refine",
    subject: "Can you help with my boiler?",
    summary: "customer needs help",
    from_name: "Ann Example",
  },
  card: {
    id: "card-refine",
    title: "Ann Example",
    status: "active",
    priority: "high",
    summary: "Repeat customer",
    relationshipCount: 3,
  },
  history: [
    {
      id: "int-prior",
      subject: "Earlier question",
      occurred_at: "2026-07-20T10:00:00Z",
      direction: "inbound",
    },
  ],
});
const drafted = draftResponse(ctx);
check(
  "the AI draft is business-aware (greets by name, reflects priority)",
  drafted.body.includes("Hi Ann Example,") && drafted.body.includes("high priority"),
);
check(
  "the AI draft records provenance (which context informed it)",
  drafted.provenance.length >= 2,
);

const proposalBuilt = buildResponseProposal({
  channel: "email",
  sourceInteraction: "int-refine",
  body: drafted.body,
  provenance: drafted.provenance,
  draftVersion: drafted.version,
  generatedBy: "response-assistant",
  generatedAt: GEN_AT,
});
check("the original AI proposal is captured immutably", proposalBuilt.ok === true);
const proposal = proposalBuilt.ok ? proposalBuilt.proposal : null!;
const ORIGINAL_BODY = proposal.original_body;

// ── human EDIT before approval (append-only revision) ────────────────────────
console.log("human edit before approval:");
const EDITED_BODY =
  "Hi Ann,\n\nThanks for getting back to us — I've booked an engineer for Thursday morning. " +
  "Please reply if that doesn't suit.\n\nBest, Drummonds";
const revBuilt = buildResponseRevision({
  revisionNumber: 1,
  body: EDITED_BODY,
  editorRef: "ops@drummonds.co.uk",
  editorKind: "tenant_operator",
  changeReason: "gave a concrete appointment instead of a generic acknowledgement",
  basedOn: "ai_proposal",
  basedOnRef: null,
  createdAt: EDIT_AT,
});
check("the human edit is a valid, attributable revision", revBuilt.ok === true);
check(
  "the revision records editor identity + timestamp + reason",
  revBuilt.ok &&
    revBuilt.revision.editor_ref === "ops@drummonds.co.uk" &&
    revBuilt.revision.created_at === EDIT_AT &&
    !!revBuilt.revision.change_reason,
);

// ── approve = execute the reviewed (edited) version ONLY ─────────────────────
console.log("approve → the reviewed version is what executes:");
const effective = resolveEffectiveResponse({
  proposal,
  revisions: [
    {
      id: "rev-1",
      revision_number: 1,
      revised_body: EDITED_BODY,
      editor_ref: "ops@drummonds.co.uk",
      change_reason: "concrete appointment",
    },
  ],
});
check(
  "the effective (approved) body is the HUMAN-EDITED version",
  effective.source === "revision" && effective.body === EDITED_BODY,
);
check(
  "the original AI proposal is UNCHANGED (immutable)",
  proposal.original_body === ORIGINAL_BODY && !proposal.original_body.includes("Thursday morning"),
);
check(
  "provenance is PRESERVED and records the human refinement",
  effective.provenance.length === drafted.provenance.length + 1 &&
    effective.provenance.some((p) => p.kind === "human_revision"),
);

// The exact artifact the email.reply_draft connector records on the execution attempt.
const artifact = buildReplyDraft({
  channel: "email",
  recipient: "ann@acme.co.uk",
  originalSubject: "Can you help with my boiler?",
  body: effective.body, // the executor reads the intent's (reviewed) parameters.body
  sourceInteraction: "int-refine",
  provenance: effective.provenance,
});
check(
  "the reply_draft artifact CONTAINS THE EDITED VERSION (not the AI original)",
  artifact.ok && artifact.draft.body === EDITED_BODY,
);
check(
  "the artifact never reverts to the AI draft",
  artifact.ok && !artifact.draft.body.includes("A member of the team will review the details"),
);
check(
  "the artifact carries the preserved provenance + human marker",
  artifact.ok &&
    artifact.draft.provenance.some((p) => p.kind === "human_revision") &&
    artifact.draft.provenance.some((p) => p.kind === "customer_card"),
);
check(
  "the artifact is a DRAFT only (no transmission modelled)",
  artifact.ok &&
    artifact.draft.channel === "email" &&
    artifact.draft.subject === "Re: Can you help with my boiler?",
);

// ── no-edit path: approval executes the untouched AI draft ───────────────────
console.log("no-edit path → approval executes the AI draft unchanged:");
const noEdit = resolveEffectiveResponse({ proposal, revisions: [] });
const noEditArtifact = buildReplyDraft({
  channel: "email",
  recipient: "ann@acme.co.uk",
  originalSubject: "Can you help with my boiler?",
  body: noEdit.body,
  sourceInteraction: "int-refine",
  provenance: noEdit.provenance,
});
check(
  "with no human edit, the approved artifact is the original AI draft",
  noEditArtifact.ok && noEditArtifact.draft.body === ORIGINAL_BODY,
);

console.log(
  failures === 0
    ? "\nREFINEMENT PROOF PASSED — human edit flows through approval into the reply_draft artifact; the AI original stays immutable, provenance preserved, no transmission"
    : `\n${failures} REFINEMENT CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
