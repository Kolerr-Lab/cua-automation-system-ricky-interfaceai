/**
 * Handoff orchestrator (blueprint §10). Runs replay; when it raises an intervention, it cedes control
 * to a human operator on the SAME live session, lets them act, then resumes automation and continues
 * from the right step — a real pause → cede → resume seam, not a TODO.
 *
 * Resume semantics: after a `risky_confirmation` the human performed the step, so replay continues
 * AFTER it; after `unrecoverable`/reauth the blocker was cleared, so replay re-runs from that step.
 */
import type { Capability } from "../artifact/schema.js";
import { replay, type ReplayDeps } from "../replay/engine.js";
import type { ReplayResult } from "../replay/types.js";
import type { HumanAction, InterventionRequest } from "./types.js";
import { SessionController } from "./controller.js";

export interface Operator {
  /** Act on the same live session to clear the intervention; return "resume" or "abort". */
  handle(req: InterventionRequest, ctx: { deps: ReplayDeps; controller: SessionController; cap: Capability }): Promise<"resume" | "abort">;
}

/** A scripted operator for tests/evidence (stands in for the human + operator UI). */
export function scriptedOperator(script: (ctx: { req: InterventionRequest; deps: ReplayDeps; controller: SessionController; cap: Capability }) => Promise<void>): Operator {
  return {
    async handle(req, ctx) {
      await script({ req, ...ctx });
      return "resume";
    },
  };
}

export interface HandoffResult {
  result: ReplayResult;
  handoffs: number;
  humanActions: HumanAction[];
}

export async function runWithHandoff(
  cap: Capability,
  inputs: Record<string, string>,
  deps: ReplayDeps,
  operator: Operator,
  maxHandoffs = 3,
): Promise<HandoffResult> {
  const controller = new SessionController(deps.trace);
  let startIndex = 0;
  let handoffs = 0;

  for (;;) {
    const result = await replay(cap, inputs, deps, { startIndex });
    if (result.status !== "escalation_required" || handoffs >= maxHandoffs) {
      return { result, handoffs, humanActions: controller.humanActions };
    }

    const req = result.intervention;
    controller.cede(req);
    const decision = await operator.handle(req, { deps, controller, cap });
    if (decision === "abort") return { result, handoffs, humanActions: controller.humanActions };
    controller.resume();
    handoffs += 1;

    const idx = cap.steps.findIndex((s) => s.id === req.stoppedAtStepId);
    startIndex = req.reason === "risky_confirmation" ? idx + 1 : idx; // human did the step, vs. cleared a blocker
  }
}
