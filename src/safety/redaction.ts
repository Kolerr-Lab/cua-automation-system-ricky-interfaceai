/**
 * Redaction (blueprint §12, tracelog-protocol §T4). Applied in evidence/ before ANYTHING is
 * persisted — artifacts, traces, screenshots' metadata. Secrets never reach disk in the repo.
 */

/** Patterns that look like secrets/PII regardless of param metadata. Conservative, not exhaustive. */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b\d{13,19}\b/g, "«redacted:card»"], // card-like PANs
  [/\b\d{3}-\d{2}-\d{4}\b/g, "«redacted:ssn»"], // US SSN
  [/\b(sk|pk|rk)-[A-Za-z0-9]{16,}\b/g, "«redacted:key»"], // api keys
  [/\bBearer\s+[A-Za-z0-9._\-]+/gi, "«redacted:token»"], // bearer tokens
];

export class Redactor {
  /** value → label, for values known to be sensitive (e.g. a password bound to a sensitive param). */
  private readonly sensitiveValues: Map<string, string>;

  constructor(sensitive: Array<{ value: string; name: string }> = []) {
    this.sensitiveValues = new Map(sensitive.filter((s) => s.value).map((s) => [s.value, `«redacted:${s.name}»`]));
  }

  string(input: string): string {
    let out = input;
    for (const [value, label] of this.sensitiveValues) out = out.split(value).join(label);
    for (const [re, label] of SECRET_PATTERNS) out = out.replace(re, label);
    return out;
  }

  /** Deep-redact any JSON-ish value. Used on every trace event's `data`. */
  data<T>(input: T): T {
    if (typeof input === "string") return this.string(input) as unknown as T;
    if (Array.isArray(input)) return input.map((v) => this.data(v)) as unknown as T;
    if (input && typeof input === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input)) out[k] = this.data(v);
      return out as T;
    }
    return input;
  }
}
