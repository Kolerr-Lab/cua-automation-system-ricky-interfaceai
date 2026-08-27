/**
 * SessionController — the single writer of "who is in control" (blueprint §10). It owns a control
 * lease over the ONE live session the automation is driving, transitions the state machine, and
 * records everything the human does so the evidence spans the handoff seam. It does not open a new
 * session; the human operates the same one the agent/replay used.
 */
import type { TraceWriter } from "../evidence/trace.js";
import type { ControlOwner, ControlState, HumanAction, InterventionRequest } from "./types.js";

export class SessionController {
  private owner: ControlOwner = "AGENT";
  private state: ControlState = "RUNNING";
  private actions: HumanAction[] = [];

  constructor(private readonly trace: TraceWriter) {}

  get controlOwner(): ControlOwner {
    return this.owner;
  }
  get controlState(): ControlState {
    return this.state;
  }
  get humanActions(): HumanAction[] {
    return [...this.actions];
  }

  /** Pause automation and cede the lease to the human on the SAME session. */
  cede(req: InterventionRequest): void {
    this.state = "PAUSED";
    this.owner = "HUMAN";
    this.state = "HUMAN_CONTROL";
    this.record({ kind: "note", detail: `human took control — ${req.needs}` });
    this.trace.emit("escalate", "control.ceded", { stepId: req.stoppedAtStepId, data: { owner: this.owner, reason: req.reason } });
  }

  /** Record an action the human performed while holding control. */
  record(a: Omit<HumanAction, "at">): void {
    const action: HumanAction = { ...a, at: new Date().toISOString() };
    this.actions.push(action);
    this.trace.emit("escalate", "control.human_action", { data: { ...action } });
  }

  /** Return the lease to automation so the run can continue on the same session. */
  resume(): HumanAction[] {
    this.state = "RESUMING";
    this.owner = "AGENT";
    this.record({ kind: "resume", detail: "control returned to automation" });
    this.trace.emit("escalate", "control.resumed", { data: { owner: this.owner, humanActions: this.actions.length } });
    this.state = "RUNNING";
    return this.humanActions;
  }
}
