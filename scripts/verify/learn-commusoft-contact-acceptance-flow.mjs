/** Signed-in contact projection exercised against hosted TEST; provider input is synthetic. */
import { randomUUID } from "node:crypto";
import { findCommusoftContacts } from "../../src/lib/learn-commusoft-review.ts";
import {
  loadWorkPage,
  resolveWorkDraft,
  readWorkDraft,
  workOutboxKey,
} from "../../src/lib/learn-commusoft-work.ts";
const check = (v, m) => {
  if (!v) throw Error(m);
};
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
export function syntheticContactPage(url, index) {
  const type = index === 0 ? "workaddress" : "customer";
  check(
    url.pathname === "/api/v2/propertyContacts" && url.searchParams.get("type") === type,
    "Synthetic contact collection/type differs",
  );
  check(
    (url.searchParams.get("after") ?? null) === (index < 2 ? null : String(400 + index)),
    "Synthetic contact cursor differs",
  );
  const rows = [
    {
      id: 401,
      propertyID: 201,
      firstName: "Site",
      lastName: "Caretaker",
      position: "Site contact",
      email: "caretaker@example.invalid",
      telephones: [
        { type: "Mobile", number: "07700 900123" },
        { type: "Office", number: "020 7946 0123" },
      ],
    },
    {
      id: 402,
      propertyID: 101,
      firstName: "Alex",
      lastName: "Source alias",
      email: "alex@example.invalid",
    },
    { id: 403, propertyID: 999, firstName: "Unresolved", lastName: "Source" },
    { id: 404, propertyID: 101, firstName: "Cancelled", lastName: "Source" },
  ];
  check(
    Number.isInteger(index) && index >= 0 && index < rows.length,
    "Unexpected duplicate contact read",
  );
  return {
    data: [rows[index]],
    pagination: { hasMore: index === 1 || index === 2, nextCursor: rows[index].id },
    synthetic: true,
  };
}
export async function acceptCapturedContacts({
  owner,
  anonymous,
  tenant,
  actor,
  connection,
  customerId,
  backend,
  sql,
  setModules,
}) {
  const page = await loadWorkPage(owner, tenant, connection, "contact");
  check(page.rows.length === 4, "Captured contacts missing from signed-in review");
  const source = (n) => {
    const r = page.rows.find((r) => r.external_id === String(n));
    check(r?.version_id, "Captured contact version missing");
    return r;
  };
  check(
    source(401).contact.email === "caretaker@example.invalid" &&
      source(401).contact.phones.length === 2,
    "Source endpoints missing from review",
  );
  const scope = { backend, actorId: actor, tenantId: tenant },
    memory = new Map(),
    store = {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => memory.set(k, v),
      removeItem: (k) => memory.delete(k),
    },
    lock = async (_key, work) => work();
  const draft = (ids, target = null) => ({
    version: 1,
    scope,
    id: randomUUID(),
    connection,
    kind: "contact",
    items: ids.map((n) => ({ version_id: source(n).version_id, target_id: target })),
    reason: "Synthetic signed-in contact review",
  });
  const checks = [];
  let applyCalls = 0;
  const uncertain = {
    rpc: async (name, args) => {
      const result = await owner.rpc(name, args);
      if (name === "learn_commusoft_work_batch") {
        applyCalls++;
        check(!result.error, "Hosted contact batch failed before lost reply");
        throw Error("Synthetic contact acknowledgement lost");
      }
      return result;
    },
  };
  const first = draft([401, 403]);
  let failed = false;
  try {
    await resolveWorkDraft(uncertain, store, lock, scope, first, "apply", () => true);
  } catch {
    failed = true;
  }
  check(
    failed && applyCalls === 1 && readWorkDraft(store, scope)?.id === first.id,
    "Contact request not retained after lost reply",
  );
  await setModules(false);
  const recovered = await resolveWorkDraft(
    owner,
    store,
    lock,
    scope,
    readWorkDraft(store, scope),
    "check",
    () => true,
  );
  check(
    recovered?.linked === 1 &&
      recovered.held === 1 &&
      recovered.items[0].outcome.entity_kind === "contact" &&
      recovered.items[1].outcome.state === "held" &&
      readWorkDraft(store, scope) === null,
    "Contact saved result not recovered with module disabled",
  );
  check(applyCalls === 1, "Contact recovery repeated application");
  await setModules(true);
  checks.push(
    "A real signed-in contact batch links the site contact and holds an unresolved property. Its response is deliberately lost; the production outbox recovers the saved mixed result while capture is disabled without resubmitting.",
  );
  const held = await resolveWorkDraft(owner, store, lock, scope, draft([402]), "apply", () => true);
  check(
    held.held === 1 && held.items[0].outcome.reason === "contact_identity_needs_review",
    "Shared customer email created a duplicate person",
  );
  const candidates = await findCommusoftContacts(owner, tenant, source(402).version_id, "");
  check(
    candidates.rows.some((r) => r.id === customerId && r.reason === "shared_email"),
    "Existing customer identity absent from contact candidates",
  );
  const personFingerprint = async () =>
    (
      await sql(
        `select md5(row_to_json(p)::text) as fingerprint from people p where id=${q(customerId)} and tenant_id=${q(tenant)}`,
        true,
      )
    )[0]?.fingerprint;
  const before = await personFingerprint();
  check(typeof before === "string", "Existing person preservation baseline missing");
  const selected = draft([402], customerId),
    linked = await resolveWorkDraft(owner, store, lock, scope, selected, "apply", () => true);
  check(
    linked.linked === 1 && linked.items[0].outcome.entity_id === customerId,
    "Selected existing contact not linked",
  );
  check((await personFingerprint()) === before, "Existing person fields changed");
  const replay = await owner.rpc("learn_commusoft_work_batch", {
    p_tenant: tenant,
    p_request: selected.id,
    p_connection: connection,
    p_kind: "contact",
    p_items: selected.items,
    p_reason: selected.reason,
    p_expected_actor: actor,
  });
  check(
    !replay.error && replay.data.items[0].outcome.entity_id === customerId,
    "Contact receipt replay changed selected identity",
  );
  checks.push(
    "A shared email is held for identity review. Real candidate lookup finds the captured customer; explicit selection links that same person without changing their saved fields, and the batch receipt replays the chosen identity.",
  );
  const cancelled = draft([404]);
  store.setItem(workOutboxKey(scope), JSON.stringify(cancelled));
  const cancelledReceipt = await resolveWorkDraft(
    owner,
    store,
    lock,
    scope,
    cancelled,
    "cancel",
    () => true,
  );
  check(cancelledReceipt.state === "cancelled", "Saved contact cancellation failed");
  const late = await owner.rpc("learn_commusoft_work_batch", {
    p_tenant: tenant,
    p_request: cancelled.id,
    p_connection: connection,
    p_kind: "contact",
    p_items: cancelled.items,
    p_reason: cancelled.reason,
    p_expected_actor: actor,
  });
  check(!late.error && late.data.state === "cancelled", "Late apply escaped cancellation");
  const anonymousResult = await anonymous.rpc("learn_commusoft_contact_candidates", {
    p_tenant: tenant,
    p_version: source(401).version_id,
    p_kind: "person",
  });
  check(!!anonymousResult.error, "Anonymous contact lookup allowed");
  const wrongTenant = await owner.rpc("learn_commusoft_contact_candidates", {
    p_tenant: randomUUID(),
    p_version: source(401).version_id,
    p_kind: "person",
  });
  check(!!wrongTenant.error, "Wrong-tenant contact lookup allowed");
  await sql(`update profiles set role='viewer' where id=${q(actor)} and tenant_id=${q(tenant)}`);
  try {
    const denied = await owner.rpc("learn_commusoft_work_review_page", {
      p_tenant: tenant,
      p_connection: connection,
      p_kind: "contact",
    });
    check(!!denied.error, "Demoted viewer kept contact review access");
  } finally {
    await sql(`update profiles set role='owner' where id=${q(actor)} and tenant_id=${q(tenant)}`);
  }
  checks.push(
    "Cancellation fences a later apply. Anonymous and wrong-tenant contact lookups are denied; demoting the signed-in owner to viewer immediately removes contact review access.",
  );
  const summary = (
    await sql(
      `select
 (select count(*)::int from people where tenant_id=${q(tenant)}) as people,
 (select count(*)::int from contact_points where tenant_id=${q(tenant)}) as endpoints,
 (select count(*)::int from contact_points where tenant_id=${q(tenant)} and (is_primary or verification_state<>'unverified')) as changed_verification,
 (select count(*)::int from learn_business_input_links where tenant_id=${q(tenant)} and entity_kind='contact') as contact_links,
 (select count(*)::int from graph_edges where tenant_id=${q(tenant)} and edge_type='contact_for') as contact_relationships,
 (select count(*)::int from learn_business_input_links where tenant_id=${q(tenant)} and collection='propertyContacts' and external_id in ('403','404')) as held_or_cancelled_links,
 (select count(*)::int from customer_cards where tenant_id=${q(tenant)}) as customer_cards`,
      true,
    )
  )[0];
  check(
    summary.people === 2 &&
      summary.endpoints === 4 &&
      summary.changed_verification === 0 &&
      summary.contact_links === 2 &&
      summary.contact_relationships === 3 &&
      summary.held_or_cancelled_links === 0 &&
      summary.customer_cards === 1,
    "Canonical contact/endpoint/relationship counts differ",
  );
  return { checks, summary };
}
