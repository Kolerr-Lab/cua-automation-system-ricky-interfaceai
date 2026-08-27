/** CLI helpers: build runtime deps from config files and parse args. No business logic. */
import { readFile } from "node:fs/promises";
import type { Allowlist } from "../safety/allowlist.js";
import { SafetyGate } from "../safety/allowlist.js";
import type { TenantProfile } from "../tenant/profile.js";
import { loadTenants } from "../tenant/profile.js";

export async function loadAllowlist(path = "config/allowlist.json"): Promise<Allowlist> {
  const raw = JSON.parse(await readFile(path, "utf8")) as { routes: string[]; actions: Allowlist["actions"] };
  return { routes: raw.routes, actions: raw.actions };
}

export async function safetyGate(path?: string): Promise<SafetyGate> {
  return new SafetyGate(await loadAllowlist(path));
}

export async function tenant(id: string, path = "config/tenants.json"): Promise<TenantProfile> {
  const tenants = await loadTenants(path);
  const t = tenants[id];
  if (!t) throw new Error(`unknown tenant '${id}' (have: ${Object.keys(tenants).join(", ")})`);
  return t;
}

export function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export function has(args: string[], name: string): boolean {
  return args.includes(name);
}

/** Collect every `--input k=v` into a map. */
export function inputs(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  args.forEach((a, i) => {
    if (a === "--input" && args[i + 1]) {
      const [k, ...v] = args[i + 1]!.split("=");
      if (k) out[k] = v.join("=");
    }
  });
  return out;
}
