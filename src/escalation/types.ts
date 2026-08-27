/**
 * Escalation / control-transfer contracts (blueprint §10). Types live here so the replay result union
 * can reference an InterventionRequest; the SessionController that drives the handoff is in controller.ts.
 */
export type ControlOwner = "AGENT" | "HUMAN";
export type ControlState = "RUNNING" | "PAUSED" | "HUMAN_CONTROL" | "RESUMING" | "DONE";
export type InterventionReason = "stuck" | "risky_confirmation" | "unrecoverable";

export interface InterventionRequest {
  id: string;
  runId: string;
  capabilityId: string;
  goal: string;
  stoppedAtStepId: string;
  reason: InterventionReason;
  state: { url: string; screenshotRef?: string; observationText?: string };
  needs: string; // what the human must decide or do
  createdAt: string;
}

/** What the human did while holding control — recorded and appended to the run's evidence (§10). */
export interface HumanAction {
  at: string;
  kind: "note" | "click" | "type" | "navigate" | "resume" | "abort";
  detail: string;
}
