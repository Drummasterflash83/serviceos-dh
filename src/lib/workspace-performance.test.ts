import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { QueryClient } from "@tanstack/react-query";
import {
  receptionistCallKey,
  receptionistCallFreshness,
  receptionistCallPollInterval,
} from "./receptionist-call-cache.ts";
const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
test("home and receptionist reuse recent calls, but invalidate and reload fetch fresh", async () => {
  const client = new QueryClient();
  let requests = 0;
  const options = {
    queryKey: receptionistCallKey("user", "tenant"),
    queryFn: async () => ({ calls: [], request: ++requests }),
    staleTime: receptionistCallFreshness,
  };
  await Promise.all([client.fetchQuery(options), client.fetchQuery(options)]);
  assert.equal(requests, 1, "in-flight calls deduplicated");
  await client.fetchQuery(options);
  assert.equal(requests, 1, "navigation reuses recent evidence");
  await client.invalidateQueries({ queryKey: options.queryKey });
  await client.fetchQuery(options);
  assert.equal(requests, 2, "explicit refresh fetches again");
  const reloaded = new QueryClient();
  await reloaded.fetchQuery(options);
  assert.equal(requests, 3, "fresh page session fetches again");
  client.clear();
  reloaded.clear();
});
test("cached call evidence cannot cross users or tenants", async () => {
  const client = new QueryClient();
  let calls = 0;
  for (const [user, tenant] of [
    ["a", "one"],
    ["b", "one"],
    ["a", "two"],
  ])
    await client.fetchQuery({
      queryKey: receptionistCallKey(user, tenant),
      queryFn: async () => ++calls,
      staleTime: receptionistCallFreshness,
    });
  assert.equal(calls, 3);
  client.clear();
  assert.equal(receptionistCallFreshness, 45000);
  assert.equal(receptionistCallPollInterval, 60000);
});
test("both surfaces actually use the shared call hook", () => {
  assert.match(
    read("../components/client-portal/WorkspaceHome.tsx"),
    /useReceptionistCalls\(userId, tenant/,
  );
  assert.match(
    read("../components/receptionist/ReceptionistWorkspace.tsx"),
    /useReceptionistCalls\(user\?\.id, tenant, !demo\)/,
  );
});
test("legacy tool requests and code are off the released-module critical path", () => {
  const route = read("../routes/openfolk.$tenantId.tsx");
  assert.match(route, /if \(!search.tools\) return;[\s\S]*?void fetchAll\(\)/);
  assert.match(route, /const OpenfolkWorkspace = lazy/);
  assert.ok(
    route.indexOf("if (!search.tools)", route.indexOf("const setModule")) <
      route.indexOf("if (loading)"),
  );
});
test("non-visible notes, delivery and training do not fetch in the background", () => {
  assert.match(
    read("../components/client-portal/ClientPortal.tsx"),
    /enabled: !!user && !!tenant && section === "notes"/,
  );
  assert.match(
    read("../components/client-portal/ClientInvestment.tsx"),
    /showDelivery && <ClientDeliverySummary/,
  );
  assert.doesNotMatch(
    read("../components/client-portal/ClientInvestment.tsx"),
    /\.from\("client_delivery_updates"\)/,
  );
  assert.match(
    read("../components/receptionist/ReceptionistWorkspace.tsx"),
    /view === "practice" \|\| view === "details"/,
  );
});
test("light directory stays behind the existing operator gate and paginates", () => {
  const edge = read("../../supabase/functions/openfolk-control-plane/index.ts");
  assert.match(edge, /const READ_ACTIONS = new Set\(\[\s*"tenants.directory"/);
  assert.ok(
    edge.indexOf("await requirePlatformOperator") < edge.indexOf('case "tenants.directory"'),
  );
  const action = edge.slice(
    edge.indexOf('case "tenants.directory"'),
    edge.indexOf('case "tenants.list"'),
  );
  assert.match(action, /tenant_id:id,slug,display_name/);
  assert.match(action, /\.range\(offset, offset \+ 999\)/);
  assert.doesNotMatch(action, /loadTenantSummary/);
  assert.match(action, /if \(error\)/);
});
