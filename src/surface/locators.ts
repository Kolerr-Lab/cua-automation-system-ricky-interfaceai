/**
 * Turn one artifact Locator strategy into a Playwright locator, and check post-resolution invariants
 * (blueprint §6.4). Kept separate so the ranked-fallback logic in WebSurface stays readable.
 */
import type { Frame, Locator as PwLocator } from "playwright";
import type { Locator, LocatorBundle } from "../artifact/schema.js";

export function buildLocator(frame: Frame, loc: Locator): PwLocator {
  switch (loc.by) {
    case "role":
      return frame.getByRole(loc.role as Parameters<Frame["getByRole"]>[0], { name: loc.name, exact: loc.exact ?? false });
    case "label":
      // "the field labeled X": the input/select in the cell following the label cell (legacy tables).
      return frame.locator(
        `xpath=//td[normalize-space()="${loc.label}"]/following-sibling::td[1]//*[self::input or self::select or self::textarea]`,
      );
    case "rowAnchor":
      // "the value cell of the row whose label cell reads {cell}".
      return frame.locator(`xpath=//td[normalize-space()="${loc.cell}"]/following-sibling::td[1]`);
    case "attr":
      return frame.locator(`[${loc.name}="${loc.value}"]`);
    case "text":
      return frame.getByText(loc.text, { exact: loc.exact ?? false });
    case "structural":
      return frame.locator(loc.css).nth(loc.index);
  }
}

/** True if the locator resolves to a first element that satisfies the declared invariants. */
export async function satisfies(l: PwLocator, inv: LocatorBundle["invariants"]): Promise<boolean> {
  if ((await l.count()) === 0) return false;
  const first = l.first();
  if (inv.visible !== false && !(await first.isVisible().catch(() => false))) return false;
  if (inv.editable && !(await first.isEditable().catch(() => false))) return false;
  return true;
}

export function describeLocator(loc: Locator): string {
  switch (loc.by) {
    case "role":
      return `role=${loc.role} name="${loc.name}"`;
    case "label":
      return `label="${loc.label}"`;
    case "rowAnchor":
      return `rowAnchor cell="${loc.cell}"→${loc.targetCol}`;
    case "attr":
      return `[${loc.name}="${loc.value}"]`;
    case "text":
      return `text="${loc.text}"`;
    case "structural":
      return `css=${loc.css}#${loc.index}`;
  }
}
