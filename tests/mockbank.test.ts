import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Browser, Frame, Page } from "playwright";
import { startMockBank } from "../mock-bank/src/server.js";
import { launchBrowser } from "../src/surface/browser.js";

let server: Server;
let browser: Browser;
let base: string;

beforeAll(async () => {
  server = await startMockBank(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  browser = await launchBrowser();
}, 30_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

/** Sign on and return the content frame of the legacy frameset. */
async function signOn(page: Page, tenant: string): Promise<Frame> {
  await page.goto(`${base}/t/${tenant}/`);
  await page.locator("input[name=userId]").fill("teller01");
  await page.locator("input[name=password]").fill("x");
  await page.locator('input[value="Sign On"]').click();
  const el = await page.waitForSelector("frame[name=content]", { timeout: 5000 });
  return (await el.contentFrame())!;
}

async function arm(patch: Record<string, unknown>): Promise<void> {
  await fetch(`${base}/__chaos`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
}

async function find(content: Frame, id: string): Promise<string> {
  await content.locator("input[name=memberNo]").fill(id);
  await content.locator('input[value="Find"]').click();
  await content.waitForLoadState("networkidle");
  return content.locator("body").innerText();
}

describe("mock legacy bank", () => {
  it("happy path: sign on -> find -> read savings balance (through the content frame)", async () => {
    const page = await browser.newPage();
    const content = await signOn(page, "acme");
    const txt = await find(content, "12345");
    expect(txt).toContain("Savings Balance");
    expect(txt).toContain("$4,210.55");
    await page.close();
  });

  it("business outcomes: member_not_found and permission_denied", async () => {
    const page = await browser.newPage();
    const content = await signOn(page, "acme");
    expect(await find(content, "00000")).toContain("No such member");
    await content.goto(`${base}/t/acme/content`);
    expect(await find(content, "99999")).toContain("not authorized");
    await page.close();
  });

  it("recoverable transient: detail 503 once, then reload succeeds", async () => {
    await arm({ reset: true, transientFails: 1 });
    const page = await browser.newPage();
    const content = await signOn(page, "acme");
    await content.locator("input[name=memberNo]").fill("12345");
    await content.locator('input[value="Find"]').click();
    await content.waitForLoadState("networkidle");
    expect(await content.locator("body").innerText()).toContain("temporarily unavailable");
    await content.goto(content.url()); // reload the same (idempotent) URL
    expect(await content.locator("body").innerText()).toContain("Savings Balance");
    await page.close();
  });

  it("recoverable interstitial: System Notice then Continue reaches detail", async () => {
    await arm({ reset: true, interstitial: true });
    const page = await browser.newPage();
    const content = await signOn(page, "acme");
    const first = await find(content, "12345");
    expect(first).toContain("System Notice");
    await content.locator("a", { hasText: "Continue" }).click();
    await content.waitForLoadState("networkidle");
    expect(await content.locator("body").innerText()).toContain("Savings Balance");
    await page.close();
  });

  it("cross-tenant cosmetic drift: globus renders 'Savings Bal.'", async () => {
    await arm({ reset: true });
    const page = await browser.newPage();
    const content = await signOn(page, "globus");
    const txt = await find(content, "12345");
    expect(txt).toContain("Savings Bal.");
    expect(txt).not.toContain("Savings Balance");
    await page.close();
  });
});
