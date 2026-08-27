/**
 * Tenant profiles (blueprint §11). One capability keyed by appFamily replays across tenants running
 * the same vendor product; the profile injects the base URL and absorbs cosmetic label drift via
 * overrides applied to locators AND checkpoints at replay time.
 */
import { readFile } from "node:fs/promises";
import type { Checkpoint, Locator, LocatorBundle } from "../artifact/schema.js";

export interface TenantProfile {
  tenantId: string;
  appFamily: string;
  baseUrl: string;
  labelOverrides: Record<string, string>;
}

export async function loadTenants(path: string): Promise<Record<string, TenantProfile>> {
  const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  const out: Record<string, TenantProfile> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith("$")) continue;
    out[k] = v as TenantProfile;
  }
  return out;
}

const map = (p: TenantProfile, s: string): string => p.labelOverrides[s] ?? s;

function overrideLocator(p: TenantProfile, loc: Locator): Locator {
  switch (loc.by) {
    case "label":
      return { ...loc, label: map(p, loc.label) };
    case "rowAnchor":
      return { ...loc, cell: map(p, loc.cell) };
    case "text":
      return { ...loc, text: map(p, loc.text) };
    default:
      return loc;
  }
}

export function overrideBundle(p: TenantProfile, bundle: LocatorBundle): LocatorBundle {
  return { ...bundle, strategies: bundle.strategies.map((s) => overrideLocator(p, s)) };
}

export function overrideCheckpoint(p: TenantProfile, cp: Checkpoint): Checkpoint {
  switch (cp.kind) {
    case "textPresent":
      return { ...cp, text: map(p, cp.text) };
    case "textAbsent":
      return { ...cp, text: map(p, cp.text) };
    case "elementVisible":
      return { ...cp, locator: overrideBundle(p, cp.locator) };
    case "valueEquals":
      return { ...cp, locator: overrideBundle(p, cp.locator) };
    default:
      return cp;
  }
}
