/**
 * Capability catalog (blueprint §8.4, stretch). Exposes saved artifacts as a set of callable
 * capabilities with typed arguments — the agent-facing surface implied by the through-line: an AI
 * agent discovers a capability by name and invokes it with typed args; replay does the rest.
 */
import type { Capability, Param } from "../artifact/schema.js";
import { loadCapabilityDir } from "../artifact/store.js";
import { replay, type ReplayDeps } from "../replay/engine.js";
import type { ReplayResult } from "../replay/types.js";

export interface CatalogEntry {
  capabilityId: string;
  version: string;
  name: string;
  description: string;
  appFamily: string;
  labels: string[];
  inputs: Array<Pick<Param, "name" | "type" | "required" | "description" | "sensitive">>;
  outputs: Array<{ name: string; type: string }>;
}

export type ArgCheck = { ok: true; values: Record<string, string> } | { ok: false; errors: string[] };

export class Catalog {
  constructor(private readonly caps: Capability[]) {}

  static async fromDir(dir: string): Promise<Catalog> {
    return new Catalog(await loadCapabilityDir(dir));
  }

  list(): CatalogEntry[] {
    return this.caps.map((c) => ({
      capabilityId: c.capabilityId,
      version: c.version,
      name: c.name,
      description: c.description,
      appFamily: c.target.appFamily,
      labels: c.labels,
      inputs: c.inputs.map((i) => ({ name: i.name, type: i.type, required: i.required, description: i.description, sensitive: i.sensitive })),
      outputs: c.outputs.map((o) => ({ name: o.name, type: o.type })),
    }));
  }

  get(id: string): Capability | undefined {
    return this.caps.find((c) => c.capabilityId === id);
  }

  /** Validate caller args against the typed input contract before invoking (typed capability call). */
  validateArgs(id: string, args: Record<string, unknown>): ArgCheck {
    const cap = this.get(id);
    if (!cap) return { ok: false, errors: [`unknown capability '${id}'`] };
    const errors: string[] = [];
    const values: Record<string, string> = {};
    for (const p of cap.inputs) {
      const raw = args[p.name];
      if (raw === undefined || raw === "") {
        if (p.required) errors.push(`missing required arg '${p.name}'`);
        continue;
      }
      const s = String(raw);
      if (p.type === "number" && Number.isNaN(Number(s))) errors.push(`arg '${p.name}' must be a number`);
      if (p.type === "enum" && p.enumValues && !p.enumValues.includes(s)) errors.push(`arg '${p.name}' must be one of ${p.enumValues.join(", ")}`);
      values[p.name] = s;
    }
    return errors.length ? { ok: false, errors } : { ok: true, values };
  }

  /** Invoke a capability by name with typed args — validates, then replays deterministically. */
  async invoke(id: string, args: Record<string, unknown>, deps: ReplayDeps): Promise<ReplayResult> {
    const cap = this.get(id);
    if (!cap) return { status: "hard_failure", failure: { stepId: "catalog", category: "INVALID_INPUT", expected: `capability '${id}'`, observed: "not found", evidenceRef: "" } };
    const check = this.validateArgs(id, args);
    if (!check.ok) return { status: "hard_failure", failure: { stepId: "catalog", category: "INVALID_INPUT", expected: "valid args", observed: check.errors.join("; "), evidenceRef: "" } };
    return replay(cap, check.values, deps);
  }
}
