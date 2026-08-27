/**
 * Thin CLI (blueprint §5). Command wiring only. Commands:
 *   serve-mock · discover · replay · catalog (list|invoke) · operator
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { flag, has, inputs, loadAllowlist, safetyGate, tenant } from "./deps.js";

const [cmd, sub, ...rest] = process.argv.slice(2);
const argv = [sub, ...rest].filter((x): x is string => x !== undefined);

async function main(): Promise<void> {
  switch (cmd) {
    case "serve-mock":
      return serveMock(argv);
    case "discover":
      return discoverCmd(argv);
    case "replay":
      return replayCmd(argv);
    case "catalog":
      return catalogCmd(sub ?? "", rest);
    case "operator":
      return operatorCmd(argv);
    default:
      console.error("commands: serve-mock | discover | replay | catalog <list|invoke> | operator");
      process.exit(1);
  }
}

async function serveMock(args: string[]): Promise<void> {
  const { startMockBank } = await import("../../mock-bank/src/server.js");
  const port = Number(flag(args, "--port") ?? 4010);
  await startMockBank(port);
  console.log(`mock-bank on http://localhost:${port}  (tenants: /t/acme, /t/globus)`);
}

async function discoverCmd(args: string[]): Promise<void> {
  const { WebSurface } = await import("../surface/web-surface.js");
  const { TraceWriter, makeRunId } = await import("../evidence/trace.js");
  const { Redactor } = await import("../safety/redaction.js");
  const { discover } = await import("../agent/loop.js");
  const { saveCapability } = await import("../artifact/store.js");
  const { MockLlmProvider, readSavingsScript } = await import("../llm/mock.js");

  const specPath = flag(args, "--spec") ?? "specs/read-savings.json";
  const tenantId = flag(args, "--tenant") ?? "acme";
  const providerKind = flag(args, "--provider") ?? "mock";
  const spec = JSON.parse(await readFile(specPath, "utf8"));
  const t = await tenant(tenantId);
  const allowlist = await loadAllowlist();
  const provider = providerKind === "openai" ? new (await import("../llm/openai.js")).OpenAiProvider() : new MockLlmProvider(readSavingsScript());

  const surface = await WebSurface.launch({ headless: !has(args, "--headed") });
  const redactor = new Redactor((spec.inputs ?? []).filter((i: { sensitive: boolean }) => i.sensitive).map((i: { value: string; name: string }) => ({ value: i.value, name: i.name })));
  const trace = new TraceWriter(makeRunId("discovery", spec.capabilityId), "discovery", "evidence", redactor);
  try {
    const result = await discover({ ...spec, tenantBaseUrl: t.baseUrl }, { provider, surface, safety: await safetyGate(), allowlist, trace });
    if (result.status === "success") {
      await saveCapability(join("catalog", `${spec.capabilityId}.json`), result.capability);
      console.log(`✓ discovered ${result.capability.capabilityId} (${result.capability.steps.length} steps)`);
      console.log(`  artifact: ${result.artifactPath}`);
      console.log(`  catalog:  catalog/${spec.capabilityId}.json`);
      console.log(`  outputs:  ${JSON.stringify(result.outputs)}`);
      console.log(`  evidence: ${trace.dir}`);
    } else {
      console.error(`✗ discovery ${result.status}: ${result.reason}`);
      process.exitCode = 1;
    }
  } finally {
    await surface.close();
  }
}

async function replayCmd(args: string[]): Promise<void> {
  const { WebSurface } = await import("../surface/web-surface.js");
  const { TraceWriter, makeRunId } = await import("../evidence/trace.js");
  const { loadCapability } = await import("../artifact/store.js");
  const { replay } = await import("../replay/engine.js");

  const artifactPath = flag(args, "--artifact");
  if (!artifactPath) return void console.error("replay --artifact <path> --tenant <id> --input k=v ...");
  const cap = await loadCapability(artifactPath);
  const t = await tenant(flag(args, "--tenant") ?? "acme");
  const trace = new TraceWriter(makeRunId("replay", cap.capabilityId), "replay", "evidence");

  const surface = await WebSurface.launch({ headless: !has(args, "--headed") });
  try {
    const result = await replay(cap, inputs(args), { surface, safety: await safetyGate(), trace, tenant: t });
    trace.writeJson("result", result);
    console.log(`replay → ${result.status}${result.status === "business_outcome" ? ` (${result.code})` : ""}${result.status === "hard_failure" ? ` (${result.failure.category})` : ""}`);
    if (result.status === "success") console.log(`  outputs: ${JSON.stringify(result.outputs)}  recovery: ${JSON.stringify(result.recovery)}`);
    console.log(`  evidence: ${trace.dir}`);
    if (result.status === "hard_failure") process.exitCode = 1;
  } finally {
    await surface.close();
  }
}

async function catalogCmd(action: string, args: string[]): Promise<void> {
  const { Catalog } = await import("../catalog/catalog.js");
  const dir = flag(args, "--dir") ?? "catalog";
  const catalog = await Catalog.fromDir(dir);
  if (action === "list") {
    for (const e of catalog.list()) console.log(`${e.capabilityId}  v${e.version}  [${e.appFamily}]  in(${e.inputs.map((i) => i.name).join(",")}) out(${e.outputs.map((o) => o.name).join(",")})`);
    return;
  }
  if (action === "invoke") {
    const id = args[0];
    if (!id) return void console.error("catalog invoke <capabilityId> --tenant <id> --input k=v ...");
    const { WebSurface } = await import("../surface/web-surface.js");
    const { TraceWriter, makeRunId } = await import("../evidence/trace.js");
    const t = await tenant(flag(args, "--tenant") ?? "acme");
    const surface = await WebSurface.launch({ headless: !has(args, "--headed") });
    try {
      const result = await catalog.invoke(id, inputs(args), { surface, safety: await safetyGate(), trace: new TraceWriter(makeRunId("replay", id), "replay", "evidence"), tenant: t });
      console.log(`invoke ${id} → ${result.status}`);
      if (result.status === "success") console.log(`  outputs: ${JSON.stringify(result.outputs)}`);
      if (result.status === "business_outcome") console.log(`  code: ${result.code}`);
      if (result.status === "hard_failure") console.log(`  ${result.failure.category}: ${result.failure.observed}`);
    } finally {
      await surface.close();
    }
    return;
  }
  console.error("catalog <list|invoke>");
}

async function operatorCmd(args: string[]): Promise<void> {
  const { serveOperatorPanel } = await import("../escalation/panel.js");
  const port = Number(flag(args, "--port") ?? 4020);
  await serveOperatorPanel(port, flag(args, "--evidence") ?? "evidence");
  console.log(`operator panel on http://localhost:${port}  (renders pending interventions from evidence/)`);
}

void main();
