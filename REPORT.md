# Design Write-up

A computer-use system for legacy back-office apps with no API: an LLM discovers a task once, the run
becomes a typed reusable capability, and deterministic replay is how a production agent invokes it —
no model in the loop. Below are the load-bearing decisions and their trade-offs. The source of truth
is [`docs/governance/blueprint-protocol.md`](./docs/governance/blueprint-protocol.md).

## 1. Architecture

Single process, layered, with dependency inversion at two seams. The application layer (`agent`,
`replay`, `catalog`) depends on a domain layer (`artifact`, `safety`, `escalation`, `tenant`) which
depends on two interfaces — `Surface` and `LlmProvider` — whose implementations are the only code that
knows about a concrete technology. `WebSurface` (Playwright) is the sole module that imports a browser;
`OpenAiProvider`/`MockLlmProvider` are the sole model callers. Nothing else can reach either, so the
whole system is testable offline against a `MockLlmProvider`, and a `DesktopSurface` could be added
without touching the schema, the replay engine, or the safety model.

Key boundary: **`replay` never imports `llm`.** Discovery and production execution are different
programs that happen to share the artifact and the surface. That is the point of the project — the
model's job ends when the artifact is written.

I chose one process over services because the brief rewards clean seams, not scaling plumbing. The
seams that would let this scale (surface abstraction, provider abstraction, per-tenant profiles, a
capability store) are real; the plumbing (queues, workers) is deliberately absent.

Target surface: a locally-built **hostile legacy bank** (frameset shell, nested-table layout, no test
IDs, injectable runtime errors, two rebranded tenants) rather than a public site. This trades "proof
it works on a surface we didn't control" for three things worth more here: the exact exceptional
states the evaluation hinges on can be *injected on demand*, the whole thing reproduces with no live
services, and it faithfully mirrors the "no clean DOM" reality. The discovery run is still real — a
real browser driven by a real model.

## 2. Artifact schema

The artifact (`src/artifact/schema.ts`, Zod → `schema/capability.schema.json`) is the focal point. A
`Capability` carries: identity (`capabilityId` + semver `version` + `schemaVersion`), a `target` keyed
by **`appFamily`, not a tenant URL**, typed `inputs` and `outputs`, ordered `steps`, a goal-level
`successCondition`, declared `businessOutcomes`, `recovery` rules, `guardrails`, and `provenance` that
*points at* the evidence rather than inlining the transcript.

Two decisions do most of the work:

**Locators are intent-level, ranked, and decoupled from the transcript.** Each step's target is a
`LocatorBundle` — an ordered list of strategies from robust to brittle: accessibility `role`+`name`,
then label/row anchoring (`label`, `rowAnchor`: "the value cell of the row whose label cell reads
'Savings Balance'"), then attributes, then a last-resort `structural` selector. Robustness comes from
the *perception layer* synthesizing these signals (`agent/record.ts`), not from what the model typed.
The artifact records what a human operator would *say*, which is why it survives a UI that has no
stable selectors and why the same bundle resolves on a desktop accessibility tree.

**Business outcomes and recovery are first-class, typed fields.** `businessOutcomes` (e.g.
`member_not_found`) declare how replay *recognizes* a legitimate non-success and what it returns to the
caller. This is what stops the most common design mistake — conflating "no such member" with a crash.
The success/outcome semantics of a regulated capability are author-declared and human-reviewable by
design; the model discovers the *flow*, not the contract.

Everything is validated at the tool-call boundary (Zod) and checksummed over the behavior-defining
fields, so a tampered or drifted artifact is rejected on load.

## 3. Determinism & error handling

Replay (`src/replay/engine.ts`) is deterministic because (a) targets resolve by **ranked strategy with
invariant checks**, not one brittle selector; (b) all waiting is on **state/checkpoints**, never
wall-clock; (c) **no model participates**. When a fallback strategy wins, replay logs
`locator.fallback_used` — a per-run drift signal.

Every run is classified by a four-way result contract:

- **`success`** — with typed outputs and a list of any recoveries applied.
- **`business_outcome`** — a declared expected result (`member_not_found`, `permission_denied`),
  returned to the caller, not an error.
- **`hard_failure`** — with a `FailureCategory` (`LOCATOR_UNRESOLVED`, `CHECKPOINT_FAILED`,
  `UNEXPECTED_STATE`, `TIMEOUT`, `GUARDRAIL_BLOCKED`, `INVALID_INPUT`, `PROVIDER_ERROR`) and a
  `{stepId, expected, observed, evidenceRef}` payload plus a screenshot.
- **`escalation_required`** — a human is needed (§5).

The three-way discipline the brief calls out is explicit: at every step boundary replay first checks
declared **business outcomes**, then bounded **recovery rules** (`dismiss` a known interstitial,
`retry` a transient failure by reloading the affected frame, `reauth` → escalate), and only then acts;
anything left unresolved after fallbacks and recovery is a hard failure with debuggable evidence.
`evidence/` shows all four outcomes on the same capability, including a recovered interstitial and a
hard failure produced by a transient storm that exceeds the retry budget.

Recovery rules live at the capability level (not only per step) because injected conditions — an
interstitial, a slow backend, an expired session — can appear at *any* step, which is exactly how a
real bank UI behaves.

## 4. Heterogeneity & multi-tenant

**Surfaces.** `role`+`name` and label/row anchoring are defined against the accessibility tree, which
exists on desktop apps too. A `DesktopSurface` (UIAutomation/AX) is therefore another implementation
of the same `Surface` interface driving the *same* artifact schema — the seam between "how we
perceive/act" and "the recorded flow" is that interface. Built: `WebSurface`. Designed: `DesktopSurface`.

**Tenants.** Hundreds of tenants run the same vendor product, branded and versioned differently, so
artifacts key on `appFamily` and a `TenantProfile` injects the base URL plus label overrides at replay.
Crucially, overrides are applied to **both locators and checkpoints**, so a capability recorded on
tenant *acme* replays unchanged on rebranded *globus* where "Savings Balance" reads "Savings Bal." —
demonstrated end-to-end (`evidence/06-replay-cross-tenant-globus`, and via the catalog). Cosmetic drift
is absorbed by the fallback ladder; when drift exceeds a threshold (fallback-usage / checkpoint-mismatch
signals in the trace) a capability is *specialized* per tenant via overrides rather than re-recorded.
Routes are meant to be canonicalized (`/member/12345 → /member/:id`); that normalization is designed,
not built.

## 5. Escalation & handoff

A `SessionController` (`src/escalation`) is the single writer of a **control lease** —
`controlOwner ∈ {AGENT, HUMAN}` — over the one live session, with a state machine
`RUNNING → PAUSED → HUMAN_CONTROL → RESUMING → RUNNING`. When replay hits a risky/irreversible step
(`policy: confirm`) or an unrecoverable state, it emits an `InterventionRequest` carrying the goal,
the stopped step, a screenshot, and what's needed. The orchestrator (`handoff.ts`) then cedes the
lease, lets a human operate the **same** browser session the automation was driving (not a fresh one),
records every human action into the trace, resumes, and **continues from the right step** — after the
step for a risky confirmation (the human performed it), or re-running it after a re-auth. This is a
real pause → cede → resume seam, verified by a test where a risky step is handed off, completed by a
human on the same session, and the run resumes to success.

Scope: the operator UI is intentionally minimal (`operator` serves a panel that renders pending
interventions and offers resume). The graded parts — the control-transfer state machine and the
handoff mechanism — are real, not mocked.

## 6. Safety

Three layers, all enforced before anything irreversible happens. An **allowlist** (permitted
routes + action types, `config/allowlist.json`) is checked on **every** action in both discovery and
replay; anything outside is `GUARDRAIL_BLOCKED`. A **risk policy** classifies each step
(`safe`/`sensitive`/`irreversible` → `auto`/`confirm`/`block`); irreversible steps route through human
confirmation rather than being auto-performed on replay. **Redaction** happens inside the evidence
sink, not left to callers: values bound to `sensitive` inputs and known secret/PII patterns are masked
before anything touches disk — verified by a test asserting the password never appears in the trace or
the artifact. Secrets live only in the environment; none are committed.

## 7. Cuts

Deliberately cut, with a real seam and a documented reason:

- **`DesktopSurface`** — the `Surface` interface and accessibility-first locators are built to accept
  it; only the web implementation ships. *Next:* implement against a UIAutomation/AX driver.
- **Rich co-browsing operator console** — the handoff mechanism is real; the UI is a minimal panel.
  *Next:* live screen streaming + granular action capture.
- **At-scale multi-tenant plumbing** — profiles/overrides/drift-signals are built; route canonicalization
  and a tenant-drift dashboard are designed, not built.
- **Confidence/approval gating, assisted single-step LLM fallback, multi-run flakiness scoring** — all
  fit cleanly (draft→approved on the artifact; a bounded, policy-checked recovery agent; replay-N and
  report stability) and are the natural next increments.
- **A second public-site surface** — the abstraction is proven on the mock; a thin public-site adapter
  would add breadth over depth, which the brief explicitly deprioritizes.

The bias throughout: a thin-but-real version of every core requirement, depth on the load-bearing
pieces (schema, replay + error taxonomy, control transfer), and honesty about the seams that are
stubbed. Everything here runs, is tested offline, and is defensible line by line.
