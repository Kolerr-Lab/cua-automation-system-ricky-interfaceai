/**
 * Evidence sink (tracelog-protocol). One append-only JSONL trace per run + screenshots + artifacts.
 * Redaction is applied HERE so callers cannot accidentally persist secrets (blueprint §12, §T4).
 * Writes are synchronous so evidence survives a thrown error mid-run (§T5).
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Redactor } from "../safety/redaction.js";

export type TracePhase =
  | "perceive"
  | "decide"
  | "act"
  | "checkpoint"
  | "recover"
  | "escalate"
  | "outcome"
  | "system";

export type TraceKind = "discovery" | "replay";

export interface TraceEvent {
  ts: string;
  runId: string;
  kind: TraceKind;
  phase: TracePhase;
  stepId?: string;
  seq: number;
  event: string;
  level: "debug" | "info" | "warn" | "error";
  data?: Record<string, unknown>;
}

export interface EmitOpts {
  stepId?: string;
  level?: TraceEvent["level"];
  data?: Record<string, unknown>;
}

export function makeRunId(kind: TraceKind, slug: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "").replace("T", "-").slice(0, 15);
  return `${kind}-${slug.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${stamp}`;
}

export class TraceWriter {
  readonly dir: string;
  readonly screenshotDir: string;
  private seq = 0;

  constructor(
    readonly runId: string,
    readonly kind: TraceKind,
    baseDir = "evidence",
    private readonly redactor = new Redactor(),
  ) {
    this.dir = join(baseDir, runId);
    this.screenshotDir = join(this.dir, "screenshots");
    mkdirSync(this.screenshotDir, { recursive: true });
  }

  emit(phase: TracePhase, event: string, opts: EmitOpts = {}): void {
    const ev: TraceEvent = {
      ts: new Date().toISOString(),
      runId: this.runId,
      kind: this.kind,
      phase,
      seq: this.seq++,
      event,
      level: opts.level ?? "info",
      ...(opts.stepId ? { stepId: opts.stepId } : {}),
      ...(opts.data ? { data: this.redactor.data(opts.data) } : {}),
    };
    appendFileSync(join(this.dir, "trace.jsonl"), JSON.stringify(ev) + "\n", "utf8");
  }

  /** Richer failure signal (§T5). Returns the evidence-relative path recorded in events. */
  screenshot(name: string, png: Buffer): string {
    const file = join(this.screenshotDir, `${name}.png`);
    writeFileSync(file, png);
    return file;
  }

  writeJson(name: string, obj: unknown): string {
    const file = join(this.dir, `${name}.json`);
    writeFileSync(file, JSON.stringify(this.redactor.data(obj), null, 2) + "\n", "utf8");
    return file;
  }
}
