/** Read-only Drummonds directory reconciliation. No email content or credential upload. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken } from "./learn-test-readiness.mjs";
import {
  getDelegatedToken,
  listDirectoryUsers,
  verifyGmailProfile,
} from "../../supabase/functions/_shared/google_workspace.ts";
const tenant = "00000000-0000-0000-0000-000000000001",
  project = "tgbnakbxwcqjeimygroz";
const verifyAliases = process.argv.includes("--verify-alias-profiles");
const destination = verifyAliases
  ? ".verification-results/workspace-directory-alias-audit-2026-10-11.json"
  : ".verification-results/workspace-directory-audit-2026-10-11.json";
const q = (v) => "'" + String(v).replaceAll("'", "''") + "'";
const hash = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
try {
  if (
    ![
      "--read-only-production-and-google",
      "--read-only-production-and-google --verify-alias-profiles",
    ].includes(process.argv.slice(2).join(" "))
  )
    throw Error("Explicit read-only mode required");
  const key = JSON.parse(
    readFileSync("/Users/chrisdrummond/Downloads/ServiceOS Workspace Connector.json", "utf8"),
  );
  const token = savedCliToken();
  async function query(query) {
    const r = await fetch(
      `https://api.supabase.com/v1/projects/${project}/database/query/read-only`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!r.ok) throw Error("Scoped production read unavailable");
    return r.json();
  }
  const connections = await query(
    `select id,domain,impersonation_subject,service_account_email,service_account_client_id from google_workspace_connections where tenant_id=${q(tenant)} and status='active' order by id`,
  );
  const matches = connections.filter(
    (c) =>
      c.service_account_email === key.client_email &&
      String(c.service_account_client_id) === key.client_id,
  );
  if (matches.length !== 1) throw Error("Existing credential identity mismatch");
  const c = matches[0];
  if (!/^[a-f0-9-]{36}$/.test(c.id) || typeof c.domain !== "string" || !c.domain)
    throw Error("Connection scope invalid");
  const inventory = `select id,email_address,mailbox_type,sync_enabled,status from google_workspace_mailboxes where tenant_id=${q(tenant)} and connection_id=${q(c.id)} order by id`;
  const accountsQuery = `select id,email_address,status,auth_state from email_accounts where tenant_id=${q(tenant)} and provider='gmail' and status in ('active_dwd','pending_tokenless_dwd') and lower(split_part(email_address,'@',2))=lower(${q(c.domain)}) order by id`;
  const before = await query(inventory),
    accounts = await query(accountsQuery);
  if (before.length > 1000 || accounts.length > 1000) throw Error("Bounded inventory exceeded");
  const failing = await query(
    `select distinct a.id,a.email_address from email_accounts a join (select metadata->>'email_account_id' account_id from email_sync_runs where tenant_id=${q(tenant)} and sync_type='workspace_messages' and status='failed' and error_message like '%invalid_grant%' order by started_at desc limit 200) f on f.account_id=a.id::text where a.tenant_id=${q(tenant)} and lower(split_part(a.email_address,'@',2))=lower(${q(c.domain)})`,
  );
  const delegated = await getDelegatedToken(
    {
      clientEmail: key.client_email,
      privateKey: key.private_key,
      subject: c.impersonation_subject,
      domain: c.domain,
    },
    ["https://www.googleapis.com/auth/admin.directory.user.readonly"],
  );
  const originalFetch = globalThis.fetch;
  let directoryRequests = 0;
  const aliases = new Map();
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    if (
      parsed.origin !== "https://admin.googleapis.com" ||
      parsed.pathname !== "/admin/directory/v1/users" ||
      parsed.searchParams.get("domain") !== c.domain ||
      (options?.method && options.method !== "GET") ||
      ++directoryRequests > 2
    )
      throw Error("Directory scope exceeded");
    const r = await originalFetch(url, options);
    if (r.ok) {
      const body = await r.clone().json();
      for (const u of body.users ?? [])
        for (const alias of [...(u.aliases ?? []), ...(u.nonEditableAliases ?? [])]) {
          if (typeof alias !== "string") throw Error("Directory alias invalid");
          if (
            typeof u.primaryEmail !== "string" ||
            (aliases.has(alias.toLowerCase()) &&
              aliases.get(alias.toLowerCase()) !== u.primaryEmail.toLowerCase())
          )
            throw Error("Directory alias owner conflict");
          aliases.set(alias.toLowerCase(), u.primaryEmail.toLowerCase());
        }
    }
    return r;
  };
  let users;
  try {
    users = await listDirectoryUsers(delegated.accessToken, c.domain, { maxPages: 2 });
  } finally {
    globalThis.fetch = originalFetch;
  }
  const current = new Map(users.map((u) => [u.email, u]));
  const classify = (email) => {
    const u = current.get(email.toLowerCase());
    return u
      ? u.suspended
        ? "present_suspended"
        : "present_active"
      : aliases.has(email.toLowerCase())
        ? "alias_only"
        : "absent_from_current_domain_directory";
  };
  const counts = (rows) =>
    rows.reduce((out, row) => {
      const kind = classify(row.email_address);
      out[kind] = (out[kind] ?? 0) + 1;
      return out;
    }, {});
  const aliasProfiles = [];
  let aliasTokenRequests = 0,
    profileRequests = 0;
  if (verifyAliases) {
    const selected = accounts.filter((a) => classify(a.email_address) === "alias_only");
    if (selected.length > 4) throw Error("Alias profile request bound exceeded");
    for (const account of selected) {
      const result = { state: "unconfirmed" };
      try {
        aliasTokenRequests++;
        const gmail = await getDelegatedToken(
          {
            clientEmail: key.client_email,
            privateKey: key.private_key,
            subject: account.email_address,
            domain: c.domain,
          },
          ["https://www.googleapis.com/auth/gmail.readonly"],
        );
        profileRequests++;
        const profile = await verifyGmailProfile(gmail.accessToken);
        const primary =
          typeof profile.emailAddress === "string" ? profile.emailAddress.toLowerCase() : null;
        result.state =
          primary === aliases.get(account.email_address.toLowerCase())
            ? "directory_primary_verified"
            : "profile_identity_differs";
        result.primaryHasDwdAccount =
          !!primary && accounts.some((a) => a.email_address.toLowerCase() === primary);
      } catch {
        result.state = "provider_check_unconfirmed";
      }
      aliasProfiles.push(result);
    }
  }
  const after = await query(inventory),
    afterAccounts = await query(accountsQuery);
  if (hash(before) !== hash(after) || hash(accounts) !== hash(afterAccounts))
    throw Error("Production inventory changed during read-only audit");
  const stored = new Set(before.map((r) => r.email_address.toLowerCase()));
  const report = {
    version: "learn-workspace-directory-audit/1",
    observedAt: new Date().toISOString(),
    state: "complete_current_directory_compared",
    directoryRequests,
    tokenRequests: 1 + aliasTokenRequests,
    profileRequests,
    ...(verifyAliases ? { aliasProfiles } : {}),
    messageRequests: 0,
    productionWrites: 0,
    testCredentialUploaded: false,
    credentialMatchesExistingConnection: true,
    storedMailboxes: before.length,
    currentDirectoryUsers: users.length,
    currentSuspendedUsers: users.filter((u) => u.suspended).length,
    newPrimaryUsers: users.filter((u) => !stored.has(u.email)).length,
    storedMailboxComparison: counts(before),
    enabledStoredMailboxComparison: counts(before.filter((r) => r.sync_enabled)),
    dwdAccountComparison: counts(accounts),
    recentInvalidGrantAccountComparison: counts(failing),
    configurationPreserved: true,
    configurationSha256: hash({ mailboxes: before, accounts }),
    limitations: [
      "One configured domain; this is current primary-user/returned-alias inventory, not all Workspace domains, groups or deleted history.",
      "Absence does not establish whether an account was deleted, renamed, moved or historically valid.",
      "No Gmail content, mailbox licences, historical coverage or capture-to-card journey verified; no mailbox or permission changed.",
    ],
  };
  writeFileSync(destination, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
} catch {
  console.error(
    "Read-only Workspace directory audit unconfirmed; raw provider, account and credential details withheld",
  );
  process.exitCode = 1;
}
