/**
 * Artifact store: validate, checksum, persist and load Capabilities (blueprint §6.1, §13).
 * The checksum covers the recorded flow (not provenance itself), giving integrity independent of
 * where/when it was discovered.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Capability } from "./schema.js";

/** Recursively key-sorted JSON so the checksum is independent of property insertion order. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Deterministic checksum over the parts that define behavior (everything except the checksum). */
export function checksumCapability(cap: Capability): string {
  const { checksum: _omit, ...prov } = cap.provenance;
  const canonical = stableStringify({ ...cap, provenance: prov });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/** Parse + validate untrusted JSON into a Capability (throws with a precise Zod error otherwise). */
export function parseCapability(raw: unknown): Capability {
  return Capability.parse(raw);
}

export async function saveCapability(path: string, cap: Capability): Promise<Capability> {
  const withChecksum: Capability = {
    ...cap,
    provenance: { ...cap.provenance, checksum: checksumCapability(cap) },
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(withChecksum, null, 2) + "\n", "utf8");
  return withChecksum;
}

export async function loadCapability(path: string): Promise<Capability> {
  const cap = parseCapability(JSON.parse(await readFile(path, "utf8")));
  const expected = checksumCapability(cap);
  if (cap.provenance.checksum && cap.provenance.checksum !== expected) {
    throw new Error(`Capability checksum mismatch for ${cap.capabilityId}: file tampered or schema drift.`);
  }
  return cap;
}

/** Load every *.json capability in a directory — backs the catalog (§8.4). */
export async function loadCapabilityDir(dir: string): Promise<Capability[]> {
  const entries = await readdir(dir).catch(() => [] as string[]);
  const out: Capability[] = [];
  for (const f of entries.filter((f) => f.endsWith(".json"))) {
    out.push(await loadCapability(join(dir, f)));
  }
  return out;
}
