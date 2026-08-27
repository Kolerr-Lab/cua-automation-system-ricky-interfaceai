# Context-Window Protocol

> Governs how we stay correct and cheap across a multi-session, AI-assisted build under a finite
> context window. Discipline, not tooling.

## C1. Single source of truth, one definition each
- The **blueprint** (§ this dir) is authoritative for design; the **Zod schema** (`artifact/schema.ts`)
  is authoritative for types — every other file imports it, nothing redefines a `Capability` shape.
- No copy-paste of a type or contract. Duplication is a bug: it drifts and it burns context.

## C2. Cross-session persistence
- Durable state lives in the **claude.ai Project** (blueprint + tracking), not in chat scrollback.
- A new session **bootstraps** in this order: read `blueprint-protocol.md` → `tracking-protocol.md`
  ledger → the module it will touch. It does not re-derive the plan from scratch.
- When something durable is decided or finished, it is written back to the Project immediately.

## C3. File-size & module discipline (keeps files readable in one window)
- One responsibility per module; target < ~150 lines. If a file outgrows that, split at a seam.
- Small, composable functions over deep classes. Prefer deleting over abstracting.

## C4. Working-memory hygiene
- Don't re-read a file just edited — the edit tool already confirmed the write.
- Reference large evidence/traces by **path**, never paste them into context.
- Summarize long tool output to the decision it produced; keep the decision, drop the dump.

## C5. Chunked delivery
- Build one vertical slice at a time (blueprint §8 flow order), each ending green (`tsc` + tests).
- Land + persist before starting the next slice, so an interrupted session resumes cleanly.
