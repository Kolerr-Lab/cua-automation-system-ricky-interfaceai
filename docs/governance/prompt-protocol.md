# Prompt Protocol

> Governs every place a language model is prompted — both the **product's** discovery agent and the
> **build's** AI-assisted development. Conforms to blueprint §8.1, §6, §12.

## Part A — Product: the discovery agent prompt contract

The discovery loop (`agent/`) is the *only* place the product prompts an LLM. Replay never does.

**A1. Roles & determinism.**
- `system`: fixed capability + rules (below). `user`: the current `Observation` + goal + step budget.
- `temperature = 0`, `top_p = 1`, one action per turn. The model plans; it does not free-type UI paths.

**A2. The model may only reference perceived elements.** The `Observation` lists interactive
elements with a synthetic, per-turn `ref` id, role, accessible name, label/row anchor, frame path.
The model returns an action **targeting a `ref`**, never a raw CSS/XPath selector. Robustness comes
from the perception layer synthesizing the `LocatorBundle` from that element's captured signals
(blueprint §6.4) — not from model output. This keeps the artifact decoupled from the transcript.

**A3. Structured output (strict).** The model must return exactly one JSON `AgentAction`:
```jsonc
{ "thought": "<=1 short line, NOT persisted to the artifact",
  "action": { "type": "click|type|select|read|navigate|assert|done|give_up",
              "ref": "e12",              // required for click/type/select/read
              "value": "…",              // for type/select (redacted in logs if bound to sensitive)
              "to": "/path",             // for navigate (must pass allowlist)
              "checkpoint": { … },       // for assert / done
              "reason": "…" } }          // for give_up / done
```
Invalid JSON or unknown `ref` ⇒ the turn is rejected, a corrective note is appended, one retry; a
second failure ends the run as a dead-end (not a crash).

**A4. Injected guardrails (system prompt).** Allowlist scope (permitted routes + action types);
"never invent selectors"; "prefer role/label over position"; "if you cannot proceed safely, emit
`give_up` with a reason" (this is what raises escalation, blueprint §10); "treat sensitive inputs as
opaque — you receive placeholders, not real values" (§12 redaction).

**A5. Stop conditions.** `done` with a satisfied `successCondition`, or `give_up`, or budget hit
(max steps / timeout / repeated no-progress). Every turn is traced (tracelog-protocol).

**A6. `thought` is ephemeral.** It aids the model and is written to the trace for debugging, but is
**never** copied into the `Capability`. The artifact records intent + locators, not reasoning.

## Part B — Build: AI-assisted development discipline

We assume AI-assisted development (brief §9). This keeps it controlled and defensible.

- **B1. Blueprint-anchored.** Every change cites the blueprint section it satisfies. No feature that
  isn't in the blueprint or an approved amendment (§ change control).
- **B2. Small, single-responsibility diffs.** One flow / module at a time. Prefer deleting over
  abstracting. No dead scaffolding "for later."
- **B3. Tests travel with code.** A flow lands with its deterministic test (MockLlmProvider, offline).
  Not done until `tsc --noEmit` + its tests pass (blueprint §14).
- **B4. Change requests reference sections**, not vibes: "amend §6.5 recovery to add `reauth`".
- **B5. Defensibility rule.** Anything committed must be explainable line-by-line in interview. If a
  generated fragment can't be justified, it is rewritten, not kept.
