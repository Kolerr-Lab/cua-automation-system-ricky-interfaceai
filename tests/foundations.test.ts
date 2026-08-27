import { describe, it, expect } from "vitest";
import { SafetyGate } from "../src/safety/allowlist.js";
import { Redactor } from "../src/safety/redaction.js";
import { classifyRisk } from "../src/safety/risk.js";
import { checksumCapability, parseCapability } from "../src/artifact/store.js";
import type { Capability } from "../src/artifact/schema.js";

const fixture: Capability = parseCapability({
  schemaVersion: "1.0.0",
  capabilityId: "member.read-savings-balance",
  version: "1.0.0",
  name: "Read member savings balance",
  description: "Look up a member and read their current savings balance.",
  labels: ["member", "read"],
  target: { appFamily: "acme-corebanking", surfaceKind: "web", entryPoint: "/home" },
  inputs: [{ name: "memberId", type: "string", required: true, description: "Member number", sensitive: false }],
  outputs: [
    { name: "savingsBalance", type: "string", description: "Current savings balance", source: { fromStepId: "s4", extract: "text" } },
  ],
  steps: [
    { id: "s1", intent: "go home", action: { type: "navigate", to: "/home" } },
    {
      id: "s2",
      intent: "type member id into the search box",
      action: { type: "type" },
      target: { strategies: [{ by: "label", label: "Member #" }], invariants: { editable: true } },
      inputBinding: { param: "memberId" },
    },
  ],
  successCondition: { kind: "textPresent", text: "Savings Balance" },
  businessOutcomes: [{ code: "member_not_found", detect: { kind: "textPresent", text: "No such member" }, terminal: true }],
  guardrails: { allowlist: { routes: ["http://localhost:4010/**"], actions: ["navigate", "type", "read"] } },
  provenance: {
    discoveredBy: { provider: "mock", model: "mock-1" },
    discoveredAt: "2026-08-27T00:00:00.000Z",
    sourceRunId: "discovery-x",
    evidenceRef: "evidence/discovery-x",
    checksum: "",
  },
});

describe("allowlist", () => {
  const gate = new SafetyGate({ routes: ["http://localhost:4010/**"], actions: ["navigate", "click", "type"] });
  it("matches ** across path segments", () => {
    expect(gate.isRouteAllowed("http://localhost:4010/t/acme/member/123")).toBe(true);
    expect(gate.isRouteAllowed("http://evil.example/x")).toBe(false);
  });
  it("gates action types", () => {
    expect(gate.check("navigate", "http://localhost:4010/x")).toBeNull();
    expect(gate.check("select")).toMatch(/not in allowlist/);
  });
});

describe("redaction", () => {
  it("masks sensitive bound values and secret-like patterns", () => {
    const r = new Redactor([{ value: "hunter2", name: "password" }]);
    expect(r.string("pw=hunter2")).toBe("pw=«redacted:password»");
    expect(r.string("card 4111111111111111")).toContain("«redacted:card»");
    const deep = r.data({ a: "hunter2", b: ["Bearer abc.def", 5] });
    expect(deep).toEqual({ a: "«redacted:password»", b: ["«redacted:token»", 5] });
  });
});

describe("risk", () => {
  it("flags irreversible intents", () => {
    expect(classifyRisk({ type: "click" }, "click the search button")).toBe("safe");
    expect(classifyRisk({ type: "click" }, "confirm and submit the transfer")).toBe("irreversible");
  });
});

describe("capability checksum", () => {
  it("is stable and independent of key order", () => {
    const a = checksumCapability(fixture);
    const reordered = parseCapability({ ...JSON.parse(JSON.stringify(fixture)) });
    expect(checksumCapability(reordered)).toBe(a);
  });
  it("changes when the flow changes (tamper detection)", () => {
    const before = checksumCapability(fixture);
    const tampered: Capability = { ...fixture, steps: [...fixture.steps, { ...fixture.steps[0]!, id: "sX" }] };
    expect(checksumCapability(tampered)).not.toBe(before);
  });
});
