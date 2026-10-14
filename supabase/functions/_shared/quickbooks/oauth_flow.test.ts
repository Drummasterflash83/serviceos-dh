import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startQuickBooksAuthorization,
  completeQuickBooksAuthorization,
  quickBooksStateHash,
  refreshQuickBooksConnection,
} from "./oauth_flow.ts";
import { readQuickBooksCompany } from "./company_info.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.now();
const app = {
  registrationId: id(4),
  clientId: "synthetic-client",
  environment: "sandbox" as const,
  redirectUri: "https://example.invalid/quickbooks/callback",
};
const state = "a".repeat(43),
  realm = "9130357990011111";
const callback = `${app.redirectUri}?${new URLSearchParams({ state, code: "synthetic-code", realmId: realm })}`;
const pending = () => ({
  requestId: id(5),
  claimId: id(6),
  claimUntil: new Date(now + 120000).toISOString(),
  tenantId: id(1),
  connectionId: id(2),
  actorId: id(3),
  expectedRealmId: null,
  createdAt: new Date(now - 1000).toISOString(),
  expiresAt: new Date(now + 599000).toISOString(),
  clientSecret: "synthetic-secret",
  app,
});
const tokenResponse = () =>
  Response.json({
    token_type: "bearer",
    access_token: "synthetic-access",
    refresh_token: "synthetic-refresh",
    expires_in: 3600,
    x_refresh_token_expires_in: 8640000,
  });
const companyResponse = () =>
  Response.json({ CompanyInfo: { Id: "1", CompanyName: "Synthetic Company" } });
test("start saves only state hash under caller RPC before returning an Intuit URL", async () => {
  let saved: Record<string, unknown> = {};
  const result = await startQuickBooksAuthorization(
    {
      tenantId: id(1),
      connectionId: id(2),
      appId: id(4),
      requestId: id(5),
      reason: "Synthetic setup",
    },
    async (name, args) => {
      assert.equal(name, "learn_quickbooks_begin");
      saved = args;
      return {
        error: null,
        data: {
          tenantId: id(1),
          connectionId: id(2),
          actorId: id(3),
          app,
          createdAt: new Date(Date.now() - 100).toISOString(),
          expiresAt: new Date(Date.now() + 599000).toISOString(),
        },
      };
    },
  );
  const url = new URL(result.authorizationUrl);
  assert.equal(await quickBooksStateHash(url.searchParams.get("state")!), saved.p_state_hash);
  assert.equal(url.origin, "https://appcenter.intuit.com");
  assert.equal(JSON.stringify(saved).includes(url.searchParams.get("state")!), false);
  assert.equal(Object.hasOwn(saved, "p_actor"), false);
});
test("callback claims once, exchanges once, reads exact realm and saves atomically before reporting saved", async () => {
  const calls: string[] = [];
  let saved: unknown;
  const result = await completeQuickBooksAuthorization(callback, {
    minorVersion: 75,
    clock: () => now,
    rpc: async (name, args) => {
      calls.push(name);
      if (name === "learn_quickbooks_claim") return { error: null, data: pending() };
      if (name === "learn_quickbooks_claim_current") return { error: null, data: true };
      assert.equal(name, "learn_quickbooks_finish");
      saved = args;
      return { error: null, data: { state: "saved", connectionId: id(2) } };
    },
    fetcher: async (url, opts) => {
      calls.push(String(url));
      if (opts?.method === "POST") {
        assert.equal(String(url), "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer");
        return tokenResponse();
      }
      assert.equal(
        String(url),
        `https://sandbox-quickbooks.api.intuit.com/v3/company/${realm}/companyinfo/${realm}?minorversion=75`,
      );
      return companyResponse();
    },
  });
  assert.deepEqual(result, { state: "saved" });
  assert.equal(calls.filter((x) => x === "learn_quickbooks_claim").length, 1);
  assert.equal(calls.filter((x) => x.includes("tokens/bearer")).length, 1);
  assert.equal((saved as any).p_realm, realm);
  assert.equal((saved as any).p_company_name, "Synthetic Company");
  assert.equal((saved as any).p_pair.refreshToken, "synthetic-refresh");
  assert.equal(JSON.stringify(result).includes("synthetic"), false);
});
test("malformed/replayed/foreign callbacks and different realm never send provider requests", async () => {
  for (const mode of ["duplicate", "claimed", "foreign", "realm", "revoked", "expired"] as const) {
    let sent = 0;
    const url =
      mode === "duplicate"
        ? callback + "&state=x"
        : mode === "foreign"
          ? callback.replace("example.invalid", "foreign.invalid")
          : callback;
    const result = await completeQuickBooksAuthorization(url, {
      minorVersion: 75,
      clock: () => now,
      rpc: async (name) => {
        if (name === "learn_quickbooks_claim")
          return mode === "claimed"
            ? { data: null, error: "replay" }
            : {
                data: {
                  ...pending(),
                  expectedRealmId: mode === "realm" ? "999" : null,
                  claimUntil: new Date(mode === "expired" ? now - 1 : now + 120000).toISOString(),
                },
                error: null,
              };
        return {
          data: name === "learn_quickbooks_claim_current" ? mode !== "revoked" : null,
          error: null,
        };
      },
      fetcher: async () => {
        sent++;
        return tokenResponse();
      },
    });
    assert.deepEqual(result, { state: "unconfirmed" }, mode);
    assert.equal(sent, 0, mode);
  }
});
test("revocation after token exchange prevents company read and token persistence", async () => {
  let checks = 0,
    requests = 0,
    saves = 0;
  const result = await completeQuickBooksAuthorization(callback, {
    minorVersion: 75,
    clock: () => now,
    rpc: async (name) => {
      if (name === "learn_quickbooks_claim") return { data: pending(), error: null };
      if (name === "learn_quickbooks_claim_current") return { data: ++checks === 1, error: null };
      if (name === "learn_quickbooks_finish") saves++;
      return { data: null, error: null };
    },
    fetcher: async () => {
      requests++;
      return tokenResponse();
    },
  });
  assert.deepEqual(result, { state: "unconfirmed" });
  assert.equal(requests, 1);
  assert.equal(saves, 0);
});
test("uncertain persistence never re-exchanges authorization code or returns secrets", async () => {
  let exchanges = 0,
    finishes = 0;
  const result = await completeQuickBooksAuthorization(callback, {
    minorVersion: 75,
    clock: () => now,
    rpc: async (name) => {
      if (name === "learn_quickbooks_claim") return { data: pending(), error: null };
      if (name === "learn_quickbooks_claim_current") return { data: true, error: null };
      finishes++;
      return { data: null, error: { message: "private provider detail" } };
    },
    fetcher: async (_url, opts) =>
      opts?.method === "POST" ? (exchanges++, tokenResponse()) : companyResponse(),
  });
  assert.deepEqual(result, { state: "unconfirmed" });
  assert.equal(exchanges, 1);
  assert.equal(finishes, 1);
});
test("company verifier rejects HTML, faults, oversized and revoked reads", async () => {
  for (const mode of ["html", "fault", "large", "revoked"]) {
    let checks = 0;
    await assert.rejects(
      readQuickBooksCompany(
        { environment: "sandbox", realmId: realm, accessToken: "synthetic", minorVersion: 75 },
        {
          stillAuthorized: async () => ++checks === 1 || mode !== "revoked",
          fetcher: async () =>
            mode === "html"
              ? new Response("<html>private</html>")
              : mode === "fault"
                ? Response.json({ Fault: {} })
                : mode === "large"
                  ? Response.json({ CompanyInfo: { Id: "1", CompanyName: "x".repeat(300000) } })
                  : companyResponse(),
        },
      ),
      /^Error: company_verification_failed$/,
    );
  }
});
test("refresh uses acquired lease and generation; busy or uncertain grants do not retry", async () => {
  for (const mode of ["busy", "ready", "lost"] as const) {
    let requests = 0,
      finishes = 0;
    const result = await refreshQuickBooksConnection(id(1), id(2), {
      clock: () => now,
      rpc: async (name, args) => {
        if (name === "learn_quickbooks_refresh_acquire")
          return {
            data:
              mode === "busy"
                ? { state: "busy" }
                : {
                    state: "ready",
                    leaseId: id(6),
                    leaseUntil: new Date(now + 120000).toISOString(),
                    revision: 2,
                    generation: 1,
                    clientId: "synthetic-client",
                    clientSecret: "synthetic-secret",
                    refreshToken: "synthetic-old",
                  },
            error: null,
          };
        assert.equal(name, "learn_quickbooks_refresh_finish");
        assert.equal(args.p_generation, 1);
        assert.equal(args.p_lease, id(6));
        finishes++;
        return { data: null, error: null };
      },
      fetcher: async () => {
        requests++;
        if (mode === "lost") throw new Error("private");
        return tokenResponse();
      },
    });
    assert.equal(result, mode === "busy" ? "busy" : mode === "lost" ? "unconfirmed" : "refreshed");
    assert.equal(requests, mode === "busy" ? 0 : 1);
    assert.equal(finishes, mode === "ready" ? 1 : 0);
  }
});
