/**
 * LLM seam (blueprint §5, prompt-protocol). The discovery loop is the ONLY place a model is used;
 * replay never imports this. A MockLlmProvider drives dev/tests deterministically and offline.
 */
import type { Observation } from "../surface/types.js";

/** What the model sees each turn. Sensitive input values are masked before they reach the model (A4). */
export interface DecisionContext {
  goal: string;
  observation: Observation;
  /** Declared inputs; `masked` is what the model may reference (real values never sent for secrets). */
  inputs: Array<{ name: string; description: string; masked: string; sensitive: boolean }>;
  history: string[];
  stepBudget: number;
}

/** Exactly one action per turn (prompt-protocol A3). The model targets an observed `ref`, never a selector. */
export type AgentAction =
  | { type: "navigate"; to: string }
  | { type: "click"; ref: string }
  | { type: "type"; ref: string; value: string } // value may be a {{paramName}} placeholder
  | { type: "select"; ref: string; value: string }
  | { type: "read"; ref: string; as: string } // capture a labeled value as output `as`
  | { type: "done" }
  | { type: "give_up"; reason: string };

export interface AgentDecision {
  thought: string; // ephemeral: traced for debugging, never written into the artifact (A6)
  action: AgentAction;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  decide(ctx: DecisionContext): Promise<AgentDecision>;
}
