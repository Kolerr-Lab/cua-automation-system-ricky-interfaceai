# Tracking Ledger

Living status per tracking-protocol §K1. Verification gate = §K4 (tsc clean · test passes · required
traces · allowlist+redaction honored · reachable from CLI).

| id | unit | blueprint § | brief req | eval criterion | status | verification |
|----|------|-------------|-----------|----------------|--------|--------------|
| S1 | Scaffold + schema + safety + evidence | §6,§12,§13 | 3.2,3.4,3.5 | System design, Safety | done | tsc clean · 6 tests green |
| S2 | Mock legacy bank app (chaos + tenants) | §4(D6),§11 | 1,3.3 | Robustness, Generalization | done | tsc clean · 5 Playwright tests green |
| S3 | Surface + WebSurface + Observation | §5,§6.4 | 3.1 | System design | done | tsc clean · 15 tests green (surface: perceive/resolve/fallback/checkpoint) |
| S4 | Discovery flow (agent + LLM) | §8.1 | 3.1 | Core loop correctness | in_progress | — |
| S5 | Replay engine + error taxonomy | §9 | 3.3 | Robustness & error handling | done | 9 taxonomy tests green (success/business×2/recovered×2/escalation/hard/guardrail/cross-tenant) |
| S6 | Escalation + control transfer | §10 | 3.6 | Human-in-the-loop | done | control lease + handoff + resume-on-same-session test green |
| S7 | Catalog + cross-tenant (stretch) | §8.4-8.5,§11 | 8 | Generalization | in_progress | — |
| S8 | Tests + evidence + README + REPORT | §14 | deliverables | Code quality, Communication | todo | — |

Bootstrap for a new session: read `blueprint-protocol.md` → this ledger → the target module.
