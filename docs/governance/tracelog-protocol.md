# Tracelog Protocol

> Governs observability/evidence (blueprint §8, §14 and brief §3.5). One structured format for both
> discovery and replay; redaction-aware; enough to debug a run and to prove the discovery run was real.

## T1. Sink & files
Append-only JSONL, one event per line, written by `evidence/`. Per run:
```
/evidence/<runId>/trace.jsonl          # the structured log
/evidence/<runId>/screenshots/*.png    # richer signal, at least on failure/escalation
/evidence/<runId>/artifact.json        # (discovery) the emitted Capability
/evidence/<runId>/result.json          # (replay) the ReplayResult
```
`runId = <kind>-<capabilityId|goal-slug>-<ISO-compact>`. Curated demo runs are copied to
`/evidence/` top level for reviewers.

## T2. Event schema
```ts
TraceEvent {
  ts: string;                 // ISO
  runId: string;
  kind: "discovery" | "replay";
  phase: "perceive" | "decide" | "act" | "checkpoint" | "recover" | "escalate" | "outcome" | "system";
  stepId?: string;
  seq: number;                // monotonic per run
  event: string;             // machine key, e.g. "locator.fallback_used"
  level: "debug" | "info" | "warn" | "error";
  data?: Record<string, unknown>;   // REDACTED (T4)
}
```

## T3. Required events (minimum, so a run is reconstructable)
- discovery: `perceive.observation` (element count, url, frame count) · `decide.action` (type, ref,
  `thought`) · `act.done`/`act.blocked` · `checkpoint.pass`/`checkpoint.fail` · `outcome.capability_emitted`.
- replay: `step.begin` · `locator.resolved` (which strategy won) · **`locator.fallback_used`** (drift
  signal, §11) · `recover.applied` · `businessOutcome.detected` · `checkpoint.fail` ·
  `outcome.<status>` with the full result category.
- escalation: `escalate.requested` (reason, stepId) · `control.ceded` · `control.human_action` ·
  `control.resumed`.

## T4. Redaction (hard rule)
Before an event is written: values bound to `Param.sensitive` are replaced with `"«redacted:name»"`;
known secret/PII patterns (tokens, card/SSN-like) are masked. Screenshots taken on a step that
rendered a sensitive value are marked and (where feasible) the field is blanked. **Secrets never hit
disk in the repo.** This is enforced in `evidence/`, not left to callers.

## T5. Failure evidence
On `hard_failure` or `escalate`, always capture: a screenshot, the current url + frame path, the
failing `stepId`, `expected` vs `observed`, and the last `Observation`. That is the "richer signal on
failure" the brief asks for.

## T6. Build tracelog
`docs/governance/BUILD_LOG.md` records notable build decisions/deviations (date · section · what · why).
Distinct from the product trace; it is the human-readable audit of how the repo was built.
