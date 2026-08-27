# Blueprint Protocol — Source of Truth

> **Authority.** This document is the single source of truth for the system. Code, schemas,
> APIs, and the other four protocols (prompt, tracelog, context-window, tracking) **conform to
> this file**. If code and blueprint disagree, the blueprint wins or the blueprint is amended —
> never silently diverged. Nothing is scaffolded or coded until this file is **LOCKED**.
>
> **Change control.** Amendments require: (1) a one-line rationale appended to §14 Changelog,
> (2) a version bump below. Downstream files reference blueprint section numbers, not prose.
>
> **Status:** `LOCKED (2026-08-27)`  ·  **Blueprint version:** `1.0.0`

---

## 1. Problem, in one paragraph

interface.ai builds AI agents for banks and credit unions. Many core back-office apps have **no
API** — the only way in is to drive the UI like a human operator. This system is the layer that
gives an agent *hands*: an LLM **discovers** how to complete a natural-language goal on a live UI
once; the successful run is recorded as a **typed, versioned, reusable capability artifact**
decoupled from the model transcript; and that artifact is **replayed deterministically with no LLM
in the loop** — the path a production agent triggers. It handles runtime errors and exceptional
states explicitly, escalates to a human on the same live session when stuck, and stays within
safety guardrails. **The model discovers. The artifact becomes a capability. Deterministic replay
is how the agent invokes it.**

## 2. What the reviewers actually weigh (design targets)

Ordered by the brief's §7. Every decision below is justified against this list.

1. **System design** — artifact schema + replay contract are central. *(§6, §7)*
2. **Correctness of the core loop** — a real LLM run completes a real goal. *(§8.1)*
3. **Robustness & error handling** — the error taxonomy; business-outcome vs recoverable vs hard-failure. *(§7.4, §9)*
4. **Human-in-the-loop escalation** — real control transfer on the *same* session. *(§8.3, §10)*
5. **Generalization** — heterogeneous surfaces + multi-tenant reuse. *(§11)*
6. **Safety & data handling** — allowlist, risky-action policy, redaction. *(§12)*
7. **Code quality** — small, typed, tested where it counts. *(§13, §15)*
8. **Communication** — REPORT.md makes the reasoning legible. *(deliverable)*

> Explicit anti-goal (brief §7): we do **not** reward feature breadth or scaling infrastructure
> (queues/clusters). We design abstractions that *could* scale; we do not prematurely build them.

## 3. Load-bearing decisions (each defensible in interview)

| # | Decision | Choice | Why (short) |
|---|----------|--------|-------------|
| D1 | Language / runtime | **TypeScript + Node 22** | Playwright is first-class; static types make the *typed artifact* real; Zod gives runtime-validated schemas + JSON-Schema export. |
| D2 | Computer-use tech | **Playwright, headed Chromium** | Real browser, frame support, exposes the **accessibility tree** — which maps directly onto the desktop-AX generalization story (§11). |
| D3 | Perception bias | **Accessibility tree + label/row anchoring, NOT test IDs** | Legacy apps have no test IDs. Robustness must come from *intent-level* signals that survive next month (§6.4). |
| D4 | LLM provider | **OpenAI (pluggable `LlmProvider`)** | Ricky's key. Provider is an interface; a `MockLlmProvider` drives all dev/tests deterministically and offline. |
| D5 | Where the real run executes | **Local machine** | This sandbox blocks egress to api.openai.com. The discovery CLI runs on Ricky's machine with `OPENAI_API_KEY`; everything else (build, tests, replay) is offline. |
| D6 | Primary target surface | **Locally-built *hostile legacy* mock bank app** | Lets us **inject** the exact runtime error/exceptional states the eval hinges on, is reproducible with no live services, mirrors their real world (frameset, nested tables, no test IDs), and enables the multi-tenant proof. *(§4 for the trade-off vs a public site.)* |
| D7 | Secondary surface | **One public sandbox site (design-level generalization probe)** | Proves the `Surface` abstraction isn't overfit to our own app. Kept thin; depth stays on the mock. |
| D8 | Determinism | **Ranked locator fallbacks + invariant checks + explicit waits/checkpoints; no wall-clock, no model** | Replay resolves targets by priority, asserts invariants, waits on state not time (§9). |
| D9 | Architecture | **Single process, layered modules, dependency-inverted at the `Surface` and `LlmProvider` seams** | Brief: "simpler is fine if justified." No services/queues; clean seams instead. |

## 4. Scope — in / out / mocked (with the one real thing)

**Built for real**
- Discovery agent loop against a live surface, driven by a real LLM (D4/D5).
- Typed capability artifact (schema §6) with Zod validation + JSON-Schema export.
- Deterministic replay engine + full error taxonomy + result contract (§9).
- Safety: allowlist enforcement, risk policy, redaction (§12).
- Escalation: real control-transfer state machine + intervention request + resume on the *same* session (§10).
- Evidence/observability: structured JSONL traces + failure screenshots (§ tracelog-protocol).
- Stretch, on-theme, built: **capability catalog** (typed, agent-callable) and **cross-tenant reuse demo** (record on tenant A → replay on rebranded tenant B).

**Designed, not fully built (documented seams)**
- Desktop / accessibility-tree surface (interface described, web surface implemented) — §11.
- Full real-time co-browsing operator console — a minimal but real handoff is built; the rich console is mocked — §10 scope note.
- Multi-tenant infrastructure at scale (hundreds of tenants) — abstraction only, no plumbing.

**The one non-negotiable (brief §4).** At least one genuine LLM-driven discovery run against the
live surface, with evidence in `/evidence/`. Trade-off recorded: we chose a controllable hostile
mock over a public site to make the error taxonomy demonstrable and the run reproducible; a public
site would instead prove "works on a surface we didn't control." The discovery run is still real
(real browser + real model).

## 5. Architecture — modules & dependency direction

Dependencies point **inward** toward the domain; `Surface` and `LlmProvider` are inverted seams.

```
                 ┌────────────── cli / api (thin) ──────────────┐
                 │  discover · replay · catalog · serve-mock ·   │
                 │  operator                                     │
                 └───────────────────────────────────────────────┘
                        │              │             │
                   ┌────▼────┐   ┌─────▼─────┐  ┌────▼─────┐
                   │  agent  │   │  replay   │  │ catalog  │   application layer
                   │ (loop)  │   │ (executor)│  │ (invoke) │
                   └────┬────┘   └─────┬─────┘  └────┬─────┘
                        │              │             │
          ┌─────────────┼──────────────┼─────────────┼──────────────┐
          │        ┌────▼──────────────▼────┐   ┌─────▼─────┐        │
          │        │  artifact (schema/store)│   │ escalation│        │  domain layer
          │        └───────────┬────────────┘   │ (control) │        │
          │        ┌───────────▼────────────┐   └───────────┘        │
          │        │ safety (allowlist/risk/ │                        │
          │        │ redaction)             │                        │
          │        └────────────────────────┘                        │
          └───────────────────────┬───────────────────────────────── ┘
                     ┌────────────▼─────────────┐   ┌───────────────┐
                     │ Surface (interface)      │   │ LlmProvider   │  inverted seams
                     │  └ WebSurface (Playwright)│   │  └ OpenAI     │
                     │                          │   │  └ Mock       │
                     └──────────────────────────┘   └───────────────┘
   evidence/tracelog is a cross-cutting sink written by agent, replay, escalation.
   mock-bank/ is a separate runnable target app, not imported by the system.
```

Module responsibilities:

- **`surface/`** — `Surface` interface: `perceive()→Observation`, `act(Action)`, `locate(LocatorBundle)→Handle`, `screenshot()`, `snapshotDom()`, navigation, frame traversal. `WebSurface` implements it over Playwright. **This is the only place that knows about Playwright.**
- **`llm/`** — `LlmProvider` interface (`decide(prompt)→AgentAction`), `OpenAiProvider`, `MockLlmProvider`.
- **`agent/`** — the observe→decide→act discovery loop; turns a successful run into a `Capability` by synthesizing `LocatorBundle`s from perception signals (not from the transcript).
- **`artifact/`** — Zod schemas (§6), JSON-Schema export, load/save/version store, checksum.
- **`replay/`** — deterministic executor; resolves locators with fallbacks, waits on checkpoints, applies recovery rules, produces `ReplayResult` (§9). **No import of `llm/`.**
- **`safety/`** — allowlist gate, risk classifier, redaction. Called by both agent and replay before act/persist.
- **`escalation/`** — `SessionController` (control lease + state machine), `InterventionRequest`, resume + human-action capture (§10).
- **`catalog/`** — loads artifacts, validates typed args, `invoke(name,args)`→replay. Agent-facing capability surface (stretch).
- **`evidence/`** — trace sink (JSONL) + snapshot writer, redaction-aware. Contract in tracelog-protocol.
- **`tenant/`** — `TenantProfile` (base URL, branding overrides), route canonicalization, drift signals (§11).
- **`cli/`** — thin command wiring only; no business logic.
- **`mock-bank/`** — standalone Express legacy app + chaos injection + two tenants. Runnable, not imported.

## 6. Domain model & the artifact schema (THE focal point)

TypeScript-shaped; the source of truth is the Zod schema in `artifact/schema.ts`, which exports
JSON Schema to `/schema/capability.schema.json`.

### 6.1 Capability (the artifact)
```ts
Capability {
  schemaVersion: "1.0.0"          // schema evolution, independent of capability version
  capabilityId: string            // stable, e.g. "member.read-savings-balance"
  version: string                 // semver; bumped when re-recorded or edited
  name: string
  description: string             // human- AND agent-readable
  labels: string[]
  target: {
    appFamily: string             // vendor product identity, e.g. "acme-corebanking" — NOT a tenant URL
    surfaceKind: "web" | "desktop"
    entryPoint: string            // canonicalized route; tenant base injected at replay (§11)
    compatibleVersions?: string   // semver range known-good
  }
  inputs:  Param[]                 // typed parameters supplied per invocation
  outputs: OutputField[]          // typed extraction contract
  steps:   Step[]                 // ordered actions
  successCondition: Checkpoint    // goal-level "did we actually get there"
  businessOutcomes: BusinessOutcome[]  // declared expected non-success results
  guardrails: { allowlist: { routes: string[]; actions: ActionType[] } }
  provenance: {
    discoveredBy: { provider: string; model: string }
    discoveredAt: string          // ISO
    sourceRunId: string           // pointer into /evidence — transcript is NOT inlined
    evidenceRef: string
    checksum: string              // integrity of steps+schema
  }
}
```

### 6.2 Parameters & outputs (typed contract)
```ts
Param  { name; type:"string"|"number"|"boolean"|"enum"; required:boolean;
         description; example?; enumValues?; sensitive:boolean }   // sensitive ⇒ redaction (§12)
OutputField { name; type; description;
              source:{ fromStepId; extract:"text"|"value"|"attribute"; attribute? } }
```

### 6.3 Step
```ts
Step {
  id; intent;                     // human sub-goal, e.g. "open the member's savings sub-account"
  action: Action;                 // navigate | click | type | select | read | waitFor | assert
  target?: LocatorBundle;         // omitted for navigate
  inputBinding?: { param:string };// which input feeds this type/select (redacted in logs if sensitive)
  literalValue?: string;          // fixed, non-secret value
  precondition?:  Checkpoint;     // gate before acting (wait on state)
  postcondition?: Checkpoint;     // verify the action landed
  risk: "safe" | "sensitive" | "irreversible";
  policy: "auto" | "confirm" | "block";   // resolved vs safety config at plan time
  recover: RecoveryRule[];        // expected recoverable conditions here
}
```

### 6.4 LocatorBundle — the robustness strategy (why replay survives next month)
Each target records **multiple ordered signals**, robust→brittle; replay tries them in order,
validates `invariants`, and logs any fallback as a **drift signal** (§11).
```ts
LocatorBundle {
  strategies: Locator[]           // ORDERED priority
  framePath?: string[]            // frame/iframe traversal for legacy shells
  invariants: { role?; name?; editable?; visible? }   // must hold post-resolution
}
Locator =
  | { by:"role";       role; name; exact? }            // accessibility tree — most stable, cross-surface
  | { by:"label";      label; scope? }                 // "the field labeled X"
  | { by:"rowAnchor";  header; cell; targetCol }        // "row whose {header} cell = {cell}"
  | { by:"attr";       name; value }                    // id/name if present
  | { by:"text";       text; exact? }
  | { by:"structural"; css; index }                     // last resort, explicitly brittle
```
Design intent: the artifact records **what a human operator would say** ("the Savings Balance field
in the member's account row"), not a DOM path or the raw model transcript. That decoupling is the
seam between "how we perceive/act on a surface" and "the recorded flow."

### 6.5 Actions, checkpoints, business outcomes, recovery
```ts
Action =
  | { type:"navigate"; to }        | { type:"click" }
  | { type:"type"; }               | { type:"select"; }
  | { type:"read" }                | { type:"waitFor"; checkpoint }
  | { type:"assert"; checkpoint }
ActionType = Action["type"]

Checkpoint =
  | { kind:"urlMatches"; pattern }        | { kind:"elementVisible"; locator }
  | { kind:"textPresent"; text; scope? }  | { kind:"textAbsent"; text }
  | { kind:"valueEquals"; locator; value }

BusinessOutcome {                  // "no such member" is a RESULT, not a crash (brief glossary)
  code: string                     // e.g. "member_not_found"
  detect: Checkpoint               // how replay recognizes it
  returns?: Record<string,unknown> // typed shape returned to caller
  terminal: boolean                // legit stop
}

RecoveryRule {                     // bounded, deterministic — never open-ended
  when: Checkpoint                 // e.g. known interstitial present
  do: "dismiss" | "retry" | "reauth"
  target?: LocatorBundle
  maxAttempts: number
}
```

## 7. (reserved — evaluation mapping lives in §16)

## 8. Flow inventory (the vertical slices)

**8.1 Discovery flow** (real LLM): input `goal + target` → `agent` loops
`Surface.perceive()` → build `Observation` (salient interactive elements w/ role, accessible name,
label/row anchors, frame path) → `LlmProvider.decide()` returns one structured `AgentAction`
(referencing an observed element id, never a raw selector) → `safety` gate → `Surface.act()` →
checkpoint → repeat until `successCondition` or stop (max steps / timeout / dead-end). On success,
`agent` synthesizes each `Step.target` `LocatorBundle` from the captured perception signals and
emits a `Capability`. Every turn is traced to `/evidence`.

**8.2 Replay flow** (no LLM): input `capability + inputs` → validate inputs vs `Param[]` →
`replay` walks steps: resolve `LocatorBundle` (ranked, invariant-checked), apply `precondition`
waits, act, verify `postcondition`, run `RecoveryRule`s on known conditions, detect
`businessOutcomes`, extract `outputs` → return `ReplayResult` (§9). Deterministic, offline.

**8.3 Escalation flow**: replay/agent hits `stuck | risky_confirmation | unrecoverable` →
`escalation.SessionController` raises `InterventionRequest`, cedes the control lease to `HUMAN`,
pauses → human acts in the **same** headed browser session → operator signals resume → controller
captures what the human did, restores lease to `AGENT/REPLAY`, run continues. Evidence preserved
across the seam (§10).

**8.4 Catalog invoke flow** (stretch): `catalog.list()` exposes capabilities as typed callables;
`catalog.invoke(capabilityId, args)` validates args vs `Param[]` and runs replay — an agent calls a
capability by name with typed args.

**8.5 Cross-tenant flow** (stretch): a capability recorded against tenant A is replayed against
tenant B via a `TenantProfile` (base URL + branding overrides); route canonicalization + locator
fallbacks absorb the difference; drift signals are recorded (§11).

## 9. Determinism, error taxonomy & result contract

Replay is deterministic because: (a) targets resolve by **ranked strategy with invariant checks**,
not a single brittle selector; (b) all waiting is on **state/checkpoints**, never wall-clock; (c)
**no model** participates. The result contract classifies every run:

```ts
ReplayResult =
  | { status:"success";            outputs; recovery?; evidenceRef }
  | { status:"business_outcome";   code; returns; evidenceRef }        // expected, legitimate
  | { status:"hard_failure";       failure:{ stepId; category; expected; observed; evidenceRef } }
  | { status:"escalation_required";intervention: InterventionRequest }

FailureCategory =
  "LOCATOR_UNRESOLVED" | "CHECKPOINT_FAILED" | "UNEXPECTED_STATE" |
  "TIMEOUT" | "GUARDRAIL_BLOCKED" | "PROVIDER_ERROR"
```

Three-way discipline the brief calls the "most common design mistake":
- **Expected business outcome** (`member_not_found`) → `business_outcome`, returned to caller, not an error.
- **Recoverable condition** (known interstitial, transient slow/5xx) → handled inline by a bounded `RecoveryRule`, logged as `recovery`, run continues.
- **Hard failure** (locator unresolved after all fallbacks, checkpoint mismatch, unexpected state, timeout, blocked) → stop with a debuggable `failure{stepId, expected, observed, evidence}`.

## 10. Escalation & control-transfer model

`SessionController` owns a **control lease**: `controlOwner ∈ {AGENT, HUMAN}` with states
`RUNNING → PAUSED(await_human) → HUMAN_CONTROL → RESUMING → RUNNING|DONE`. It is the single writer
of "who is in control." On escalation it builds an `InterventionRequest`:
```ts
InterventionRequest {
  id; runId; capabilityId; goal; stoppedAtStepId;
  reason: "stuck" | "risky_confirmation" | "unrecoverable";
  state: { url; screenshotRef; observationRef };
  needs: string;               // what the human must decide/do
  createdAt;
}
```
The human operates the **same** Playwright browser context the agent was driving (headed window) —
not a fresh session. A **minimal** operator surface (small local web panel + a programmatic
operator for automated evidence) shows the request, exposes take-control / resume, and records the
human's actions. On resume, the controller diffs state, appends the human actions to the trace, and
returns the lease. **Scope note (brief §3.6):** the rich co-browsing console is mocked; the
handoff mechanism and control-transfer state machine are real and are the graded part.

## 11. Heterogeneity & multi-tenant (design; minimal proof built)

- **Surface abstraction.** `Surface` is the only seam that touches a concrete technology. `role+name`
  locators and label/row anchoring are defined against the **accessibility tree**, which exists on
  desktop apps too — so a `DesktopSurface` (UIAutomation/AX) is an implementation of the same
  interface with the same artifact schema. Built: `WebSurface`. Designed: `DesktopSurface`.
- **Multi-tenant reuse.** Artifacts key on `target.appFamily`, **not** a tenant URL. A `TenantProfile`
  injects base URL + branding/label overrides + feature flags at replay. Routes are **canonicalized**
  (`/member/12345 → /member/:id`). Locator fallbacks + invariants absorb cosmetic drift; when drift
  exceeds a threshold (fallback usage / checkpoint mismatch signals), the capability is **specialized**
  per tenant via an overrides layer rather than re-recorded from scratch. Built: record on tenant A →
  replay on rebranded tenant B with overrides + drift report.

## 12. Safety & data handling

- **Allowlist** (configurable): permitted `routes` + permitted `ActionType`s. Enforced on **every**
  `act()` in both discovery and replay; anything outside → `GUARDRAIL_BLOCKED`.
- **Risk policy.** Each step carries `risk ∈ {safe, sensitive, irreversible}` → `policy ∈
  {auto, confirm, block}`. `irreversible`/`confirm` routes through escalation (§10); `block` stops.
- **Redaction.** `Param.sensitive` values and known secret/PII patterns are scrubbed **before any
  persistence** — artifacts, traces, screenshots' metadata. Secrets never enter the repo (env only).

## 13. Repo layout (exact paths; brief-required paths in **bold**)

```
/README.md            **  setup, run-without-live-services, demo path (discover → replay)
/REPORT.md            **  7 headings (Architecture · Artifact schema · Determinism & error
                          handling · Heterogeneity & multi-tenant · Escalation & handoff ·
                          Safety · Cuts)
/evidence/            **  saved artifact + discovery-run trace + replay-run trace
                          (incl. one replay hitting an error/exceptional state) [+ optional gif]
/schema/                 capability.schema.json (exported JSON Schema)
/docs/governance/        blueprint-protocol.md (this) + prompt / tracelog / context-window /
                          tracking protocols
/src/
  surface/  llm/  agent/  artifact/  replay/  safety/  escalation/  catalog/
  evidence/ tenant/  cli/
/mock-bank/              standalone legacy app + chaos injection + tenants A/B
/tests/                  schema round-trip; replay: success · business_outcome · recovered ·
                          hard_failure · escalation (deterministic, MockLlmProvider, offline)
/config/                 allowlist + tenant profiles (example, no secrets)
package.json  tsconfig.json  .gitignore
```

## 14. Definition of Done & quality gates

A flow is **done** only when: types compile (`tsc --noEmit`), its tests pass, it emits the traces
the tracelog-protocol requires, it respects the allowlist + redaction, and it is reachable from a
documented CLI command. Repo-level DoD: `README` demo path runs end-to-end offline (replay) and the
one real discovery run's evidence is committed. Code style: **small, typed, single-responsibility;
prefer deleting over abstracting; no dead scaffolding.**

## 15. Cuts (deliberate) & next steps

Cut now, documented seam: `DesktopSurface`, rich operator console, at-scale tenant plumbing,
confidence/approval gating, assisted-LLM single-step fallback, multi-run flakiness scoring. Each has
a design paragraph in REPORT §Cuts and a named seam in code. Rationale: brief rewards depth on the
load-bearing pieces over a broad, shallow surface.

## 16. Evaluation mapping (traceability)

| Eval criterion (§7) | Where satisfied |
|---|---|
| System design | §6 schema, §9 result contract, §5 boundaries |
| Core loop correctness | §8.1 discovery, real run in `/evidence` |
| Robustness & error handling | §9 taxonomy, §6.5 recovery, mock-bank chaos |
| Escalation | §10 control-transfer, §8.3 |
| Generalization | §11 surface + multi-tenant, cross-tenant demo |
| Safety | §12 allowlist/risk/redaction |
| Code quality | §5 boundaries, §14 gates, `/tests` |
| Communication | REPORT.md, this blueprint, `/evidence` |

## 17. Blueprint changelog

- `1.0.0` — LOCKED. Approved by Ricky 2026-08-27. Downstream files may now be generated.
- `0.1.0` — initial draft for LOCK.
```

