import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
import { runWithHandoff, scriptedOperator } from "../src/escalation/handoff.js";
import type { Capability } from "../src/artifact/schema.js";
import type { TenantProfile } from "../src/tenant/profile.js";

let server: Server;
let surface: WebSurface;
let base: string;
let evidenceDir: string;
let cap: Capability;

const ALL = ["navigate", "click", "type", "select", "read", "waitFor", "assert"] as const;
const gate = () => new SafetyGate({ routes: ["http://localhost:**"], actions: [...ALL] });
const profile = (): TenantProfile => ({ tenantId: "acme", appFamily: "acme-corebanking", baseUrl: `${base}/t/acme`, labelOverrides: {} });
const inputs = { userId: "teller01", password: "pw", memberId: "12345" };

beforeAll(async () => {
  server = await startMockBank(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  surface = await WebSurface.launch();
  evidenceDir = mkdtempSync(join(tmpdir(), "cua-esc-"));
  const s: DiscoverySpec = {
    capabilityId: "member.read-savings-balance",
    name: "Read member savings balance",
    description: "Sign on, look up the member, and read their savings balance.",
    appFamily: "acme-corebanking",
    entryPoint: "/",
    tenantBaseUrl: `${base}/t/acme`,
    inputs: [
      { name: "userId", type: "string", required: true, description: "Operator user id", sensitive: false, value: "teller01" },
      { name: "password", type: "string", required: true, description: "Operator password", sensitive: true, value: "pw" },
      { name: "memberId", type: "string", required: true, description: "Member number", sensitive: false, value: "12345" },
    ],
    successCondition: { kind: "textPresent", text: "Savings Balance" },
  };
  const disc = await discover(s, {
    provider: new MockLlmProvider(readSavingsScript()),
    surface,
    safety: gate(),
    allowlist: { routes: ["http://localhost:4010/**"], actions: [...ALL] },
    trace: new TraceWriter(makeRunId("discovery", s.capabilityId), "discovery", evidenceDir),
  });
  if (disc.status !== "success") throw new Error("discovery failed");
  cap = disc.capability;
}, 40_000);

afterAll(async () => {
  await surface?.close();
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(evidenceDir, { recursive: true, force: true });
});

describe("human-in-the-loop control transfer", () => {
  it("cedes control on a risky step, the human acts on the SAME session, then automation resumes to success", async () => {
    // Mark the member-search step as requiring confirmation (an irreversible-class action).
    const risky: Capability = { ...cap, steps: cap.steps.map((st) => (st.intent.includes("Find") ? { ...st, policy: "confirm" } : st)) };

    // The "human" performs the step in the live session the automation was driving (not a fresh one).
    const operator = scriptedOperator(async ({ deps, controller }) => {
      const find = await deps.surface.resolve({ strategies: [{ by: "role", role: "button", name: "Find" }], framePath: ["content"], invariants: {} });
      expect(find).not.toBeNull();
      await deps.surface.click(find!);
      await deps.surface.waitForCheckpoint({ kind: "textPresent", text: "Member Detail" }); // human confirms the step landed
      controller.record({ kind: "click", detail: "human clicked Find (member search)" });
    });

    const trace = new TraceWriter(makeRunId("replay", cap.capabilityId), "replay", evidenceDir);
    const out = await runWithHandoff(risky, inputs, { surface, safety: gate(), trace, tenant: profile() }, operator);

    expect(out.handoffs).toBe(1);
    expect(out.result.status).toBe("success");
    if (out.result.status === "success") expect(out.result.outputs.savingsBalance).toBe("$4,210.55");
    expect(out.humanActions.some((a) => a.kind === "click")).toBe(true);
    expect(out.humanActions.some((a) => a.kind === "resume")).toBe(true);
  });
});
