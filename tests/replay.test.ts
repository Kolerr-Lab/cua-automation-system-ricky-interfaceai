import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { startMockBank } from "../mock-bank/src/server.js";
import { WebSurface } from "../src/surface/web-surface.js";
import { SafetyGate } from "../src/safety/allowlist.js";
import { TraceWriter, makeRunId } from "../src/evidence/trace.js";
import { MockLlmProvider, readSavingsScript } from "../src/llm/mock.js";
import { discover, type DiscoverySpec } from "../src/agent/loop.js";
import { replay } from "../src/replay/engine.js";
import type { Capability } from "../src/artifact/schema.js";
import type { TenantProfile } from "../src/tenant/profile.js";

let server: Server;
let surface: WebSurface;
let base: string;
let evidenceDir: string;
let cap: Capability;

const ALL = ["navigate", "click", "type", "select", "read", "waitFor", "assert"] as const;
const gate = () => new SafetyGate({ routes: ["http://localhost:**"], actions: [...ALL] });
const profile = (tenantId: string, labelOverrides: Record<string, string> = {}): TenantProfile => ({
  tenantId,
  appFamily: "acme-corebanking",
  baseUrl: `${base}/t/${tenantId}`,
  labelOverrides,
});

async function arm(patch: Record<string, unknown>): Promise<void> {
  await fetch(`${base}/__chaos`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
}

function spec(): DiscoverySpec {
  return {
    capabilityId: "member.read-savings-balance",
    name: "Read member savings balance",
    description: "Sign on, look up the member, and read their current savings balance.",
    appFamily: "acme-corebanking",
    entryPoint: "/",
    tenantBaseUrl: `${base}/t/acme`,
    inputs: [
      { name: "userId", type: "string", required: true, description: "Operator user id", sensitive: false, value: "teller01" },
      { name: "password", type: "string", required: true, description: "Operator password", sensitive: true, value: "pw" },
      { name: "memberId", type: "string", required: true, description: "Member number", sensitive: false, value: "12345" },
    ],
    successCondition: { kind: "textPresent", text: "Savings Balance" },
    businessOutcomes: [
      { code: "member_not_found", detect: { kind: "textPresent", text: "No such member" }, terminal: true },
      { code: "permission_denied", detect: { kind: "textPresent", text: "not authorized" }, terminal: true },
    ],
    recovery: [
      { when: { kind: "textPresent", text: "System Notice" }, do: "dismiss", target: { strategies: [{ by: "role", role: "link", name: "Continue" }, { by: "text", text: "Continue" }], framePath: ["content"], invariants: {} }, maxAttempts: 2 },
      { when: { kind: "textPresent", text: "temporarily unavailable" }, do: "retry", framePath: ["content"], maxAttempts: 3 },
      { when: { kind: "textPresent", text: "session has expired" }, do: "reauth", maxAttempts: 1 },
    ],
  };
}

const inputs = { userId: "teller01", password: "pw", memberId: "12345" };

function newTrace() {
  return new TraceWriter(makeRunId("replay", cap.capabilityId), "replay", evidenceDir);
}

beforeAll(async () => {
  server = await startMockBank(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  surface = await WebSurface.launch();
  evidenceDir = mkdtempSync(join(tmpdir(), "cua-rp-"));
  const s = spec();
  const disc = await discover(s, {
    provider: new MockLlmProvider(readSavingsScript()),
    surface,
    safety: gate(),
    allowlist: { routes: ["http://localhost:4010/**"], actions: [...ALL] },
    trace: new TraceWriter(makeRunId("discovery", s.capabilityId), "discovery", evidenceDir),
  });
  if (disc.status !== "success") throw new Error("discovery failed: " + JSON.stringify(disc));
  cap = disc.capability;
}, 40_000);

afterAll(async () => {
  await surface?.close();
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(evidenceDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await arm({ reset: true });
});

describe("deterministic replay + error taxonomy", () => {
  it("SUCCESS: replays with no model and returns typed outputs", async () => {
    const r = await replay(cap, inputs, { surface, safety: gate(), trace: newTrace(), tenant: profile("acme") });
    expect(r.status).toBe("success");
    if (r.status === "success") expect(r.outputs.savingsBalance).toBe("$4,210.55");
  });

  it("BUSINESS_OUTCOME: member_not_found is a result, not a crash", async () => {
    const r = await replay(cap, { ...inputs, memberId: "00000" }, { surface, safety: gate(), trace: newTrace(), tenant: profile("acme") });
    expect(r.status).toBe("business_outcome");
    if (r.status === "business_outcome") expect(r.code).toBe("member_not_found");
  });

  it("BUSINESS_OUTCOME: permission_denied", async () => {
    const r = await replay(cap, { ...inputs, memberId: "99999" }, { surface, safety: gate(), trace: newTrace(), tenant: profile("acme") });
    expect(r.status).toBe("business_outcome");
    if (r.status === "business_outcome") expect(r.code).toBe("permission_denied");
  });

  it("RECOVERED: dismisses an injected interstitial, then succeeds", async () => {
    await arm({ interstitial: true });
    const r = await replay(cap, inputs, { surface, safety: gate(), trace: newTrace(), tenant: profile("acme") });
    expect(r.status).toBe("success");
    if (r.status === "success") expect(r.recovery.some((x) => x.startsWith("dismiss"))).toBe(true);
  });

  it("RECOVERED: retries a transient failure, then succeeds", async () => {
    await arm({ transientFails: 1 });
    const r = await replay(cap, inputs, { surface, safety: gate(), trace: newTrace(), tenant: profile("acme") });
    expect(r.status).toBe("success");
    if (r.status === "success") expect(r.recovery.some((x) => x.startsWith("retry"))).toBe(true);
  });

  it("ESCALATION_REQUIRED: an irreversible step is handed to a human, not auto-performed", async () => {
    const risky: Capability = { ...cap, steps: cap.steps.map((st) => (st.action.type === "read" ? { ...st, policy: "confirm" } : st)) };
    const r = await replay(risky, inputs, { surface, safety: gate(), trace: newTrace(), tenant: profile("acme") });
    expect(r.status).toBe("escalation_required");
    if (r.status === "escalation_required") expect(r.intervention.reason).toBe("risky_confirmation");
  });

  it("HARD_FAILURE: an unresolvable locator stops with a debuggable error", async () => {
    const broken: Capability = {
      ...cap,
      steps: cap.steps.map((st) => (st.action.type === "read" ? { ...st, target: { strategies: [{ by: "rowAnchor" as const, header: "label", cell: "No Such Row", targetCol: "value" }], framePath: ["content"], invariants: {} } } : st)),
    };
    const r = await replay(broken, inputs, { surface, safety: gate(), trace: newTrace(), tenant: profile("acme") });
    expect(r.status).toBe("hard_failure");
    if (r.status === "hard_failure") expect(r.failure.category).toBe("LOCATOR_UNRESOLVED");
  });

  it("GUARDRAIL_BLOCKED: an action outside the allowlist is refused", async () => {
    const lockedGate = new SafetyGate({ routes: ["http://localhost:**"], actions: ["navigate", "type", "read"] }); // no 'click'
    const r = await replay(cap, inputs, { surface, safety: lockedGate, trace: newTrace(), tenant: profile("acme") });
    expect(r.status).toBe("hard_failure");
    if (r.status === "hard_failure") expect(r.failure.category).toBe("GUARDRAIL_BLOCKED");
  });

  it("CROSS-TENANT: the acme-recorded capability replays on rebranded globus via overrides", async () => {
    const r = await replay(cap, inputs, { surface, safety: gate(), trace: newTrace(), tenant: profile("globus", { "Savings Balance": "Savings Bal." }) });
    expect(r.status).toBe("success");
    if (r.status === "success") expect(r.outputs.savingsBalance).toBe("$4,210.55");
  });
});
