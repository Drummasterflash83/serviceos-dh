# Frontend Principles

_The rules that keep the product surface honest and coherent. They exist to prevent
the one failure mode that turns an operating system back into an app: feature
accumulation. Read alongside [09_NAVIGATION](09_NAVIGATION.md), which these
principles govern._

---

## The one rule everything else serves

**The UI must reflect the system architecture, never accumulate features.**

A screen is not a container you add things to. It is the surface of one
[architectural concern](01_PLATFORM.md), answering one question. When the product
grows, the architecture grows, and the UI follows; the UI never grows on its own by
collecting widgets. Every earlier version of this product drifted the other way, into
~27 nav items of mostly demo screens, and the
[frontend audit](../archive/FRONTEND_ALIGNMENT_AUDIT.md) is the record of what that
costs. These principles are how it does not happen again.

---

## One purpose per screen
Every screen answers exactly one question ([the eight](09_NAVIGATION.md)). If a
feature would make a screen answer a second question, it belongs on the screen that
owns that question, or behind a panel, not bolted on. "What needs my attention?" and
"what conversations are happening?" are different questions and therefore different
screens, even though both touch calls. The test for any new UI: **which single
question does this help answer?** If the honest answer is "a few", it is designed
wrong.

## No duplicated intelligence
There is one [intelligence pipeline](04_AI_ARCHITECTURE.md) and it surfaces in one
place per purpose. The Command Centre is where the loop's understanding becomes "what
to do now"; other screens *read* that intelligence, they do not re-derive it. A
second screen computing its own risk score, its own priority, its own recommendations
is not a feature, it is a contradiction waiting to confuse a user about which number
is true. Intelligence is computed once, in the backend, and displayed wherever
needed, never recomputed in a component.

## No duplicated actions
An action exists in exactly one place. Approving a proposed action happens in the
[Command Centre](09_NAVIGATION.md); it is not also possible from three other screens
with subtly different behaviour. Where an action is relevant on multiple surfaces, it
is the *same* action (same Edge Function, same [Automation Intent](../reference/AUTOMATION_ENGINE.md),
same audit trail), surfaced in context, never a parallel implementation. Two buttons
that do "the same thing" slightly differently is a defect.

## No duplicated navigation
There is one way to reach each thing. The platform is a single app shell with one
nav; a capability appears in one screen's IA, not in two sections "to be helpful".
The audit found two Operations surfaces and two Communications surfaces (email trapped
in admin); that duplication is exactly what this principle forbids. If something seems
to belong in two places, its home is wherever its [owning question](09_NAVIGATION.md)
lives, and the other place links to it.

## No duplicated ownership
Every surface has one owning concern and one backing capability, and it names it. A
screen does not half-own data that another screen also half-owns. When the audit found
two customer-card modules and orphaned tables with no reader, those were ownership
failures: data with no single home, or two homes. Each screen owns its question; each
piece of data has one authoritative source ([one source of truth](01_PLATFORM.md)); no
screen reaches around another's ownership.

---

## Never a beautiful UI with fake data
This principle is severe on purpose. **A polished screen showing fabricated numbers is
worse than no screen**, because it teaches users that the product's data cannot be
trusted, which poisons the screens that are real. Therefore:

- Every surface **names its backing capability**. If there is a real backend, wire it.
- If there is no backend, the surface is an **honest Preview/Labs placeholder**, not a
  hardcoded array dressed as production. "Not connected" is an acceptable thing to
  show; "342 documents indexed" when nothing is indexed is not.
- A component is never deleted without [mapping where its concern goes](09_NAVIGATION.md);
  nothing with a real backend is demoted to Preview, and nothing without one is faked.

## A surface tells a story, not a table
The difference between a CRM and an operating system shows up here. A surface should
say "ServiceOS understands your customer conversations and tells you what matters", not
"you are looking at the calls table". The Command Centre passes this test; the target
is that Customers, Communications, and Knowledge pass it too, using data that already
exists. If a screen is just a grid of rows, it is displaying data, not reflecting
understanding, and the understanding is what the platform is for.

---

## Reuse the platform, never fork it
Frontend work reuses the existing patterns, one query layer (`ApiResult<T>` +
`getSupabaseClient()`), one auth model, the intelligence objects, the Command Centre
architecture. No parallel data layers, no client-side table mutations (writes go
through Edge Functions), no second way to do a thing the platform already does. A new
surface is composition of existing capability, not a new stack beside it. This is
[design principle 10 (composable systems)](01_PLATFORM.md) applied to the UI: the
frontend grows by subscribing to what the backend already narrates.

---

## Why these are strict
Every one of these principles trades short-term convenience for long-term coherence.
It is always faster, in the moment, to add one more widget, recompute one more number
in a component, put one more button on one more screen, or ship a pretty mock. The
sum of those conveniences is the ~27-item demo deck the audit had to unwind. An
operating system earns the name by staying legible as it grows, and it only stays
legible if the surface keeps reflecting the architecture. These principles are how the
frontend keeps that promise.
