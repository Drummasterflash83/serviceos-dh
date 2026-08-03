/**
 * Marketing form kit — the ONE place the Marketing surfaces get their form
 * language from (StoryBrand pass, launch correction).
 *
 * The customer is the hero; ServiceOS is the guide. Every journey screen must
 * make three things obvious at a glance: the goal, the next action, and what
 * will happen. These primitives carry that:
 *
 *  - marketingInputCls  — ONE input treatment with a clearly visible boundary
 *    (the old border-hairline fields read as invisible on white) and ONE focus
 *    style, replacing the three divergent per-file variants;
 *  - FormSection        — a visibly bounded, titled group so it is never
 *    unclear where a form starts and ends;
 *  - JourneySteps       — the numbered customer journey (create → audience →
 *    test → review → send), shown on both the form and the detail view so the
 *    next action is always stated;
 *  - TechnicalDetails   — governance/engineering truth kept AVAILABLE but
 *    secondary, inside a collapsed disclosure, never as the primary
 *    instruction.
 */
import { cn } from "@/lib/utils";

/** Visible field boundary + one consistent focus treatment. */
export const marketingInputCls =
  "w-full rounded-lg border border-foreground/25 bg-white px-3 py-2 text-sm text-foreground " +
  "placeholder:text-muted-foreground/70 outline-none transition " +
  "focus:border-accent focus:ring-2 focus:ring-accent/20";

/** Same boundary for selects/textareas that append their own classes. */
export const marketingFieldBorderCls = "border border-foreground/25";

export function FormSection({
  step,
  title,
  description,
  children,
  className,
}: {
  /** optional journey step number rendered as a chip */
  step?: number;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-foreground/15 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]",
        className,
      )}
    >
      <div className="mb-3 flex items-start gap-2 border-b border-hairline pb-2">
        {step !== undefined && (
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background">
            {step}
          </span>
        )}
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export interface JourneyStep {
  title: string;
  /** one plain sentence about what happens in this step */
  hint?: string;
}

/**
 * The numbered customer journey. `current` highlights the step the user is on;
 * steps below `done` render as completed. Wraps on small screens.
 */
export function JourneySteps({
  steps,
  current,
  done = current,
  className,
}: {
  steps: JourneyStep[];
  /** 0-based index of the active step */
  current: number;
  /** number of steps already completed (defaults to `current`) */
  done?: number;
  className?: string;
}) {
  return (
    <ol className={cn("flex flex-wrap gap-2", className)} aria-label="Your journey">
      {steps.map((s, i) => {
        const state = i < done ? "done" : i === current ? "current" : "todo";
        return (
          <li
            key={s.title}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
              state === "done" && "border-success/30 bg-success/10 text-success",
              state === "current" && "border-foreground bg-foreground text-background",
              state === "todo" && "border-hairline bg-white text-muted-foreground",
            )}
            title={s.hint}
            aria-current={state === "current" ? "step" : undefined}
          >
            <span
              className={cn(
                "flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold",
                state === "done" && "bg-success/20 text-success",
                state === "current" && "bg-background/20 text-background",
                state === "todo" && "bg-surface-alt text-muted-foreground",
              )}
            >
              {i < done ? "✓" : i + 1}
            </span>
            {s.title}
          </li>
        );
      })}
    </ol>
  );
}

/** Governance/engineering detail — available, never the primary instruction. */
export function TechnicalDetails({
  summary = "Technical details",
  children,
  className,
}: {
  summary?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <details className={cn("group rounded-lg border border-hairline bg-surface-alt/60", className)}>
      <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-medium text-muted-foreground transition hover:text-foreground">
        {summary}
      </summary>
      <div className="border-t border-hairline px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </details>
  );
}
