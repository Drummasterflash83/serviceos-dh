import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const readback = process.env.WORKSPACE_DIRECTORY_READBACK;
const endpointPath = readback
  ? resolve(readback, "index.ts")
  : new URL("../supabase/functions/google-workspace-discover-mailboxes/index.ts", import.meta.url);
const helperPath = readback
  ? pathToFileURL(resolve(readback, "functions/_shared/google_workspace.ts"))
  : new URL("../supabase/functions/_shared/google_workspace.ts", import.meta.url);
const { listDirectoryUsers, DelegationError } = await import(helperPath.href);
const user = (email) => ({ primaryEmail: email, suspended: false, isAdmin: false });
async function withPages(pages, run) {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).host, "admin.googleapis.com");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal);
    const next = pages[calls++];
    if (next instanceof Error) throw next;
    return Response.json(next ?? { users: [] });
  };
  try {
    return await run(() => calls);
  } finally {
    globalThis.fetch = original;
  }
}
test("only a terminal directory traversal returns all pages", async () => {
  await withPages(
    [
      { users: [user("A@example.org")], nextPageToken: "opaque+1" },
      { users: [user("b@example.org")] },
    ],
    async (count) => {
      const users = await listDirectoryUsers("synthetic", "example.org");
      assert.deepEqual(
        users.map((u) => u.email),
        ["a@example.org", "b@example.org"],
      );
      assert.equal(count(), 2);
    },
  );
});
test("page limit, repeated cursor, duplicate or malformed user never return partial inventory", async () => {
  const cases = [
    [
      [{ users: [user("a@example.org")], nextPageToken: "more" }],
      { maxPages: 1 },
      "directory_scan_incomplete",
    ],
    [
      [
        { users: [], nextPageToken: "same" },
        { users: [], nextPageToken: "same" },
      ],
      {},
      "directory_cursor_repeated",
    ],
    [
      [
        { users: [user("a@example.org")], nextPageToken: "next" },
        { users: [user("A@example.org")] },
      ],
      {},
      "directory_duplicate_user",
    ],
    [[{ users: [{}] }], {}, "directory_user_invalid"],
    [[{ users: [{ ...user("a@example.org"), suspended: "false" }] }], {}, "directory_user_invalid"],
    [[{ users: {} }], {}, "directory_page_invalid"],
    [[{ users: [], nextPageToken: null }], {}, "directory_cursor_invalid"],
    [[new Error("PRIVATE network details")], {}, "directory_request_unconfirmed"],
  ];
  for (const [pages, opts, code] of cases)
    await withPages(pages, () =>
      assert.rejects(
        listDirectoryUsers("synthetic", "example.org", opts),
        (e) => e.message === code,
      ),
    );
  await withPages([], (count) =>
    assert
      .rejects(listDirectoryUsers("synthetic", "example.org", { maxPages: 0 }))
      .then(() => assert.equal(count(), 0)),
  );
});
function fixture({ errorAt, shortPrune = false, mailboxesOverride } = {}) {
  const writes = [],
    tenant = "00000000-0000-4000-8000-000000000001",
    connection = "00000000-0000-4000-8000-000000000002";
  const mailboxes = mailboxesOverride ?? [
    {
      id: "present",
      email_address: "present@example.org",
      status: "disabled",
      sync_enabled: false,
    },
    { id: "gone", email_address: "gone@example.org", status: "active", sync_enabled: true },
  ];
  const before = structuredClone(mailboxes);
  const db = {
    from(table) {
      let op = "read",
        payload,
        selection,
        selectedEmails,
        eqs = [];
      const q = {
        select(s) {
          selection = s;
          return q;
        },
        eq(k, v) {
          eqs.push([k, v]);
          return q;
        },
        neq() {
          return q;
        },
        order() {
          return q;
        },
        limit() {
          return q;
        },
        in(k, v) {
          if (k === "email_address") selectedEmails = v;
          return q;
        },
        insert(v) {
          op = "insert";
          payload = v;
          return q;
        },
        upsert(v) {
          op = "upsert";
          payload = v;
          return q;
        },
        update(v) {
          op = "update";
          payload = v;
          return q;
        },
        maybeSingle() {
          return execute(true);
        },
        then(resolve, reject) {
          return execute(false).then(resolve, reject);
        },
      };
      async function execute(single) {
        const step = table + ":" + op;
        if (errorAt === step) return { data: null, error: { message: "PRIVATE DATABASE DETAIL" } };
        if (op === "read") {
          if (table === "google_workspace_connections")
            return {
              data: {
                id: connection,
                domain: "example.org",
                impersonation_subject: "admin@example.org",
              },
              error: null,
            };
          if (table === "google_workspace_mailboxes") {
            assert.ok(eqs.some(([k, v]) => k === "tenant_id" && v === tenant));
            return { data: structuredClone(mailboxes), error: null };
          }
          throw Error("Unexpected read");
        }
        writes.push({ table, op, payload });
        if (table === "google_workspace_mailboxes" && op === "upsert") {
          for (const r of payload) {
            const existing = mailboxes.find((m) => m.email_address === r.email_address);
            if (existing) Object.assign(existing, r);
            else mailboxes.push({ ...r, status: "pending", sync_enabled: false });
          }
          return { data: null, error: null };
        }
        if (table === "google_workspace_mailboxes" && op === "update") {
          assert.ok(eqs.some(([k, v]) => k === "tenant_id" && v === tenant));
          if (shortPrune) return { data: [], error: null };
          const changed = mailboxes.filter((m) => selectedEmails?.includes(m.email_address));
          for (const m of changed) Object.assign(m, payload);
          return { data: changed.map((m) => ({ id: m.id })), error: null };
        }
        if (table === "google_workspace_connections" && op === "update")
          return { data: { id: connection }, error: null };
        if (table === "email_sync_runs") return { data: { id: "run" }, error: null };
        return { data: null, error: null };
      }
      return q;
    },
  };
  let handler;
  const code = readFileSync(endpointPath, "utf8");
  runInNewContext(
    ts.transpileModule(code, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports: {},
      Date,
      Set,
      Request,
      Response,
      Deno: { serve: (fn) => (handler = fn), env: { get: () => "synthetic" } },
      require: (name) => {
        if (name.includes("@supabase/")) return { createClient: () => db };
        if (name.endsWith("/learn_capture_control.ts"))
          return { captureAdmission: async () => ({ allowed: true }) };
        if (name.endsWith("/authz.ts"))
          return { requireTenantUser: async () => ({ ok: true, ctx: { tenantId: tenant } }) };
        if (name.endsWith("/google_workspace.ts"))
          return {
            listDirectoryUsers,
            DelegationError,
            WORKSPACE_SCOPES: ["readonly"],
            getDelegatedToken: async () => ({ accessToken: "synthetic" }),
            getPlatformWorkspaceConfig: () => ({
              ok: true,
              config: { clientEmail: "synthetic", privateKey: "synthetic" },
            }),
          };
        throw Error("Unexpected import");
      },
    },
  );
  return {
    writes,
    mailboxes,
    before,
    run: async () => {
      const r = await handler(new Request("https://test.invalid", { method: "POST" }));
      const body = await r.json();
      assert.ok(!JSON.stringify(body).includes("PRIVATE"));
      assert.ok(!JSON.stringify(writes).includes("PRIVATE"));
      return { status: r.status, body };
    },
  };
}
test("actual endpoint never reconciles or verifies from an incomplete provider scan", async () => {
  const f = fixture();
  await withPages(
    Array.from({ length: 20 }, (_, i) => ({
      users: [user(`person${i}@example.org`)],
      nextPageToken: `next${i}`,
    })),
    async () => {
      const r = await f.run();
      assert.equal(r.status, 502);
      assert.equal(r.body.success, false);
      assert.deepEqual(f.mailboxes, f.before);
      assert.ok(f.writes.every((w) => ["email_sync_runs", "audit_logs"].includes(w.table)));
    },
  );
});
test("inventory, upsert, prune and connection verification errors cannot report success", async () => {
  for (const step of [
    "google_workspace_mailboxes:read",
    "google_workspace_mailboxes:upsert",
    "google_workspace_mailboxes:update",
    "google_workspace_connections:update",
  ]) {
    const f = fixture({ errorAt: step });
    await withPages([{ users: [user("present@example.org")] }], async () => {
      const r = await f.run();
      assert.equal(r.status, 500, step);
      assert.equal(r.body.success, false);
      assert.ok(
        !f.writes.some((w) => w.table === "email_sync_runs" && w.payload.status === "success"),
      );
      if (step === "google_workspace_mailboxes:read") assert.deepEqual(f.mailboxes, f.before);
    });
  }
  const f = fixture({ shortPrune: true });
  await withPages([{ users: [user("present@example.org")] }], async () =>
    assert.equal((await f.run()).status, 500),
  );
});
test("complete reconciliation preserves operator choices and retained mailbox history", async () => {
  const f = fixture();
  await withPages([{ users: [user("present@example.org")] }], async () => {
    const r = await f.run();
    assert.equal(r.body.success, true);
    assert.equal(r.body.removed, 1);
    assert.equal(f.mailboxes.length, 2);
    assert.equal(f.mailboxes[0].status, "disabled");
    assert.equal(f.mailboxes[0].sync_enabled, false);
    assert.equal(f.mailboxes[1].status, "removed");
    assert.equal(f.mailboxes[1].sync_enabled, true);
    assert.ok(
      f.writes.findIndex((w) => w.table === "google_workspace_connections") >
        f.writes.findIndex((w) => w.table === "google_workspace_mailboxes" && w.op === "update"),
    );
    assert.ok(!f.writes.some((w) => ["email_messages", "email_accounts"].includes(w.table)));
  });
});
test("lost success receipt returns unconfirmed rather than clean success", async () => {
  const f = fixture({ errorAt: "email_sync_runs:insert" });
  await withPages([{ users: [user("present@example.org")] }], async () => {
    const r = await f.run();
    assert.equal(r.status, 503);
    assert.equal(r.body.error.code, "outcome_unconfirmed");
  });
});

test("directory aliases are validated and conflicts across pages prevent reconciliation", async () => {
  await withPages(
    [
      {
        users: [
          {
            ...user("Primary@example.org"),
            aliases: ["Old@example.org", "old@example.org"],
            nonEditableAliases: ["Other@example.org"],
          },
        ],
      },
    ],
    async () => {
      const rows = await listDirectoryUsers("synthetic", "example.org");
      assert.deepEqual(rows[0].aliases, ["old@example.org", "other@example.org"]);
    },
  );
  for (const bad of [
    null,
    "alias@example.org",
    [1],
    ["invalid"],
    Array(1001).fill("alias@example.org"),
  ]) {
    const f = fixture();
    await withPages([{ users: [{ ...user("present@example.org"), aliases: bad }] }], async () => {
      assert.equal((await f.run()).status, 502);
      assert.deepEqual(f.mailboxes, f.before);
    });
  }
  for (const second of [
    user("old@example.org"),
    { ...user("another@example.org"), aliases: ["old@example.org"] },
  ]) {
    const f = fixture();
    await withPages(
      [
        {
          users: [{ ...user("present@example.org"), aliases: ["old@example.org"] }],
          nextPageToken: "next",
        },
        { users: [second] },
      ],
      async () => {
        assert.equal((await f.run()).status, 502);
        assert.deepEqual(f.mailboxes, f.before);
        assert.ok(f.writes.every((w) => ["email_sync_runs", "audit_logs"].includes(w.table)));
      },
    );
  }
});
test("actual discovery preserves existing aliases and choices without adding every alias", async () => {
  for (const suspended of [false, true]) {
    const f = fixture({
      mailboxesOverride: [
        { id: "alias", email_address: "old@example.org", status: "active", sync_enabled: true },
        { id: "off", email_address: "off@example.org", status: "disabled", sync_enabled: false },
        { id: "gone", email_address: "gone@example.org", status: "active", sync_enabled: true },
      ],
    });
    await withPages(
      [
        {
          users: [
            {
              ...user("primary@example.org"),
              suspended,
              aliases: ["old@example.org", "new@example.org"],
              nonEditableAliases: ["off@example.org"],
            },
          ],
        },
      ],
      async () => {
        const r = await f.run();
        assert.equal(r.status, 200);
        assert.equal(r.body.removed, 1);
        const alias = f.mailboxes.find((m) => m.id === "alias"),
          off = f.mailboxes.find((m) => m.id === "off");
        assert.equal(alias.status, "active");
        assert.equal(alias.sync_enabled, true);
        assert.equal(alias.mailbox_type, suspended ? "suspended" : "alias");
        assert.equal(off.status, "disabled");
        assert.equal(off.sync_enabled, false);
        assert.equal(off.mailbox_type, suspended ? "suspended" : "alias");
        assert.equal(f.mailboxes.find((m) => m.id === "gone").status, "removed");
        assert.equal(
          f.mailboxes.some((m) => m.email_address === "new@example.org"),
          false,
        );
        assert.ok(f.writes.every((w) => !["email_accounts", "email_messages"].includes(w.table)));
      },
    );
  }
});

test("changed directory ownership is held while retaining the original identity and operator choice", async () => {
  const f = fixture({
    mailboxesOverride: [
      {
        id: "alias",
        email_address: "old@example.org",
        status: "active",
        sync_enabled: true,
        directory_primary_email: "original@example.org",
        directory_identity_conflict: false,
      },
    ],
  });
  await withPages(
    [{ users: [{ ...user("replacement@example.org"), aliases: ["old@example.org"] }] }],
    async () => {
      assert.equal((await f.run()).status, 200);
      const row = f.mailboxes.find((m) => m.id === "alias");
      assert.equal(row.directory_primary_email, "original@example.org");
      assert.equal(row.directory_identity_conflict, true);
      assert.equal(row.sync_enabled, true);
      assert.equal(row.status, "active");
    },
  );
});
