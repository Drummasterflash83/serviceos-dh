import { useEffect, useState } from "react";
import { Activity, Database, Network, Radio, AlertTriangle } from "lucide-react";
import { getLearningSnapshot, type LearningSnapshot } from "@/lib/learning-centre";
import { getSystemHealth, type SystemHealthView } from "@/lib/system-health";
import { getSchedulerHealth, type SchedulerHealthItem } from "@/lib/scheduler-health";
import {
  getBusinessGraphSummary,
  listGraphNodes,
  listGraphEdges,
  type GraphNode,
  type GraphEdge,
  type GraphSummary,
} from "@/lib/business-graph";

type Data = {
  learning: LearningSnapshot;
  health: SystemHealthView | null;
  schedulers: SchedulerHealthItem[];
  graph: GraphSummary | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
};
const ago = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Never";

export function LearningCentre() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([
      getLearningSnapshot(),
      getSystemHealth(),
      getSchedulerHealth(),
      getBusinessGraphSummary(),
      listGraphNodes(12),
      listGraphEdges(12),
    ]).then(([learning, health, schedulers, graph, nodes, edges]) => {
      if (!active) return;
      if (!learning.ok) {
        setError(learning.error.message);
        return;
      }
      setData({
        learning: learning.data,
        health: health.ok ? health.data : null,
        schedulers: schedulers.ok ? schedulers.data : [],
        graph: graph.ok ? graph.data : null,
        nodes: nodes.ok ? nodes.data : [],
        edges: edges.ok ? edges.data : [],
      });
    });
    return () => {
      active = false;
    };
  }, []);
  if (error)
    return (
      <Panel>
        <AlertTriangle className="h-4 w-4 text-destructive" />
        Learning data unavailable: {error}
      </Panel>
    );
  if (!data) return <Panel>Loading the company learning pipeline…</Panel>;
  const healthySchedulers = data.schedulers.filter((s) => s.status === "healthy").length;
  return (
    <div className="space-y-6">
      <div>
        <div className="text-display text-xl font-semibold">Learning Centre</div>
        <p className="mt-1 text-sm text-muted-foreground">
          What ServiceOS is receiving, understanding, and turning into durable knowledge.
        </p>
      </div>
      <section>
        <Title icon={Activity}>Overview / Learning health</Title>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Pending interactions" value={String(data.learning.pending)} />
          <Metric label="Enriched interactions" value={String(data.learning.enriched)} />
          <Metric label="Oldest pending" value={ago(data.learning.oldestPendingAt)} small />
          <Metric
            label="Schedulers healthy"
            value={`${healthySchedulers}/${data.schedulers.length}`}
          />
        </div>
        {data.health && (
          <p className="mt-3 text-xs text-muted-foreground">
            Overall pipeline health:{" "}
            <span className="font-medium capitalize text-foreground">{data.health.overall}</span>.
            Last checked {ago(data.health.generatedAt)}.
          </p>
        )}
      </section>
      <section>
        <Title icon={Radio}>Sources</Title>
        <div className="grid gap-2 md:grid-cols-2">
          <Source name="Simwood phone" status="Live" />
          <Source name="Gmail / Google Workspace" status="Live" />
          <Source name="Commusoft · Microsoft 365 · Slack" status="Available to connect" />
          <Source name="Documents / RAG · QuickBooks" status="Planned" />
        </div>
      </section>
      <section>
        <Title icon={Activity}>Learning timeline</Title>
        <div className="rounded-2xl border border-hairline bg-white divide-y divide-hairline">
          {data.learning.events.length ? (
            data.learning.events.map((e) => (
              <div key={e.id} className="flex items-start justify-between gap-4 p-3 text-sm">
                <div>
                  <span className="mr-2 text-[10px] font-semibold uppercase text-muted-foreground">
                    {e.kind}
                  </span>
                  {e.label}
                </div>
                <time className="shrink-0 text-xs text-muted-foreground">{ago(e.at)}</time>
              </div>
            ))
          ) : (
            <div className="p-5 text-sm text-muted-foreground">
              No recorded learning events yet.
            </div>
          )}
        </div>
      </section>
      <section>
        <Title icon={Network}>Knowledge / Business Graph</Title>
        {data.graph ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Nodes" value={String(data.graph.totalNodes)} />
              <Metric label="Relationships" value={String(data.graph.totalEdges)} />
              <Metric
                label="Latest graph event"
                value={ago(data.graph.latestEvent?.created_at ?? null)}
                small
              />
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <Panel>
                <div>
                  <b>Recent entities</b>
                  {data.nodes.map((n) => (
                    <div key={n.id} className="mt-2 text-xs text-muted-foreground">
                      {n.node_type} · {n.label || n.id}
                    </div>
                  ))}
                </div>
              </Panel>
              <Panel>
                <div>
                  <b>Recent relationships</b>
                  {data.edges.map((e) => (
                    <div key={e.id} className="mt-2 text-xs text-muted-foreground">
                      {e.edge_type} · confidence {e.confidence ?? "unknown"}
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </>
        ) : (
          <Panel>Business Graph is unavailable in this environment.</Panel>
        )}
      </section>
    </div>
  );
}
function Title({ icon: Icon, children }: { icon: typeof Database; children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
      <Icon className="h-4 w-4 text-muted-foreground" />
      {children}
    </h2>
  );
}
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-2xl border border-hairline bg-white p-5 text-sm text-muted-foreground">
      {children}
    </div>
  );
}
function Metric({
  label,
  value,
  small = false,
}: {
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <div className="rounded-xl border border-hairline bg-white p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={small ? "mt-1 text-sm font-semibold" : "text-display mt-1 text-xl font-bold"}>
        {value}
      </div>
    </div>
  );
}
function Source({ name, status }: { name: string; status: string }) {
  const live = status === "Live";
  return (
    <div className="flex items-center justify-between rounded-xl border border-hairline bg-white p-3 text-sm">
      <span>{name}</span>
      <span className={live ? "text-success" : "text-muted-foreground"}>{status}</span>
    </div>
  );
}
