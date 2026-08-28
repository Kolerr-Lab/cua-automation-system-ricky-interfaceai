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
import { saveCapability } from "../src/artifact/store.js";
import { Catalog } from "../src/catalog/catalog.js";
import type { TenantProfile } from "../src/tenant/profile.js";

let server: Server;
let surface: WebSurface;
let base: string;
let dir: string;
let catalog: Catalog;

const ALL = ["navigate", "click", "type", "select", "read", "waitFor", "assert"] as const;
const gate = () => new SafetyGate({ routes: ["http://127.0.0.1:**"], actions: [...ALL] });
const profile = (id: string, labelOverrides: Record<string, string> = {}): TenantProfile => ({ tenantId: id, appFamily: "acme-corebanking", baseUrl: `${base}/t/${id}`, labelOverrides });
const deps = (id: string, labelOverrides?: Record<string, string>) => ({ surface, safety: gate(), trace: new TraceWriter(makeRunId("replay", "cat"), "replay", dir), tenant: profile(id, labelOverrides) });
const args = { userId: "teller01", password: "pw", memberId: "12345" };

beforeAll(async () => {
  server = await startMockBank(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  surface = await WebSurface.launch();
  dir = mkdtempSync(join(tmpdir(), "cua-cat-"));
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
  let disc;
  for (let i = 0; i < 3; i++) {
    disc = await discover(s, { provider: new MockLlmProvider(readSavingsScript()), surface, safety: gate(), allowlist: { routes: ["http://127.0.0.1:4010/**"], actions: [...ALL] }, trace: new TraceWriter(makeRunId("discovery", s.capabilityId), "discovery", dir) });
    if (disc.status === "success") break;
  }
  if (disc?.status !== "success") throw new Error("discovery failed: " + JSON.stringify(disc));
  await saveCapability(join(dir, "catalog", "read-savings.json"), disc.capability);
  catalog = await Catalog.fromDir(join(dir, "catalog"));
}, 40_000);

const arm = async (patch: Record<string, unknown>) => {
  await fetch(`${base}/__chaos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
};

afterAll(async () => {
  await surface?.close();
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await arm({ reset: true });
  if (surface) await surface.page.context().clearCookies();
});

describe("agent-facing capability catalog", () => {
  it("lists capabilities with their typed contract", () => {
    const entry = catalog.list().find((e) => e.capabilityId === "member.read-savings-balance");
    expect(entry).toBeTruthy();
    expect(entry!.inputs.map((i) => i.name)).toEqual(["userId", "password", "memberId"]);
    expect(entry!.inputs.find((i) => i.name === "password")!.sensitive).toBe(true);
    expect(entry!.outputs[0]!.name).toBe("savingsBalance");
  });

  it("invokes a capability by name with typed args", async () => {
    const r = await catalog.invoke("member.read-savings-balance", args, deps("acme"));
    if (r.status !== "success") {
      console.error("FAILURE LOG:", JSON.stringify(r.failure, null, 2));
      const html = await surface.page.content();
      const frameHtml = await surface.page.frame({ name: "content" })?.content();
      console.error("MAIN HTML:", html.slice(0, 500));
      console.error("FRAME HTML:", frameHtml);
    }
    expect(r.status).toBe("success");
    if (r.status === "success") expect(r.outputs.savingsBalance).toBe("$4,210.55");
  });

  it("rejects invalid args before touching the UI", async () => {
    const r = await catalog.invoke("member.read-savings-balance", { userId: "teller01", password: "pw" }, deps("acme"));
    expect(r.status).toBe("hard_failure");
    if (r.status === "hard_failure") {
      expect(r.failure.category).toBe("INVALID_INPUT");
      expect(r.failure.observed).toContain("memberId");
    }
  });

  it("reuses the same capability across a rebranded tenant (globus)", async () => {
    const r = await catalog.invoke("member.read-savings-balance", args, deps("globus", { "Savings Balance": "Savings Bal." }));
    expect(r.status).toBe("success");
    if (r.status === "success") expect(r.outputs.savingsBalance).toBe("$4,210.55");
  });
});
