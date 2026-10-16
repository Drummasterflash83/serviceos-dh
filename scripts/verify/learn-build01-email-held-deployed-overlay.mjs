/** Patch only the three reviewed modules in the serving Email scheduler closure. */
import { createHash } from "node:crypto";

export const sha256 = value => createHash("sha256").update(value).digest("hex");
const before = {
  "email-workspace-scheduled-sync/index.ts": "f4d5c667001317c9fa91d7d16714e534e505d0279876424276e5aa1c4cf85ff3",
  "_shared/workspace_scheduler_selection.ts": "49dc0f921fee2219222d8011ef2d885c0697ee2aad97060f3ffbb336bae296b4",
  "_shared/email_scheduler_health.ts": "82521a2668d259fea5944a27269c66da550cabb0651412e442151e7a4009c16c",
};
function replaceOnce(source, oldText, newText) {
  const first = source.indexOf(oldText);
  if (first < 0 || source.indexOf(oldText, first + oldText.length) >= 0)
    throw Error("Serving Email scheduler anchor changed");
  return source.slice(0, first) + newText + source.slice(first + oldText.length);
}

export function patchHeldSchedulerModule(path, source) {
  if (sha256(source) !== before[path]) throw Error(`Serving Email scheduler source changed: ${path}`);
  if (path === "_shared/workspace_scheduler_selection.ts") {
    return source + `\n/** A blocked recent checkpoint stays held until its existing recovery protocol succeeds. */\nexport function isWorkspaceRecentCaptureHeld(account, checkpoints) {\n  return checkpoints.some((checkpoint)=>checkpoint.tenant_id === account.tenant_id && checkpoint.email_account_id === account.id && checkpoint.state === "blocked");\n}\n`;
  }
  if (path === "_shared/email_scheduler_health.ts") {
    source = replaceOnce(source,
      "metadata = {}, readFailure = false, knownIneligible = 0)",
      "metadata = {}, readFailure = false, knownIneligible = 0, heldRecovery = 0)");
    source = replaceOnce(source,
      "const failed = readFailure || counts.unconfirmed > 0 || knownIneligible > 0;",
      "const failed = readFailure || counts.unconfirmed > 0 || knownIneligible > 0 || heldRecovery > 0;");
    source = replaceOnce(source,
      'error_message: knownIneligible > 0 ? "Saved mailboxes need source-authority reconciliation" : failed ? "Scheduler could not confirm all requested work" : null,',
      'error_message: knownIneligible > 0 ? "Saved mailboxes need source-authority reconciliation" : heldRecovery > 0 ? "Saved mailboxes need capture recovery review" : failed ? "Scheduler could not confirm all requested work" : null,');
    return replaceOnce(source,
      "known_ineligible: knownIneligible\n",
      "known_ineligible: knownIneligible,\n        held_recovery: heldRecovery\n");
  }
  if (path !== "email-workspace-scheduled-sync/index.ts") throw Error("Unexpected Email scheduler module");
  source = replaceOnce(source,
    'import { isWorkspaceMailboxEligible } from "../_shared/workspace_scheduler_selection.ts";',
    'import { isWorkspaceMailboxEligible, isWorkspaceRecentCaptureHeld } from "../_shared/workspace_scheduler_selection.ts";');
  source = replaceOnce(source,
    "  const mailboxes = [];\n",
    "  const mailboxes = [];\n  const checkpoints = [];\n");
  source = replaceOnce(source,
    "  const perTenant = new Map();",
    `  if (!inventoryError) {\n    for(let offset = 0; offset < 100000; offset += 500){\n      const { data, error } = await supabase.from("email_ingestion_checkpoints").select("tenant_id,email_account_id,state,block_code").eq("stream", "recent").eq("state", "blocked").order("tenant_id").order("email_account_id").range(offset, offset + 499);\n      if (error || !data) { inventoryError = true; break; }\n      checkpoints.push(...data);\n      if (data.length < 500) break;\n      if (offset === 99500) inventoryError = true;\n    }\n  }\n  const perTenant = new Map();`);
  source = replaceOnce(source,
    "  const ineligibleByTenant = new Map();",
    "  const ineligibleByTenant = new Map();\n  const heldByTenant = new Map();");
  source = replaceOnce(source,
    "      const before = {\n        ...counts\n      };",
    `      if (isWorkspaceRecentCaptureHeld(acc, checkpoints)) {\n        heldByTenant.set(tid, (heldByTenant.get(tid) ?? 0) + 1);\n        continue;\n      }\n      const before = {\n        ...counts\n      };`);
  source = replaceOnce(source,
    "}, inventoryError, ineligibleByTenant.get(tid) ?? 0))",
    "}, inventoryError, ineligibleByTenant.get(tid) ?? 0, heldByTenant.get(tid) ?? 0))");
  return replaceOnce(source,
    "    ].reduce((n, c)=>n + c, 0)\n  });",
    "    ].reduce((n, c)=>n + c, 0),\n    held_recovery: [...heldByTenant.values()].reduce((n, c)=>n + c, 0)\n  });");
}
