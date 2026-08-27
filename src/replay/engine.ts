/**
 * Deterministic replay (blueprint §9). Walks a saved Capability with NO model in the loop, resolving
 * targets by ranked strategy, gating on checkpoints, and classifying every run into the result
 * contract: success | business_outcome | hard_failure | escalation_required. Recovery rules and
 * business outcomes are evaluated at every step boundary because injected conditions appear anywhere.
 */
import type { Capability, RecoveryRule } from "../artifact/schema.js";
import type { SafetyGate } from "../safety/allowlist.js";
import type { TraceWriter } from "../evidence/trace.js";
import type { Surface } from "../surface/types.js";
import type { InterventionRequest, InterventionReason } from "../escalation/types.js";
import { overrideBundle, overrideCheckpoint, type TenantProfile } from "../tenant/profile.js";
import type { FailureCategory, ReplayResult } from "./types.js";

export interface ReplayDeps {
  surface: Surface;
  safety: SafetyGate;
  trace: TraceWriter;
  tenant: TenantProfile;
}

export async function replay(cap: Capability, inputs: Record<string, string>, deps: ReplayDeps): Promise<ReplayResult> {
  const { surface, safety, trace, tenant } = deps;
  const recovery: string[] = [];
  const outputs: Record<string, string> = {};
  const outputByStep = new Map(cap.outputs.map((o) => [o.source.fromStepId, o] as const));

  for (const p of cap.inputs) {
    if (p.required && inputs[p.name] === undefined) {
      return hardFail(deps, "inputs", "INVALID_INPUT", `input '${p.name}' required`, "missing");
    }
  }

  for (const step of cap.steps) {
    trace.emit("act", "step.begin", { stepId: step.id, data: { intent: step.intent } });

    // A prior action may have landed us on a business outcome or a recoverable interstitial. Check
    // before acting — but not before a navigate step, whose whole job is to change the current page.
    if (step.action.type !== "navigate") {
      const bo = await detectBusinessOutcome(cap, deps);
      if (bo) return businessOutcome(deps, recovery, bo.code, bo.returns);
      const rec = await runRecovery(cap, deps, step.id, recovery);
      if (rec === "escalate") return escalate(cap, deps, step.id, "unrecoverable", "Session/state needs a human to recover (e.g. re-authenticate), then resume.");
    }

    // Risky/irreversible steps are never auto-performed on replay — hand to a human (§10, §12).
    if (step.policy === "confirm") {
      return escalate(cap, deps, step.id, "risky_confirmation", `Confirm irreversible action: ${step.intent}`);
    }

    if (step.precondition) await surface.waitForCheckpoint(overrideCheckpoint(tenant, step.precondition));

    if (step.action.type === "navigate") {
      const url = tenant.baseUrl + step.action.to;
      const blocked = safety.check("navigate", url);
      if (blocked) return hardFail(deps, step.id, "GUARDRAIL_BLOCKED", "navigate allowed", blocked);
      await surface.navigate(url);
    } else if (step.target) {
      let resolved = await surface.resolve(overrideBundle(tenant, step.target));
      if (!resolved) {
        // Not resolving may mean an unexpected business outcome or a recoverable interstitial.
        const bo2 = await detectBusinessOutcome(cap, deps);
        if (bo2) return businessOutcome(deps, recovery, bo2.code, bo2.returns);
        if ((await runRecovery(cap, deps, step.id, recovery)) === "escalate")
          return escalate(cap, deps, step.id, "unrecoverable", "Recovery requires a human.");
        resolved = await surface.resolve(overrideBundle(tenant, step.target));
      }
      if (!resolved) return hardFail(deps, step.id, "LOCATOR_UNRESOLVED", `resolve ${step.intent}`, `no strategy matched at ${surface.url()}`);
      trace.emit("act", resolved.usedFallback ? "locator.fallback_used" : "locator.resolved", {
        stepId: step.id,
        level: resolved.usedFallback ? "warn" : "info",
        data: { strategy: resolved.describe, index: resolved.strategyIndex },
      });

      const blocked = safety.check(step.action.type, surface.url());
      if (blocked) return hardFail(deps, step.id, "GUARDRAIL_BLOCKED", `${step.action.type} allowed`, blocked);

      if (step.action.type === "click") await surface.click(resolved);
      else if (step.action.type === "type") await surface.type(resolved, valueFor(step, inputs));
      else if (step.action.type === "select") await surface.selectOption(resolved, valueFor(step, inputs));
      else if (step.action.type === "read") {
        const text = await surface.readText(resolved);
        const of = outputByStep.get(step.id);
        if (of) outputs[of.name] = text;
      }
    }

    if (step.postcondition) {
      const ok = await surface.waitForCheckpoint(overrideCheckpoint(tenant, step.postcondition));
      if (!ok) {
        const bo3 = await detectBusinessOutcome(cap, deps);
        if (bo3) return businessOutcome(deps, recovery, bo3.code, bo3.returns);
        return hardFail(deps, step.id, "CHECKPOINT_FAILED", describeCheckpoint(step.postcondition), `not satisfied at ${surface.url()}`);
      }
    }
  }

  // Did we actually reach the goal — or land on a legitimate business outcome instead?
  const finalBo = await detectBusinessOutcome(cap, deps);
  if (finalBo) return businessOutcome(deps, recovery, finalBo.code, finalBo.returns);
  const ok = await surface.waitForCheckpoint(overrideCheckpoint(tenant, cap.successCondition));
  if (!ok) return hardFail(deps, "success", "CHECKPOINT_FAILED", describeCheckpoint(cap.successCondition), `not satisfied at ${surface.url()}`);

  trace.emit("outcome", "outcome.success", { data: { outputs, recovery } });
  return { status: "success", outputs, recovery, evidenceRef: trace.dir };
}

function valueFor(step: Capability["steps"][number], inputs: Record<string, string>): string {
  if (step.inputBinding) return inputs[step.inputBinding.param] ?? "";
  return step.literalValue ?? "";
}

async function detectBusinessOutcome(cap: Capability, deps: ReplayDeps): Promise<{ code: string; returns?: Record<string, unknown> } | null> {
  for (const bo of cap.businessOutcomes) {
    if (await deps.surface.checkpointHolds(overrideCheckpoint(deps.tenant, bo.detect))) return { code: bo.code, returns: bo.returns };
  }
  return null;
}

async function runRecovery(cap: Capability, deps: ReplayDeps, stepId: string, log: string[]): Promise<"clear" | "escalate"> {
  for (const rule of cap.recovery) {
    let attempts = 0;
    while (attempts < rule.maxAttempts && (await deps.surface.checkpointHolds(overrideCheckpoint(deps.tenant, rule.when)))) {
      if (rule.do === "reauth") {
        deps.trace.emit("recover", "recover.reauth_needed", { stepId, level: "warn", data: { when: rule.when } });
        return "escalate";
      }
      await applyRecovery(rule, deps);
      log.push(`${rule.do}@${stepId}`);
      deps.trace.emit("recover", "recover.applied", { stepId, data: { do: rule.do, when: rule.when } });
      attempts += 1;
    }
  }
  return "clear";
}

async function applyRecovery(rule: RecoveryRule, deps: ReplayDeps): Promise<void> {
  if (rule.do === "dismiss" && rule.target) {
    const r = await deps.surface.resolve(overrideBundle(deps.tenant, rule.target));
    if (r) await deps.surface.click(r);
  } else if (rule.do === "retry") {
    await deps.surface.reload(rule.framePath ?? []);
  }
}

async function snapshot(deps: ReplayDeps, name: string): Promise<string> {
  try {
    return deps.trace.screenshot(name, await deps.surface.screenshot());
  } catch {
    return deps.trace.dir;
  }
}

function businessOutcome(deps: ReplayDeps, recovery: string[], code: string, returns?: Record<string, unknown>): ReplayResult {
  deps.trace.emit("outcome", "businessOutcome.detected", { data: { code } });
  return { status: "business_outcome", code, returns, recovery, evidenceRef: deps.trace.dir };
}

async function hardFail(deps: ReplayDeps, stepId: string, category: FailureCategory, expected: string, observed: string): Promise<ReplayResult> {
  const evidenceRef = await snapshot(deps, `fail-${stepId}`);
  deps.trace.emit("outcome", "outcome.hard_failure", { stepId, level: "error", data: { category, expected, observed } });
  return { status: "hard_failure", failure: { stepId, category, expected, observed, evidenceRef } };
}

async function escalate(cap: Capability, deps: ReplayDeps, stepId: string, reason: InterventionReason, needs: string): Promise<ReplayResult> {
  const screenshotRef = await snapshot(deps, `escalate-${stepId}`);
  const intervention: InterventionRequest = {
    id: `iv-${deps.trace.runId}-${stepId}`,
    runId: deps.trace.runId,
    capabilityId: cap.capabilityId,
    goal: cap.description,
    stoppedAtStepId: stepId,
    reason,
    state: { url: deps.surface.url(), screenshotRef },
    needs,
    createdAt: new Date().toISOString(),
  };
  deps.trace.emit("escalate", "escalate.requested", { stepId, level: "warn", data: { reason, needs } });
  return { status: "escalation_required", intervention, evidenceRef: deps.trace.dir };
}

function describeCheckpoint(cp: Capability["successCondition"]): string {
  return cp.kind === "textPresent" ? `text "${cp.text}" present` : cp.kind;
}
