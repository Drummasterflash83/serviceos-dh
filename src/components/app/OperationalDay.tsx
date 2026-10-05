/**
 * Mary's First Day — read-only render of the seven operational focus areas, generated from
 * CONFIRMED evidence only. Display-only (no actions ⇒ inherently read-only). Where confirmed
 * evidence does not exist the area shows an honest gap, never fabricated activity.
 */
import type { ReactNode } from "react";
import { Bell, Clock, Hourglass, HeartPulse, Wrench, ShieldCheck, Lightbulb } from "lucide-react";
import { SectionCard, StatusPill, EmptyState, type Tone } from "./openfolk-ui";
import type {
  OperationalDay as Day,
  DayItem,
  DayHealthFinding,
  DayGap,
} from "@/lib/operational-day";

const CONF_TONE: Record<string, Tone> = {
  high: "ok",
  medium: "info",
  low: "attention",
  unresolved: "neutral",
};
const STATE_TONE: Record<string, Tone> = {
  critical: "risk",
  at_risk: "attention",
  watch: "info",
  recovering: "ok",
};
const OWN_TONE: Record<string, Tone> = { info: "neutral", attention: "attention", risk: "risk" };

function Conf({ level }: { level: string }) {
  return <StatusPill tone={CONF_TONE[level] ?? "neutral"}>{level}</StatusPill>;
}

/** A card that shows its items, or an honest gap explaining why it is empty. */
function AreaCard({
  title,
  icon,
  count,
  gap,
  children,
}: {
  title: string;
  icon: ReactNode;
  count: number;
  gap?: DayGap;
  children: ReactNode;
}) {
  return (
    <SectionCard title={title} icon={icon} right={count > 0 ? String(count) : undefined}>
      {count > 0 ? (
        children
      ) : (
        <EmptyState tone="neutral">{gap?.reason ?? "Nothing here."}</EmptyState>
      )}
    </SectionCard>
  );
}

function ItemRow({ item }: { item: DayItem }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-hairline py-1.5 last:border-0 text-xs">
      <span className="font-medium text-display">{item.title}</span>
      <Conf level={item.confidence} />
      <span className="text-muted-foreground">{item.why}</span>
      {item.refs && <span className="text-muted-foreground/70">· {item.refs}</span>}
      {item.dueAt && (
        <span className="ml-auto text-muted-foreground/70">
          due {new Date(item.dueAt).toLocaleDateString()}
        </span>
      )}
    </div>
  );
}

function HealthRow({ h }: { h: DayHealthFinding }) {
  return (
    <div className="border-b border-hairline py-2 last:border-0 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={STATE_TONE[h.state] ?? "neutral"}>{h.state.replace("_", " ")}</StatusPill>
        <span className="font-medium text-display">{h.subject}</span>
        <span className="text-muted-foreground">{h.driver}</span>
        <Conf level={h.confidence} />
      </div>
      <div className="mt-0.5 text-muted-foreground">
        {h.evidence}
        {h.owner && <span> · owner {h.owner}</span>}
        {h.waitingOn && <span> · waiting on {h.waitingOn}</span>}
      </div>
      {h.intervention && <div className="mt-0.5 text-accent">→ {h.intervention}</div>}
    </div>
  );
}

export function OperationalDay({ day }: { day: Day }) {
  const gapByArea = (needle: string) => day.gaps.find((g) => g.area.includes(needle));
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <AreaCard
          title="Needs me now"
          icon={<Bell className="h-4 w-4 text-muted-foreground" />}
          count={day.needsMeNow.length}
          gap={gapByArea("Commitments")}
        >
          {day.needsMeNow.map((i) => (
            <ItemRow key={i.id} item={i} />
          ))}
        </AreaCard>

        <AreaCard
          title="Suggested interventions"
          icon={<Lightbulb className="h-4 w-4 text-muted-foreground" />}
          count={day.interventions.length}
          gap={{ area: "", reason: "No interventions proposed yet." }}
        >
          {day.interventions.map((iv, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-2 border-b border-hairline py-1.5 last:border-0 text-xs"
            >
              <span className="text-accent">→</span>
              <span className="font-medium text-display">{iv.title}</span>
              <Conf level={iv.confidence} />
              <span className="text-muted-foreground">{iv.reason}</span>
              <span className="ml-auto text-muted-foreground/60">{iv.area}</span>
            </div>
          ))}
        </AreaCard>

        <AreaCard
          title="Waiting on me"
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
          count={day.waitingOnMe.length}
          gap={gapByArea("Waiting")}
        >
          {day.waitingOnMe.map((i) => (
            <ItemRow key={i.id} item={i} />
          ))}
        </AreaCard>

        <AreaCard
          title="I am waiting on"
          icon={<Hourglass className="h-4 w-4 text-muted-foreground" />}
          count={day.iAmWaitingOn.length}
          gap={gapByArea("Waiting")}
        >
          {day.iAmWaitingOn.map((i) => (
            <ItemRow key={i.id} item={i} />
          ))}
        </AreaCard>

        <AreaCard
          title="Customer Health"
          icon={<HeartPulse className="h-4 w-4 text-muted-foreground" />}
          count={day.customerHealth.length}
          gap={gapByArea("Customer Health")}
        >
          {day.customerHealth.map((h) => (
            <HealthRow key={h.id} h={h} />
          ))}
        </AreaCard>

        <AreaCard
          title="Job Health"
          icon={<Wrench className="h-4 w-4 text-muted-foreground" />}
          count={day.jobHealth.length}
          gap={gapByArea("Job Health")}
        >
          {day.jobHealth.map((h) => (
            <HealthRow key={h.id} h={h} />
          ))}
        </AreaCard>
      </div>

      <SectionCard
        title="Ownership Health"
        icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}
        right={day.ownershipHealth.length ? String(day.ownershipHealth.length) : undefined}
      >
        {day.ownershipHealth.length === 0 ? (
          <EmptyState tone="neutral">No ownership evidence.</EmptyState>
        ) : (
          <div className="space-y-1">
            {day.ownershipHealth.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <StatusPill tone={OWN_TONE[s.severity]}>{s.kind.replace("_", " ")}</StatusPill>
                <span className="text-display">{s.detail}</span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <p className="rounded-lg border border-dashed border-hairline bg-surface-alt/40 px-3 py-2 text-[11px] text-muted-foreground">
        Generated from <strong>confirmed evidence only</strong>
        {day.confirmedSources.length ? ` (${day.confirmedSources.join(", ")})` : ""}. Empty areas
        are honest gaps where confirmed evidence does not yet exist — never fabricated activity.
      </p>
    </div>
  );
}
