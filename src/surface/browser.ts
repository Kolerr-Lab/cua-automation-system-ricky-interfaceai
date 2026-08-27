/**
 * Central browser launch. Uses CUA_CHROMIUM_PATH if set, else the sandbox's pre-installed Chromium,
 * else Playwright's own resolution. Keeping this in one place means every surface uses the same binary.
 */
import { chromium, type Browser, type LaunchOptions } from "playwright";
import { existsSync } from "node:fs";

const CANDIDATES = [process.env.CUA_CHROMIUM_PATH, "/opt/pw-browsers/chromium"].filter(Boolean) as string[];

export function chromiumExecutablePath(): string | undefined {
  return CANDIDATES.find((p) => existsSync(p));
}

export function launchBrowser(opts: LaunchOptions = {}): Promise<Browser> {
  const executablePath = chromiumExecutablePath();
  return chromium.launch({ ...(executablePath ? { executablePath } : {}), ...opts });
}
