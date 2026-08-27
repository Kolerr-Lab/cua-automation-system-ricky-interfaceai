/**
 * Deterministic, offline stand-in for a real model (blueprint §4 D4). It drives the loop by matching
 * the current observation against an ordered script of intents — enough to make discovery, replay and
 * tests reproducible without network or keys. The real reasoning lives in OpenAiProvider.
 */
import type { AgentAction, AgentDecision, DecisionContext, LlmProvider } from "./types.js";
import type { ObservedElement } from "../surface/types.js";

export interface MockStep {
  match: (el: ObservedElement) => boolean;
  action: (ref: string) => AgentAction;
  note: string;
}

export class MockLlmProvider implements LlmProvider {
  readonly name = "mock";
  readonly model = "mock-1";
  private phase = 0;

  constructor(private readonly script: MockStep[]) {}

  async decide(ctx: DecisionContext): Promise<AgentDecision> {
    if (this.phase >= this.script.length) return { thought: "goal complete", action: { type: "done" } };
    const step = this.script[this.phase]!;
    const el = ctx.observation.elements.find(step.match);
    if (!el) return { thought: `waiting for ${step.note}`, action: { type: "give_up", reason: `element for "${step.note}" not visible` } };
    this.phase += 1;
    return { thought: step.note, action: step.action(el.ref) };
  }
}

const isBtn = (name: string) => (e: ObservedElement) => e.role === "button" && e.name === name;
const isBox = (label: string) => (e: ObservedElement) => e.role === "textbox" && e.label === label;

/** Script for "sign on, look up a member, read their savings balance". */
export function readSavingsScript(): MockStep[] {
  return [
    { note: "type user id", match: isBox("User ID"), action: (ref) => ({ type: "type", ref, value: "{{userId}}" }) },
    { note: "type password", match: isBox("Password"), action: (ref) => ({ type: "type", ref, value: "{{password}}" }) },
    { note: "sign on", match: isBtn("Sign On"), action: (ref) => ({ type: "click", ref }) },
    { note: "type member number", match: isBox("Member #"), action: (ref) => ({ type: "type", ref, value: "{{memberId}}" }) },
    { note: "find member", match: isBtn("Find"), action: (ref) => ({ type: "click", ref }) },
    {
      note: "read savings balance",
      match: (e) => e.role === "text" && /Savings/i.test(e.label ?? ""),
      action: (ref) => ({ type: "read", ref, as: "savingsBalance" }),
    },
  ];
}
