/**
 * The Surface seam (blueprint §5, §11). The ONLY place that touches a concrete UI technology.
 * `role`+`name` and label/row anchoring are defined against the accessibility tree, which also exists
 * on desktop apps — so a DesktopSurface would implement this same interface with the same artifact.
 */
import type { Checkpoint, LocatorBundle } from "../artifact/schema.js";

export type ElementRole = "textbox" | "button" | "link" | "combobox" | "text";

/** One perceivable element, tagged with a per-observation ref the LLM can point at (prompt-protocol A2). */
export interface ObservedElement {
  ref: string;
  role: ElementRole;
  name: string; // best human-visible/anchored name
  framePath: string[]; // [] = main document, ["content"] = inside that frame
  label?: string; // the label/row anchor a locator will use
  attrs: { name?: string; id?: string; value?: string; href?: string; type?: string };
  editable: boolean;
}

export interface Observation {
  url: string;
  title: string;
  frameCount: number;
  elements: ObservedElement[];
  text: string; // concatenated visible text (used for summaries + text checkpoints)
}

/** Result of resolving a LocatorBundle: which ranked strategy won, and whether it was a fallback (§11 drift). */
export interface Resolved {
  strategyIndex: number;
  usedFallback: boolean;
  describe: string;
  handle: unknown; // opaque Playwright Locator; only the implementing Surface interprets it
}

export interface Surface {
  perceive(): Promise<Observation>;
  navigate(to: string): Promise<void>;
  /** Reload a frame by re-requesting its current URL (used by "retry" recovery on transient errors). */
  reload(framePath?: string[]): Promise<void>;
  resolve(bundle: LocatorBundle): Promise<Resolved | null>;
  resolveRef(ref: string, framePath: string[]): Promise<Resolved | null>;
  click(h: Resolved): Promise<void>;
  type(h: Resolved, value: string): Promise<void>;
  selectOption(h: Resolved, value: string): Promise<void>;
  readText(h: Resolved): Promise<string>;
  /** Evaluate a checkpoint against the current surface state (used by replay + recovery). */
  checkpointHolds(cp: Checkpoint): Promise<boolean>;
  /** Poll a checkpoint until it holds or times out — the correct way to gate on UI state. */
  waitForCheckpoint(cp: Checkpoint, timeoutMs?: number): Promise<boolean>;
  settle(): Promise<void>;
  url(): string;
  screenshot(): Promise<Buffer>;
  close(): Promise<void>;
}
