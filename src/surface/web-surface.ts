/**
 * WebSurface — the Playwright implementation of the Surface seam (blueprint §5). Everything that
 * knows about a real browser lives here; the agent and replay engine speak only the Surface interface.
 */
import type { Browser, BrowserContext, Frame, Locator as PwLocator, Page } from "playwright";
import type { Checkpoint, LocatorBundle } from "../artifact/schema.js";
import { launchBrowser } from "./browser.js";
import { EXTRACT_SOURCE, type RawElement } from "./extract.js";
import { buildLocator, describeLocator, satisfies } from "./locators.js";
import type { ObservedElement, Observation, Resolved, Surface } from "./types.js";

export class WebSurface implements Surface {
  private constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
  ) {}

  static async launch(opts: { headless?: boolean } = {}): Promise<WebSurface> {
    const browser = await launchBrowser({ headless: opts.headless ?? true });
    const context = await browser.newContext();
    const page = await context.newPage();
    return new WebSurface(browser, context, page);
  }

  /** The live Page — used only by the escalation layer to hand the same session to a human (§10). */
  get livePage(): Page {
    return this.page;
  }

  /** Wait for a named frame to attach and load before resolving inside it (frameset timing). */
  private async frameForAsync(framePath: string[]): Promise<Frame> {
    if (framePath.length === 0) return this.page.mainFrame();
    const name = framePath[framePath.length - 1]!;
    for (let i = 0; i < 30; i++) {
      const f = this.page.frame({ name });
      if (f) {
        await f.waitForLoadState("domcontentloaded").catch(() => {});
        return f;
      }
      await this.page.waitForTimeout(100);
    }
    return this.page.mainFrame();
  }

  async perceive(): Promise<Observation> {
    await this.settle();
    const elements: ObservedElement[] = [];
    let offset = 0;
    let text = "";
    for (const frame of this.page.frames()) {
      const framePath = frame === this.page.mainFrame() ? [] : [frame.name()];
      const raw = (await frame
        .evaluate(EXTRACT_SOURCE.replace("__OFFSET__", String(offset)))
        .catch(() => [])) as RawElement[];
      offset += raw.length;
      for (const r of raw) elements.push({ ...r, framePath });
      text += " " + (await this.bodyText(frame));
    }
    return {
      url: this.page.url(),
      title: await this.page.title().catch(() => ""),
      frameCount: this.page.frames().length,
      elements,
      text: text.replace(/\s+/g, " ").trim(),
    };
  }

  async navigate(to: string): Promise<void> {
    await this.page.goto(to, { waitUntil: "load" });
  }

  async reload(framePath: string[] = []): Promise<void> {
    const frame = await this.frameForAsync(framePath);
    await frame.goto(frame.url(), { waitUntil: "load" });
    await this.settle();
  }

  async resolve(bundle: LocatorBundle): Promise<Resolved | null> {
    const frame = await this.frameForAsync(bundle.framePath ?? []);
    for (let i = 0; i < bundle.strategies.length; i++) {
      const strat = bundle.strategies[i]!;
      const loc = buildLocator(frame, strat);
      if (await satisfies(loc, bundle.invariants)) {
        return { strategyIndex: i, usedFallback: i > 0, describe: describeLocator(strat), handle: loc.first() };
      }
    }
    return null;
  }

  async resolveRef(ref: string, framePath: string[]): Promise<Resolved | null> {
    const loc = (await this.frameForAsync(framePath)).locator(`[data-cua-ref="${ref}"]`);
    if ((await loc.count()) === 0) return null;
    return { strategyIndex: 0, usedFallback: false, describe: `ref ${ref}`, handle: loc.first() };
  }

  async click(h: Resolved): Promise<void> {
    await (h.handle as PwLocator).click();
    await this.settle();
  }

  async type(h: Resolved, value: string): Promise<void> {
    await (h.handle as PwLocator).fill(value);
  }

  async selectOption(h: Resolved, value: string): Promise<void> {
    const loc = h.handle as PwLocator;
    await loc.selectOption({ label: value }).catch(() => loc.selectOption(value));
  }

  async readText(h: Resolved): Promise<string> {
    return (await (h.handle as PwLocator).innerText()).replace(/\s+/g, " ").trim();
  }

  async checkpointHolds(cp: Checkpoint): Promise<boolean> {
    switch (cp.kind) {
      case "urlMatches":
        return this.page.frames().some((f) => new RegExp(cp.pattern).test(f.url()));
      case "elementVisible":
        return (await this.resolve(cp.locator)) !== null;
      case "textPresent": {
        return (await this.allText(cp.scope)).includes(cp.text);
      }
      case "textAbsent":
        return !(await this.allText()).includes(cp.text);
      case "valueEquals": {
        const r = await this.resolve(cp.locator);
        if (!r) return false;
        const el = r.handle as PwLocator;
        const val = (await el.inputValue().catch(() => null)) ?? (await el.innerText().catch(() => ""));
        return val.trim() === cp.value;
      }
    }
  }

  private async allText(frameName?: string): Promise<string> {
    const frames = frameName ? this.page.frames().filter((f) => f.name() === frameName) : this.page.frames();
    const parts = await Promise.all(frames.map((f) => this.bodyText(f)));
    return parts.join(" ");
  }

  /** Read a frame's body text without waiting: a frameset frame has no <body>, and locator('body')
   *  would block until timeout waiting for one. Returns "" for such frames immediately. */
  private bodyText(frame: Frame): Promise<string> {
    return frame.evaluate("document.body ? document.body.innerText : ''").then((t) => String(t)).catch(() => "");
  }

  async settle(): Promise<void> {
    // networkidle waits for in-flight FRAME navigations (a click can navigate a child frame, not the
    // top page). It is bounded so it can never hang the run if idle is never reached under a runner.
    await this.page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
    for (const f of this.page.frames()) await f.waitForLoadState("domcontentloaded").catch(() => {});
  }

  /** Poll a checkpoint until it holds or the timeout elapses — the correct way to gate on UI state. */
  async waitForCheckpoint(cp: Checkpoint, timeoutMs = 5000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    do {
      if (await this.checkpointHolds(cp)) return true;
      await this.page.waitForTimeout(100);
    } while (Date.now() < deadline);
    return false;
  }

  url(): string {
    return this.page.url();
  }

  screenshot(): Promise<Buffer> {
    return this.page.screenshot({ fullPage: true });
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}
