/**
 * OpenAI-backed discovery provider (blueprint §4 D4/D5). This is the model used for the one real
 * discovery run. It runs on the operator's machine with OPENAI_API_KEY (this sandbox blocks egress
 * to api.openai.com); the key is read from the environment and never persisted.
 */
import OpenAI from "openai";
import type { AgentAction, AgentDecision, DecisionContext, LlmProvider } from "./types.js";
import { SYSTEM_PROMPT, serializeObservation } from "./prompt.js";

export class OpenAiProvider implements LlmProvider {
  readonly name = "openai";
  private readonly client: OpenAI;

  constructor(
    readonly model = process.env.OPENAI_MODEL ?? "gpt-4o",
    apiKey = process.env.OPENAI_API_KEY,
  ) {
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set — required for a real discovery run.");
    this.client = new OpenAI({ apiKey });
  }

  async decide(ctx: DecisionContext): Promise<AgentDecision> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: serializeObservation(ctx) },
      ],
      response_format: { type: "json_object" },
    });
    const content = res.choices[0]?.message?.content ?? "{}";
    return parseDecision(content);
  }
}

/** Validate the model's JSON into an AgentDecision; a malformed reply becomes a safe give_up. */
export function parseDecision(content: string): AgentDecision {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return { thought: "unparseable", action: { type: "give_up", reason: "model returned non-JSON" } };
  }
  const obj = raw as { thought?: string; action?: Record<string, unknown> };
  const a = obj.action ?? {};
  const thought = typeof obj.thought === "string" ? obj.thought : "";
  const t = a["type"];
  const ref = typeof a["ref"] === "string" ? (a["ref"] as string) : "";
  switch (t) {
    case "navigate":
      return { thought, action: { type: "navigate", to: String(a["to"] ?? "") } };
    case "click":
      return { thought, action: { type: "click", ref } };
    case "type":
      return { thought, action: { type: "type", ref, value: String(a["value"] ?? "") } };
    case "select":
      return { thought, action: { type: "select", ref, value: String(a["value"] ?? "") } };
    case "read":
      return { thought, action: { type: "read", ref, as: String(a["as"] ?? "value") } };
    case "done":
      return { thought, action: { type: "done" } };
    default:
      return { thought, action: { type: "give_up", reason: `unknown action '${String(t)}'` } };
  }
}

export function makeProvider(kind: string): LlmProvider {
  if (kind === "openai") return new OpenAiProvider();
  throw new Error(`unknown provider '${kind}'`);
}

export type { AgentAction };
