/**
 * Replay result contract (blueprint §9). The three-way discipline the brief calls the most common
 * design mistake is encoded here: an expected business outcome, a recovered condition, and a hard
 * failure are distinct result shapes — plus an escalation path when a human is required.
 */
import type { InterventionRequest } from "../escalation/types.js";

export type FailureCategory =
  | "LOCATOR_UNRESOLVED"
  | "CHECKPOINT_FAILED"
  | "UNEXPECTED_STATE"
  | "TIMEOUT"
  | "GUARDRAIL_BLOCKED"
  | "INVALID_INPUT"
  | "PROVIDER_ERROR";

export interface ReplayFailure {
  stepId: string;
  category: FailureCategory;
  expected: string;
  observed: string;
  evidenceRef: string;
}

export type ReplayResult =
  | { status: "success"; outputs: Record<string, string>; recovery: string[]; evidenceRef: string }
  | { status: "business_outcome"; code: string; returns: Record<string, unknown> | undefined; recovery: string[]; evidenceRef: string }
  | { status: "hard_failure"; failure: ReplayFailure }
  | { status: "escalation_required"; intervention: InterventionRequest; evidenceRef: string };
