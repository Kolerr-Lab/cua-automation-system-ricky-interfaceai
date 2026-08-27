import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { startMockBank } from "../mock-bank/src/server.js";
import { WebSurface } from "../src/surface/web-surface.js";
import type { LocatorBundle } from "../src/artifact/schema.js";

let server: Server;
let base: string;
let surface: WebSurface;

beforeAll(async () => {
  server = await startMockBank(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  surface = await WebSurface.launch();
}, 30_000);

afterAll(async () => {
  await surface?.close();
  await new Promise<void>((r) => server.close(() => r()));
});

const bundle = (strategies: LocatorBundle["strategies"], framePath: string[], invariants: LocatorBundle["invariants"] = {}): LocatorBundle => ({
  strategies,
  framePath,
  invariants,
});

/** Sign on and drive to a member's detail screen using only label/role locators. */
async function reachDetail(id = "12345"): Promise<void> {
  await surface.navigate(`${base}/t/acme/`);
  await surface.type((await surface.resolve(bundle([{ by: "label", label: "User ID" }], [], { editable: true })))!, "teller01");
  await surface.type((await surface.resolve(bundle([{ by: "label", label: "Password" }], [], { editable: true })))!, "x");
  await surface.click((await surface.resolve(bundle([{ by: "role", role: "button", name: "Sign On" }], [])))!);
  await surface.type((await surface.resolve(bundle([{ by: "label", label: "Member #" }], ["content"], { editable: true })))!, id);
  await surface.click((await surface.resolve(bundle([{ by: "role", role: "button", name: "Find" }], ["content"])))!);
  await surface.waitForCheckpoint({ kind: "textPresent", text: "Savings Balance" });
}

describe("WebSurface", () => {
  it("perceives across frames and identifies the content-frame search box (no ids)", async () => {
    await surface.navigate(`${base}/t/acme/`);
    await surface.type((await surface.resolve(bundle([{ by: "label", label: "User ID" }], [], { editable: true })))!, "teller01");
    await surface.type((await surface.resolve(bundle([{ by: "label", label: "Password" }], [], { editable: true })))!, "x");
    await surface.click((await surface.resolve(bundle([{ by: "role", role: "button", name: "Sign On" }], [])))!);
    const obs = await surface.perceive();
    expect(obs.frameCount).toBeGreaterThan(1);
    const memberBox = obs.elements.find((e) => e.role === "textbox" && e.label === "Member #");
    expect(memberBox?.framePath).toEqual(["content"]);
  });

  it("reaches detail via label/role locators and reads a labeled value by row anchor", async () => {
    await reachDetail("12345");
    expect(await surface.waitForCheckpoint({ kind: "textPresent", text: "Savings Balance" })).toBe(true);
    const savings = await surface.resolve(
      bundle([{ by: "rowAnchor", header: "label", cell: "Savings Balance", targetCol: "value" }], ["content"]),
    );
    expect(await surface.readText(savings!)).toBe("$4,210.55");
  });

  it("falls back to the next strategy and flags it (drift signal)", async () => {
    await reachDetail("12345");
    const resolved = await surface.resolve(
      bundle(
        [
          { by: "attr", name: "id", value: "does-not-exist" }, // brittle first strategy fails
          { by: "rowAnchor", header: "label", cell: "Savings Balance", targetCol: "value" }, // robust fallback wins
        ],
        ["content"],
      ),
    );
    expect(resolved).not.toBeNull();
    expect(resolved!.usedFallback).toBe(true);
    expect(resolved!.strategyIndex).toBe(1);
  });

  it("returns null when nothing resolves (caller turns this into a hard failure)", async () => {
    await reachDetail("12345");
    const none = await surface.resolve(bundle([{ by: "label", label: "Nonexistent Field" }], ["content"], { editable: true }));
    expect(none).toBeNull();
  });
});
