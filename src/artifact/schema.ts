/**
 * Capability artifact schema — the focal point of the system (blueprint §6).
 *
 * This Zod schema is the single source of truth for the artifact's shape. Every other module
 * imports the inferred types from here; nothing redefines them (context-window-protocol §C1).
 * `npm run schema:export` emits the JSON Schema to /schema/capability.schema.json.
 */
import { z } from "zod";

/** The action verbs the agent/replay can perform. Also the allowlist's action vocabulary (§12). */
export const ActionType = z.enum([
  "navigate",
  "click",
  "type",
  "select",
  "read",
  "waitFor",
  "assert",
]);
export type ActionType = z.infer<typeof ActionType>;

/**
 * A single element-identification strategy. Ordered robust→brittle inside a LocatorBundle (§6.4).
 * The artifact records intent-level targets ("the field labeled X"), never the raw model transcript.
 */
export const Locator = z.discriminatedUnion("by", [
  // Accessibility tree — most stable, works on desktop AX tree too (generalization story §11).
  z.object({ by: z.literal("role"), role: z.string(), name: z.string(), exact: z.boolean().optional() }),
  // "the field labeled X", optionally scoped to a section.
  z.object({ by: z.literal("label"), label: z.string(), scope: z.string().optional() }),
  // "the {targetCol} cell of the row whose {header} cell reads {cell}" — legacy table anchoring.
  z.object({ by: z.literal("rowAnchor"), header: z.string(), cell: z.string(), targetCol: z.string() }),
  // id/name attribute, if the legacy app happens to expose one.
  z.object({ by: z.literal("attr"), name: z.string(), value: z.string() }),
  z.object({ by: z.literal("text"), text: z.string(), exact: z.boolean().optional() }),
  // Explicitly brittle last resort; its use during replay is logged as a drift signal.
  z.object({ by: z.literal("structural"), css: z.string(), index: z.number().int().nonnegative() }),
]);
export type Locator = z.infer<typeof Locator>;

/** Ordered strategies + invariants that must hold after resolution + frame traversal path. */
export const LocatorBundle = z.object({
  strategies: z.array(Locator).min(1),
  framePath: z.array(z.string()).optional(),
  invariants: z
    .object({
      role: z.string().optional(),
      name: z.string().optional(),
      editable: z.boolean().optional(),
      visible: z.boolean().optional(),
    })
    .default({}),
});
export type LocatorBundle = z.infer<typeof LocatorBundle>;

/** A condition we assert to confirm we actually reached a state (brief glossary: "checkpoint"). */
export const Checkpoint = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("urlMatches"), pattern: z.string() }),
  z.object({ kind: z.literal("elementVisible"), locator: LocatorBundle }),
  z.object({ kind: z.literal("textPresent"), text: z.string(), scope: z.string().optional() }),
  z.object({ kind: z.literal("textAbsent"), text: z.string() }),
  z.object({ kind: z.literal("valueEquals"), locator: LocatorBundle, value: z.string() }),
]);
export type Checkpoint = z.infer<typeof Checkpoint>;

/** The verb for a step. Value/binding lives on the Step, not here. */
export const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), to: z.string() }),
  z.object({ type: z.literal("click") }),
  z.object({ type: z.literal("type") }),
  z.object({ type: z.literal("select") }),
  z.object({ type: z.literal("read") }),
  z.object({ type: z.literal("waitFor"), checkpoint: Checkpoint }),
  z.object({ type: z.literal("assert"), checkpoint: Checkpoint }),
]);
export type Action = z.infer<typeof Action>;

/** Bounded, deterministic recovery for an expected recoverable condition (§9). Never open-ended. */
export const RecoveryRule = z.object({
  when: Checkpoint,
  do: z.enum(["dismiss", "retry", "reauth"]),
  target: LocatorBundle.optional(),
  maxAttempts: z.number().int().positive().default(2),
});
export type RecoveryRule = z.infer<typeof RecoveryRule>;

export const RiskClass = z.enum(["safe", "sensitive", "irreversible"]);
export type RiskClass = z.infer<typeof RiskClass>;
export const Policy = z.enum(["auto", "confirm", "block"]);
export type Policy = z.infer<typeof Policy>;

/** One ordered action in the recorded flow (§6.3). */
export const Step = z.object({
  id: z.string(),
  intent: z.string(),
  action: Action,
  target: LocatorBundle.optional(),
  inputBinding: z.object({ param: z.string() }).optional(),
  literalValue: z.string().optional(),
  precondition: Checkpoint.optional(),
  postcondition: Checkpoint.optional(),
  risk: RiskClass.default("safe"),
  policy: Policy.default("auto"),
  recover: z.array(RecoveryRule).default([]),
});
export type Step = z.infer<typeof Step>;

export const ParamType = z.enum(["string", "number", "boolean", "enum"]);
export const Param = z.object({
  name: z.string(),
  type: ParamType,
  required: z.boolean().default(true),
  description: z.string(),
  example: z.string().optional(),
  enumValues: z.array(z.string()).optional(),
  /** sensitive ⇒ redacted before any persistence (§12). */
  sensitive: z.boolean().default(false),
});
export type Param = z.infer<typeof Param>;

/** Typed extraction contract: what the caller gets back, and where it comes from. */
export const OutputField = z.object({
  name: z.string(),
  type: ParamType,
  description: z.string(),
  source: z.object({
    fromStepId: z.string(),
    extract: z.enum(["text", "value", "attribute"]),
    attribute: z.string().optional(),
  }),
});
export type OutputField = z.infer<typeof OutputField>;

/** A declared expected non-success result. "no such member" is a RESULT, not a crash (§9). */
export const BusinessOutcome = z.object({
  code: z.string(),
  detect: Checkpoint,
  returns: z.record(z.unknown()).optional(),
  terminal: z.boolean().default(true),
});
export type BusinessOutcome = z.infer<typeof BusinessOutcome>;

export const Guardrails = z.object({
  allowlist: z.object({
    routes: z.array(z.string()),
    actions: z.array(ActionType),
  }),
});

export const Provenance = z.object({
  discoveredBy: z.object({ provider: z.string(), model: z.string() }),
  discoveredAt: z.string(),
  sourceRunId: z.string(),
  evidenceRef: z.string(),
  /** integrity over steps+schema; the raw transcript is NOT inlined (§6.1). */
  checksum: z.string(),
});

/** THE artifact. Keyed by appFamily, not a tenant URL, so it reuses across tenants (§11). */
export const Capability = z.object({
  schemaVersion: z.literal("1.0.0"),
  capabilityId: z.string(),
  version: z.string(),
  name: z.string(),
  description: z.string(),
  labels: z.array(z.string()).default([]),
  target: z.object({
    appFamily: z.string(),
    surfaceKind: z.enum(["web", "desktop"]).default("web"),
    entryPoint: z.string(),
    compatibleVersions: z.string().optional(),
  }),
  inputs: z.array(Param).default([]),
  outputs: z.array(OutputField).default([]),
  steps: z.array(Step).min(1),
  successCondition: Checkpoint,
  businessOutcomes: z.array(BusinessOutcome).default([]),
  guardrails: Guardrails,
  provenance: Provenance,
});
export type Capability = z.infer<typeof Capability>;

export const SCHEMA_VERSION = "1.0.0" as const;
