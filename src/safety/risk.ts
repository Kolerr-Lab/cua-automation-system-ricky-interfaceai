/**
 * Risk classification & policy resolution (blueprint §12). Separates safe/reversible from
 * risky/irreversible actions so the latter are handled conservatively (confirm via escalation, or block).
 */
import type { Action, Policy, RiskClass } from "../artifact/schema.js";

const IRREVERSIBLE_HINTS = /\b(submit|confirm|transfer|delete|remove|create|open (a|new)|post|approve|send)\b/i;

/** Default risk for a discovered step, from the action verb + the human intent text. */
export function classifyRisk(action: Action, intent: string): RiskClass {
  if (action.type === "read" || action.type === "assert" || action.type === "waitFor") return "safe";
  if (action.type === "navigate" || action.type === "click") {
    return IRREVERSIBLE_HINTS.test(intent) ? "irreversible" : "safe";
  }
  // type / select: default safe; the binding layer marks sensitive inputs separately.
  return "safe";
}

/** How a given risk is handled by default. Configurable in a real deployment. */
export function defaultPolicy(risk: RiskClass): Policy {
  switch (risk) {
    case "irreversible":
      return "confirm"; // route through human confirmation (escalation §10)
    case "sensitive":
      return "auto"; // allowed, but its value is redacted (§T4)
    case "safe":
      return "auto";
  }
}
