# Tracking Protocol

> Governs how progress is tracked and verified. Every unit of work traces to a blueprint section, a
> brief requirement, and an eval criterion — so nothing ships unmoored and nothing important is missed.

## K1. The ledger
`docs/governance/TRACKING.md` is the living ledger (mirrored by the session task-list widget). Each
row: `id · unit · blueprint § · brief req · eval criterion · status · verification`.

## K2. Status states
`todo → in_progress → blocked → done`. A unit is **done** only when its **verification gate** passes
(K4). `blocked` records the blocker + what unblocks it.

## K3. Work order (vertical slices, blueprint §8)
1. Foundations: scaffold, `artifact/schema.ts` (+ JSON-Schema export), `safety/`, `evidence/`.
2. Mock bank app (target + chaos + tenants A/B).
3. `surface/` (WebSurface) + `Observation`.
4. Discovery flow (`agent/` + `llm/`, MockLlmProvider first, OpenAI adapter).
5. Replay flow (`replay/` + error taxonomy + recovery).
6. Escalation flow (`escalation/` + minimal operator).
7. Catalog (stretch) + cross-tenant (stretch).
8. Evidence runs (real discovery on Ricky's machine) + README + REPORT.

## K4. Verification gate (Definition of Done, per blueprint §14)
A unit is done when: `tsc --noEmit` clean · its deterministic test passes (MockLlmProvider, offline) ·
it emits the required traces (tracelog-protocol) · it honors allowlist + redaction · it is reachable
from a documented CLI command. Repo DoD: README demo path runs offline (replay); the one real
discovery run's evidence is committed.

## K5. Cadence
Update the ledger + task-list at each slice boundary; persist durable status to the Project. Keep the
`Cuts` list (blueprint §15) current so the REPORT's "what I cut and why" writes itself.
