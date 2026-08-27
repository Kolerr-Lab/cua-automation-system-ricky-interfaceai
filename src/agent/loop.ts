/**
 * Discovery loop (blueprint §8.1): observe → decide (LLM) → act, against a live surface, until the
 * goal's success condition holds or a stop condition fires. On success it emits a parameterized
 * Capability whose locators are synthesized from perception (record.ts), decoupled from the transcript.
 */
import type { Capability, Checkpoint, OutputField, Param, Step } from "../artifact/schema.js";
import { saveCapability } from "../artifact/store.js";
import type { Allowlist, SafetyGate } from "../safety/allowlist.js";
import { classifyRisk, defaultPolicy } from "../safety/risk.js";
import { Redactor } from "../safety/redaction.js";
import type { TraceWriter } from "../evidence/trace.js";
import type { Surface } from "../surface/types.js";
import type { LlmProvider } from "../llm/types.js";
import { synthesizeLocator } from "./record.js";

export interface InputValue extends Param {
  value: string;
}

export interface DiscoverySpec {
  capabilityId: string;
  name: string;
  description: string;
  labels?: string[];
  appFamily: string;
  entryPoint: string; // canonical, tenant-relative (e.g. "/")
  tenantBaseUrl: string; // discovery target base (e.g. http://localhost:4010/t/acme)
  inputs: InputValue[];
  successCondition: Checkpoint;
  businessOutcomes?: Capability["businessOutcomes"];
}

export interface DiscoveryDeps {
  provider: LlmProvider;
  surface: Surface;
  safety: SafetyGate;
  allowlist: Allowlist;
  trace: TraceWriter;
  maxSteps?: number;
}

export type DiscoveryResult =
  | { status: "success"; capability: Capability; outputs: Record<string, string>; artifactPath: string }
  | { status: "gave_up" | "failed"; reason: string };

const placeholder = /^\{\{(.+?)\}\}$/;

export async function discover(spec: DiscoverySpec, deps: DiscoveryDeps): Promise<DiscoveryResult> {
  const { provider, surface, safety, trace } = deps;
  const maxSteps = deps.maxSteps ?? 20;
  const redactor = new Redactor(spec.inputs.filter((i) => i.sensitive).map((i) => ({ value: i.value, name: i.name })));

  const steps: Step[] = [];
  const outputs: OutputField[] = [];
  const captured: Record<string, string> = {};
  const history: string[] = [];

  // Step 0: navigate to the entry point (recorded canonically; tenant base is injected at replay).
  await surface.navigate(spec.tenantBaseUrl + spec.entryPoint);
  steps.push({ id: "s0", intent: `open ${spec.entryPoint}`, action: { type: "navigate", to: spec.entryPoint }, risk: "safe", policy: "auto", recover: [] });

  for (let i = 0; i < maxSteps; i++) {
    const observation = await surface.perceive();
    trace.emit("perceive", "perceive.observation", { data: { url: observation.url, elements: observation.elements.length, frames: observation.frameCount } });

    const decision = await provider.decide({
      goal: spec.description,
      observation,
      inputs: spec.inputs.map((p) => ({ name: p.name, description: p.description, masked: p.sensitive ? `«${p.name}»` : p.value, sensitive: p.sensitive })),
      history,
      stepBudget: maxSteps - i,
    });
    const a = decision.action;
    trace.emit("decide", "decide.action", { data: { type: a.type, thought: decision.thought, ...("ref" in a ? { ref: a.ref } : {}) } });

    if (a.type === "give_up") {
      trace.emit("outcome", "outcome.gave_up", { level: "warn", data: { reason: a.reason } });
      return { status: "gave_up", reason: a.reason };
    }
    if (a.type === "done") break;

    if (a.type === "navigate") {
      const url = spec.tenantBaseUrl + a.to;
      const blocked = safety.check("navigate", url);
      if (blocked) return fail(trace, `guardrail: ${blocked}`);
      await surface.navigate(url);
      steps.push({ id: `s${steps.length}`, intent: `open ${a.to}`, action: { type: "navigate", to: a.to }, risk: "safe", policy: "auto", recover: [] });
      history.push(`navigate ${a.to}`);
      continue;
    }

    const el = observation.elements.find((e) => e.ref === a.ref);
    if (!el) return fail(trace, `model referenced unknown element ${a.ref}`);
    const target = synthesizeLocator(el);
    const resolved = await surface.resolveRef(a.ref, el.framePath);
    if (!resolved) return fail(trace, `could not resolve ${a.ref}`);

    const actionType = a.type === "read" ? "read" : a.type;
    const blocked = safety.check(actionType, surface.url());
    if (blocked) return fail(trace, `guardrail: ${blocked}`);

    const stepId = `s${steps.length}`;
    if (a.type === "click") {
      await surface.click(resolved);
      const risk = classifyRisk({ type: "click" }, el.name);
      steps.push({ id: stepId, intent: `click "${el.name}"`, action: { type: "click" }, target, risk, policy: defaultPolicy(risk), recover: [] });
      history.push(`click ${el.name}`);
    } else if (a.type === "type" || a.type === "select") {
      const v = resolveValue(a.value, spec.inputs);
      if (a.type === "type") await surface.type(resolved, v.real);
      else await surface.selectOption(resolved, v.real);
      steps.push({
        id: stepId,
        intent: `${a.type} into "${el.label ?? el.name}"`,
        action: { type: a.type },
        target,
        ...(v.binding ? { inputBinding: v.binding } : { literalValue: v.real }),
        risk: "safe",
        policy: "auto",
        recover: [],
      });
      history.push(`${a.type} ${el.label ?? el.name} = ${redactor.string(v.real)}`);
    } else if (a.type === "read") {
      const text = await surface.readText(resolved);
      captured[a.as] = text;
      outputs.push({ name: a.as, type: "string", description: `captured "${el.label ?? el.name}"`, source: { fromStepId: stepId, extract: "text" } });
      steps.push({ id: stepId, intent: `read "${el.label ?? el.name}"`, action: { type: "read" }, target, risk: "safe", policy: "auto", recover: [] });
      history.push(`read ${el.label ?? el.name}`);
    }
  }

  // Verify the goal actually landed (not just that the last click "worked").
  const success = await surface.waitForCheckpoint(spec.successCondition);
  trace.emit("checkpoint", success ? "checkpoint.pass" : "checkpoint.fail", { level: success ? "info" : "error", data: { successCondition: spec.successCondition } });
  if (!success) return fail(trace, "success condition not met after discovery");

  const capability = await emit(spec, deps, steps, outputs);
  const artifactPath = `${trace.dir}/artifact.json`;
  const saved = await saveCapability(artifactPath, capability);
  trace.emit("outcome", "outcome.capability_emitted", { data: { capabilityId: saved.capabilityId, steps: saved.steps.length, outputs: saved.outputs.length } });
  return { status: "success", capability: saved, outputs: captured, artifactPath };
}

function resolveValue(value: string, inputs: InputValue[]): { real: string; binding?: { param: string } } {
  const m = placeholder.exec(value.trim());
  if (m) {
    const p = inputs.find((i) => i.name === m[1]);
    if (p) return { real: p.value, binding: { param: p.name } };
  }
  const match = inputs.find((i) => i.value === value);
  return match ? { real: value, binding: { param: match.name } } : { real: value };
}

function fail(trace: TraceWriter, reason: string): DiscoveryResult {
  trace.emit("outcome", "outcome.failed", { level: "error", data: { reason } });
  return { status: "failed", reason };
}

async function emit(spec: DiscoverySpec, deps: DiscoveryDeps, steps: Step[], outputs: OutputField[]): Promise<Capability> {
  const inputs: Param[] = spec.inputs.map(({ value: _v, ...p }) => p);
  return {
    schemaVersion: "1.0.0",
    capabilityId: spec.capabilityId,
    version: "1.0.0",
    name: spec.name,
    description: spec.description,
    labels: spec.labels ?? [],
    target: { appFamily: spec.appFamily, surfaceKind: "web", entryPoint: spec.entryPoint },
    inputs,
    outputs,
    steps,
    successCondition: spec.successCondition,
    businessOutcomes: spec.businessOutcomes ?? [],
    guardrails: { allowlist: { routes: deps.allowlist.routes, actions: deps.allowlist.actions } },
    provenance: {
      discoveredBy: { provider: deps.provider.name, model: deps.provider.model },
      discoveredAt: new Date().toISOString(),
      sourceRunId: deps.trace.runId,
      evidenceRef: deps.trace.dir,
      checksum: "",
    },
  };
}
