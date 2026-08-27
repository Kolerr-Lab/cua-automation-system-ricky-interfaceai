# Computer-Use Automation System

The integration layer that gives an AI agent **hands** on a legacy back-office application that has
no API. An LLM **discovers** how to complete a natural-language goal by driving a real UI once; the
successful run is recorded as a **typed, versioned, reusable capability artifact** decoupled from the
model transcript; and that artifact is **replayed deterministically with no model in the loop** — the
path a production agent triggers. It detects and classifies runtime errors, escalates to a human on
the same live session when stuck, and stays within safety guardrails.

> **The model discovers. The artifact becomes a capability. Deterministic replay is how the agent invokes it.**

The design write-up is in [`REPORT.md`](./REPORT.md). The source of truth for the architecture is
[`docs/governance/blueprint-protocol.md`](./docs/governance/blueprint-protocol.md).

## What's here

- A **discovery agent** (`src/agent`, `src/llm`) — observe → decide → act, driven by a real LLM (OpenAI),
  with an offline `MockLlmProvider` for deterministic dev/tests.
- A **typed capability artifact** (`src/artifact`) — Zod schema (source of truth) + exported JSON Schema.
- A **deterministic replay engine** (`src/replay`) — ranked locator resolution, a full error taxonomy,
  bounded recovery, and a `success | business_outcome | hard_failure | escalation_required` result contract.
- **Human-in-the-loop escalation** (`src/escalation`) — a real control-lease + handoff that lets a human
  operate the same live session and hands control back.
- **Safety** (`src/safety`) — allowlist enforcement, risk policy, redaction.
- **Heterogeneity/multi-tenant** (`src/surface`, `src/tenant`) — a `Surface` seam and tenant profiles so
  one artifact replays across rebranded tenants.
- A **capability catalog** (`src/catalog`) — artifacts exposed as agent-callable, typed capabilities.
- A **hostile mock legacy bank** (`mock-bank`) — frameset shell, nested-table layout, **no test IDs**,
  with injectable runtime errors (member-not-found, permission-denied, interstitial, transient failure,
  session expiry) and two rebranded tenants.

## Setup

Requires **Node 20+**.

```bash
npm install
npx playwright install chromium   # first time only; downloads the browser Playwright drives
```

> In some sandboxes Chromium is preinstalled; set `CUA_CHROMIUM_PATH=/path/to/chrome` to point at it
> and skip the download.

**Run without any live services** — everything below targets the local mock bank, no keys needed:

```bash
npm test          # 30 tests: schema, surface, discovery, full replay taxonomy, escalation, catalog
npm run evidence  # regenerates /evidence end-to-end (offline): discovery + 5 replay scenarios
```

## Demo path

Discover a capability, then replay it deterministically.

```bash
# 1. Start the mock legacy bank (tenants at /t/acme and /t/globus)
npm run mock-bank
```

In a second terminal:

```bash
# 2. Discover: an LLM drives the UI to complete the goal and emits a capability artifact
#    --provider mock is offline/deterministic; --provider openai is the real run (see below)
npm run discover -- --spec specs/read-savings.json --tenant acme --provider mock
#    -> writes evidence/discovery-.../artifact.json and catalog/member.read-savings-balance.json

# 3. Replay deterministically (no model), against the same tenant
npm run replay -- --artifact catalog/member.read-savings-balance.json --tenant acme \
  --input userId=teller01 --input password=demo-pass --input memberId=12345
#    -> replay → success  outputs: {"savingsBalance":"$4,210.55"}

# 3b. Replay a business outcome (unknown member) — a result, not a crash
npm run replay -- --artifact catalog/member.read-savings-balance.json --tenant acme \
  --input userId=teller01 --input password=demo-pass --input memberId=00000
#    -> replay → business_outcome (member_not_found)

# 3c. Reuse the SAME artifact on the rebranded tenant, via the catalog
npm run catalog -- invoke member.read-savings-balance --tenant globus \
  --input userId=teller01 --input password=demo-pass --input memberId=12345
#    -> success (label drift "Savings Balance" -> "Savings Bal." absorbed by the tenant profile)
```

Watch it in a real browser window with `--headed` on any `discover`/`replay` command.

### The one real LLM run

The discovery run must be genuinely model-driven at least once. Provide your own key and use the
OpenAI provider (this repo's CI sandbox blocks egress to `api.openai.com`, so run it where egress is allowed):

```bash
export OPENAI_API_KEY=sk-...        # never committed; read from the environment only
export OPENAI_MODEL=gpt-4o          # optional
npm run mock-bank                   # in one terminal
npm run discover -- --spec specs/read-savings.json --tenant acme --provider openai
```

The evidence for the offline reproduction lives in [`/evidence`](./evidence); the real run lands as a
new `evidence/discovery-...` directory (its `trace.jsonl` shows the model's actual decisions).

## Commands

| Command | What it does |
|---|---|
| `npm test` | Full deterministic test suite (offline). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run evidence` | Regenerate `/evidence` end-to-end (offline). |
| `npm run schema:export` | Write `schema/capability.schema.json` from the Zod schema. |
| `npm run mock-bank -- [--port 4010]` | Serve the mock legacy bank. |
| `npm run discover -- --spec <f> --tenant <id> --provider <mock\|openai> [--headed]` | Discovery run → artifact. |
| `npm run replay -- --artifact <f> --tenant <id> --input k=v ... [--headed]` | Deterministic replay. |
| `npm run catalog -- list` / `catalog -- invoke <id> --tenant <id> --input k=v` | Agent-facing catalog. |
| `npm run operator -- [--port 4020]` | Minimal operator panel (renders pending interventions). |

## Layout

```
docs/governance/   blueprint (source of truth) + prompt/tracelog/context-window/tracking protocols
src/               surface · llm · agent · artifact · replay · safety · escalation · catalog · tenant · cli
mock-bank/         standalone hostile legacy bank (frameset, no test IDs, chaos injection, tenants A/B)
tests/             deterministic tests (MockLlmProvider, offline)
evidence/          committed discovery + replay runs (see the taxonomy in action)
schema/            exported JSON Schema for the capability artifact
specs/             capability specs consumed by `discover`
config/            allowlist + tenant profiles
```

## Notes

AI-assisted development throughout; every decision is documented in `REPORT.md` and the blueprint, and
is defensible line by line. The build was driven under an explicit governance layer
(`docs/governance/`) with the blueprint locked before any code was written.
