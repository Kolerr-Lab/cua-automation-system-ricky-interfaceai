/** Prompt construction for the discovery agent (prompt-protocol Part A). */
import type { DecisionContext } from "./types.js";

export const SYSTEM_PROMPT = `You operate a legacy business web UI to accomplish a goal, one action at a time.
Rules:
- You may ONLY act on elements listed in OBSERVATION, by their "ref". Never invent CSS/XPath selectors.
- Prefer the element whose role and visible label match the intent. Legacy pages have no test IDs.
- To enter a declared input, use its {{name}} placeholder as the value (real secrets are never shown to you).
- Read a value you must return with {"type":"read","ref":"...","as":"<outputName>"}.
- When the goal is reached, respond {"type":"done"}. If you cannot proceed safely, {"type":"give_up","reason":"..."}.
Respond with STRICT JSON only: {"thought":"<=1 line","action":{...}}. Exactly one action.`;

export function serializeObservation(ctx: DecisionContext): string {
  const els = ctx.observation.elements
    .map((e) => {
      const frame = e.framePath.length ? ` frame=${e.framePath.join(">")}` : "";
      const label = e.label ? ` label="${e.label}"` : "";
      return `  ${e.ref} [${e.role}] "${e.name}"${label}${frame}`;
    })
    .join("\n");
  const inputs = ctx.inputs.map((i) => `  {{${i.name}}} — ${i.description}${i.sensitive ? " (secret)" : ` = ${i.masked}`}`).join("\n");
  return [
    `GOAL: ${ctx.goal}`,
    `INPUTS:\n${inputs || "  (none)"}`,
    `URL: ${ctx.observation.url}  (steps left: ${ctx.stepBudget})`,
    `RECENT: ${ctx.history.slice(-5).join(" | ") || "(none)"}`,
    `OBSERVATION (${ctx.observation.elements.length} elements):\n${els || "  (none)"}`,
  ].join("\n\n");
}
