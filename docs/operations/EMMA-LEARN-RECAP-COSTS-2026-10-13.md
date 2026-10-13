# Emma LEARN recap and provider costs — 13 October 2026

## Live behaviour

- LEARN offers **Hear Emma’s recap**, with a readable preview and a user-started,
  recorded voice session. Counts are checked again at session start through the
  signed-in user's tenant-filtered RLS access. Unknown counts stay unknown.
- The recap covers saved emails, calls, recording records, Slack messages and
  visible voicemails. It distinguishes collected information from complete
  historical coverage, playable audio and completed analysis. Future benefits
  are described as possibilities. No costs are narrated.
- Quantities are spelled out before text-to-speech in British English: 4,454 is
  “four thousand four hundred and fifty-four”. Telephone-number and postcode
  guidance remains distinct. Emma keeps her existing voice and 1.05 speed.
- AI Receptionist's overview shows Vapi-reported USD costs today and this month,
  using London date boundaries and refreshing every minute while open. The
  published assistant is the scope; separate in-app practice/recaps, other
  assistants, separately billed phone plans, taxes and OpenFolk fees are excluded.
  These are provisional provider usage totals, not a customer invoice.
- Only supported Vapi aggregates are requested: `sum(cost)` and `count(id)`,
  grouped by assistant ID. `count(cost)` and `sum(minutesUsed)` were rejected by
  Vapi and are not used. Unreported minutes/pending-cost counts remain unknown.
  Provider errors show unavailable, never an invented zero.

## Verification

- Initial frontend deployed from Git `54cd6001a081c328c9b490ba7b0512d2bcad82ee`,
  Vercel deployment `dpl_5fXdTZQh6pZf7VkCnEqn1eFy4E1s`, with existing live aliases
  verified after promotion. The frontend and both production endpoints were
  released separately.
- Final frontend polish (nullable provider counts, singular call labels and
  panel spacing) deployed from `ac4810b38067c38005f761c057c290645b0a0177` as
  `dpl_BvP3y1kBsr9wcLxrXVESEB6HqL6x`; promotion to the existing live aliases
  passed the release adapter's readback. All 36 focused tests passed.
- Production `receptionist-practice` v15 and `receptionist-calls` v15 contain the
  corrected spoken quantities and working aggregate request respectively.
  Source readback matches the candidate; unauthenticated requests return 401.
- Signed-in live preview visibly spells all five totals as quantities. The live
  cost view returned provider totals on 13 October at 15:02 London time: zero
  reported USD, zero calls today and one published-assistant call this month.
  This does not imply that separate in-app practice sessions were free.
- Recap, tenant scoping, cost isolation, numeric response parsing, London time
  boundaries, safe practice projection and speech tests pass. TypeScript and
  the initial frontend build pass. Actual corrected audio remains for the user
  to listen to; no new call was started by the agent for verification.
- Private rollback source and execution evidence are retained under ignored
  `.verification-results/emma-recap-costs-20261013*`. No credential, customer
  communication, call recording or private execution manifest is committed.

Main-number routing, capture schedules and source history were not changed.
