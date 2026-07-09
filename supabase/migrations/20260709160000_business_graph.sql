-- ServiceOS — Business Graph v1 (the shared memory layer).
--
-- The canonical relationship layer shared by ServiceOS, ProductOS and future
-- OpenFolk products. Everything in the business becomes a NODE (person, company,
-- customer_card, interaction, recommendation, … and later site/job/asset/…), an
-- EDGE (person works_for company, interaction relates_to card, …) or an EVENT
-- (node.created, edge.created, graph.enriched, graph.conflict_detected).
--
-- v1 is a PROJECTION layer: the existing people/companies/customer_cards/
-- interactions/recommendations tables remain the system of record and are NEVER
-- modified. `business-graph-sync` projects them into the graph idempotently, keyed
-- by (source_table, source_id). Non-destructive & additive. There is no graph
-- reasoning engine yet — this is the durable substrate future dashboards, cards,
-- recommendations and automations read from.
--
-- RLS: tenant-scoped SELECT for authenticated users; NO write policies (service
-- role Edge Functions own all writes, bypassing RLS). Reuses set_updated_at()
-- (Phone-0) and current_tenant_id() (Security-2). No cross-tenant edges: both
-- endpoints of an edge are always written under the same tenant_id.

-- ── graph_nodes ────────────────────────────────────────────────────────────
create table if not exists graph_nodes (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  node_type    text not null,                    -- person | company | customer_card | interaction | recommendation | …
  source_table text,                             -- system-of-record table (null for synthetic nodes)
  source_id    uuid,                             -- PK in source_table (null for synthetic nodes)
  external_ref text,                             -- optional external identifier
  label        text,                             -- human label (never secret/content)
  status       text not null default 'active',
  confidence   numeric,                          -- null = unknown (never fabricate certainty)
  properties   jsonb not null default '{}'::jsonb,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One node per system-of-record row (idempotent projection key). Partial because
-- synthetic nodes may have no source.
create unique index if not exists graph_nodes_source_uk
  on graph_nodes (tenant_id, node_type, source_table, source_id)
  where source_id is not null;

create index if not exists graph_nodes_tenant_type_idx on graph_nodes (tenant_id, node_type);
create index if not exists graph_nodes_tenant_source_idx
  on graph_nodes (tenant_id, source_table, source_id);
create index if not exists graph_nodes_tenant_created_idx on graph_nodes (tenant_id, created_at desc);

drop trigger if exists graph_nodes_set_updated_at on graph_nodes;
create trigger graph_nodes_set_updated_at
  before update on graph_nodes
  for each row execute function set_updated_at();

alter table graph_nodes enable row level security;
drop policy if exists graph_nodes_select_tenant on graph_nodes;
create policy graph_nodes_select_tenant on graph_nodes
  for select to authenticated using (tenant_id = current_tenant_id());

-- ── graph_edges ────────────────────────────────────────────────────────────
create table if not exists graph_edges (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  edge_type    text not null,                    -- works_for | contacted | relates_to | represents | concerns | …
  from_node_id uuid not null references graph_nodes (id) on delete cascade,
  to_node_id   uuid not null references graph_nodes (id) on delete cascade,
  confidence   numeric,                          -- 1.0 for direct FK edges; lower for inferred; null = unknown
  evidence     jsonb not null default '[]'::jsonb,
  status       text not null default 'active',
  properties   jsonb not null default '{}'::jsonb,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One edge per (type, from, to) — idempotent.
create unique index if not exists graph_edges_uk
  on graph_edges (tenant_id, edge_type, from_node_id, to_node_id);

create index if not exists graph_edges_tenant_from_idx on graph_edges (tenant_id, from_node_id);
create index if not exists graph_edges_tenant_to_idx on graph_edges (tenant_id, to_node_id);
create index if not exists graph_edges_tenant_type_idx on graph_edges (tenant_id, edge_type);
create index if not exists graph_edges_tenant_created_idx on graph_edges (tenant_id, created_at desc);

drop trigger if exists graph_edges_set_updated_at on graph_edges;
create trigger graph_edges_set_updated_at
  before update on graph_edges
  for each row execute function set_updated_at();

alter table graph_edges enable row level security;
drop policy if exists graph_edges_select_tenant on graph_edges;
create policy graph_edges_select_tenant on graph_edges
  for select to authenticated using (tenant_id = current_tenant_id());

-- ── graph_events ───────────────────────────────────────────────────────────
-- Append-only log of graph mutations (visibility, and the seed for future
-- graph-driven subscribers). No updated_at — events are immutable.
create table if not exists graph_events (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  event_type      text not null,                 -- node.created | node.updated | edge.created | edge.updated | graph.enriched | graph.conflict_detected
  node_id         uuid,                          -- soft ref (no FK: events outlive nodes)
  edge_id         uuid,                          -- soft ref
  source_event_id uuid,                          -- e.g. the platform_events interaction.ready that triggered this
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists graph_events_tenant_type_created_idx
  on graph_events (tenant_id, event_type, created_at desc);
create index if not exists graph_events_tenant_node_idx on graph_events (tenant_id, node_id);
create index if not exists graph_events_tenant_edge_idx on graph_events (tenant_id, edge_id);

alter table graph_events enable row level security;
drop policy if exists graph_events_select_tenant on graph_events;
create policy graph_events_select_tenant on graph_events
  for select to authenticated using (tenant_id = current_tenant_id());
