import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { startMockBank } from "../mock-bank/src/server.js";
import { WebSurface } from "../src/surface/web-surface.js";
import { SafetyGate } from "../src/safety/allowlist.js";
import { Redactor } from "../src/safety/redaction.js";
import { TraceWriter, makeRunId } from "../src/evidence/trace.js";
import { MockLlmProvider, readSavingsScript } from "../src/llm/mock.js";
import { discover, type DiscoverySpec } from "../src/agent/loop.js";
import { loadCapability } from "../src/artifact/store.js";

let server: Server;
let surface: WebSurface;
let base: string;
let evidenceDir: string;

beforeAll(async () => {
  server = await startMockBank(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  surface = await WebSurface.launch();
  evidenceDir = mkdtempSync(join(tmpdir(), "cua-ev-"));
}, 30_000);

afterAll(async () => {
  await surface?.close();
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(evidenceDir, { recursive: true, force: true });
});

const PASSWORD = "SEKRET-PW-123";

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
      { name: "password", type: "string", required: true, description: "Operator password", sensitive: true, value: PASSWORD },
      { name: "memberId", type: "string", required: true, description: "Member number", sensitive: false, value: "12345" },
    ],
    successCondition: { kind: "textPresent", text: "Savings Balance" },
    businessOutcomes: [
      { code: "member_not_found", detect: { kind: "textPresent", text: "No such member" }, terminal: true },
      { code: "permission_denied", detect: { kind: "textPresent", text: "not authorized" }, terminal: true },
    ],
  };
}

describe("discovery", () => {
  it("drives the goal, emits a parameterized capability, and redacts secrets", async () => {
    const s = spec();
    const redactor = new Redactor(s.inputs.filter((i) => i.sensitive).map((i) => ({ value: i.value, name: i.name })));
    const trace = new TraceWriter(makeRunId("discovery", s.capabilityId), "discovery", evidenceDir, redactor);
    const result = await discover(s, {
      provider: new MockLlmProvider(readSavingsScript()),
      surface,
      safety: new SafetyGate({ routes: ["http://localhost:**"], actions: ["navigate", "click", "type", "select", "read", "waitFor", "assert"] }),
      allowlist: { routes: ["http://localhost:4010/**"], actions: ["navigate", "click", "type", "select", "read", "waitFor", "assert"] },
      trace,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;

    // The model discovered a real value.
    expect(result.outputs.savingsBalance).toBe("$4,210.55");

    // The capability is parameterized: the member number is bound to an input, not hardcoded.
    const typeMember = result.capability.steps.find((st) => st.inputBinding?.param === "memberId");
    expect(typeMember).toBeTruthy();
    expect(result.capability.steps.some((st) => st.literalValue === "12345")).toBe(false);

    // Typed contract: inputs + output shape are captured.
    expect(result.capability.inputs.map((i) => i.name)).toEqual(["userId", "password", "memberId"]);
    expect(result.capability.outputs[0]?.name).toBe("savingsBalance");

    // The saved artifact validates and its checksum is intact.
    const reloaded = await loadCapability(result.artifactPath);
    expect(reloaded.capabilityId).toBe("member.read-savings-balance");

    // The secret never reaches disk (trace or artifact).
    const traceText = readFileSync(join(trace.dir, "trace.jsonl"), "utf8");
    const artifactText = readFileSync(result.artifactPath, "utf8");
    expect(traceText).not.toContain(PASSWORD);
    expect(artifactText).not.toContain(PASSWORD);
  });
});
