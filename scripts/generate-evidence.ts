/**
 * Generates the committed /evidence set with clean run names, using the offline MockLlmProvider so
 * reviewers can reproduce it with no keys or network (`npm run evidence`). It exercises the full
 * thread: a discovery run → a saved capability → deterministic replays covering success, a business
 * outcome, a recovered exceptional state, a hard failure, and cross-tenant reuse.
 *
 * The ONE mandatory REAL model run is produced separately with `--provider openai` on a machine with
 * egress (this sandbox blocks api.openai.com); see README. That run lands as evidence/01-discovery-openai.
 */
import { rmSync } from "node:fs";
import { startMockBank } from "../mock-bank/src/server.js";
import { WebSurface } from "../src/surface/web-surface.js";
import { SafetyGate } from "../src/safety/allowlist.js";
import { Redactor } from "../src/safety/redaction.js";
import { TraceWriter } from "../src/evidence/trace.js";
import { MockLlmProvider, readSavingsScript } from "../src/llm/mock.js";
import { discover, type DiscoverySpec } from "../src/agent/loop.js";
import { saveCapability } from "../src/artifact/store.js";
import { replay } from "../src/replay/engine.js";
import type { Capability } from "../src/artifact/schema.js";
import type { TenantProfile } from "../src/tenant/profile.js";
import specJson from "../specs/read-savings.json" with { type: "json" };

const PORT = 4010;
const BASE = `http://localhost:${PORT}`;
const ALL = ["navigate", "click", "type", "select", "read", "waitFor", "assert"] as const;
const gate = () => new SafetyGate({ routes: ["http://localhost:4010/**"], actions: [...ALL] });
const prof = (id: string, labelOverrides: Record<string, string> = {}): TenantProfile => ({ tenantId: id, appFamily: "acme-corebanking", baseUrl: `${BASE}/t/${id}`, labelOverrides });
const chaos = (patch: Record<string, unknown>) => fetch(`${BASE}/__chaos`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
const args = { userId: "teller01", password: "demo-pass", memberId: "12345" };

async function run(cap: Capability, name: string, tenantId: string, inputs: Record<string, string>): Promise<void> {
  const trace = new TraceWriter(name, "replay", "evidence");
  const result = await replay(cap, inputs, { surface, safety: gate(), trace, tenant: prof(tenantId, tenantId === "globus" ? { "Savings Balance": "Savings Bal." } : {}) });
  trace.writeJson("result", result);
  const tag = result.status === "business_outcome" ? `(${result.code})` : result.status === "hard_failure" ? `(${result.failure.category})` : result.status === "success" ? `outputs=${JSON.stringify(result.outputs)} recovery=${JSON.stringify(result.recovery)}` : "";
  console.log(`  ${name} → ${result.status} ${tag}`);
}

rmSync("evidence", { recursive: true, force: true });
const server = await startMockBank(PORT);
const surface = await WebSurface.launch();

// 1) Discovery (offline mock model) → capability artifact + catalog entry.
const spec = { ...(specJson as unknown as DiscoverySpec), tenantBaseUrl: `${BASE}/t/acme` };
const redactor = new Redactor(spec.inputs.filter((i) => i.sensitive).map((i) => ({ value: i.value, name: i.name })));
const disc = await discover(spec, {
  provider: new MockLlmProvider(readSavingsScript()),
  surface,
  safety: gate(),
  allowlist: { routes: ["http://localhost:4010/**"], actions: [...ALL] },
  trace: new TraceWriter("01-discovery-mock", "discovery", "evidence", redactor),
});
if (disc.status !== "success") throw new Error("discovery failed: " + JSON.stringify(disc));
await saveCapability("catalog/member.read-savings-balance.json", disc.capability);
console.log(`  01-discovery-mock → success, ${disc.capability.steps.length} steps, outputs=${JSON.stringify(disc.outputs)}`);
const cap = disc.capability;

// 2..6) Deterministic replays across the taxonomy.
await chaos({ reset: true });
await run(cap, "02-replay-success", "acme", args);
await chaos({ reset: true });
await run(cap, "03-replay-business-not-found", "acme", { ...args, memberId: "00000" });
await chaos({ reset: true, interstitial: true });
await run(cap, "04-replay-recovered-interstitial", "acme", args);
await chaos({ reset: true, transientFails: 50 }); // storm exceeds bounded retries -> hard failure (with screenshot)
await run(cap, "05-replay-hard-failure", "acme", args);
await chaos({ reset: true });
await run(cap, "06-replay-cross-tenant-globus", "globus", args);

await surface.close();
await new Promise<void>((r) => server.close(() => r()));
console.log("evidence/ generated.");
