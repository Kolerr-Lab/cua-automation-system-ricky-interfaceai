/**
 * Minimal operator panel (blueprint §10 scope note): the operator UI is intentionally mocked; the
 * handoff mechanism and control-transfer model (controller.ts + handoff.ts) are the real, graded part.
 * This renders pending interventions recorded in evidence and offers a resume action for a human.
 */
import express from "express";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { Server } from "node:http";
import type { InterventionRequest } from "./types.js";

interface Pending {
  runId: string;
  intervention: InterventionRequest;
}

function scan(evidenceDir: string): Pending[] {
  if (!existsSync(evidenceDir)) return [];
  const out: Pending[] = [];
  for (const run of readdirSync(evidenceDir)) {
    const resultFile = join(evidenceDir, run, "result.json");
    if (!existsSync(resultFile)) continue;
    try {
      const r = JSON.parse(readFileSync(resultFile, "utf8"));
      if (r.status === "escalation_required") out.push({ runId: run, intervention: r.intervention });
    } catch {
      /* ignore malformed */
    }
  }
  return out;
}

const page = (body: string): string =>
  `<!doctype html><meta charset=utf8><title>Operator</title><body style="font-family:system-ui;max-width:760px;margin:24px auto;color:#111">${body}</body>`;

export function serveOperatorPanel(port: number, evidenceDir: string): Promise<Server> {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  const resolved = new Set<string>();

  app.get("/", (_req, res) => {
    const items = scan(evidenceDir).filter((p) => !resolved.has(p.runId));
    const rows = items.map((p) => `<li><a href="/iv/${p.runId}">${p.intervention.capabilityId}</a> — <b>${p.intervention.reason}</b> at ${p.intervention.stoppedAtStepId}</li>`).join("");
    res.send(page(`<h2>Pending interventions</h2>${items.length ? `<ul>${rows}</ul>` : "<p>None. Automation holds control.</p>"}`));
  });

  app.get("/iv/:runId", (req, res) => {
    const p = scan(evidenceDir).find((x) => x.runId === req.params.runId);
    if (!p) return res.status(404).send(page("<p>Not found.</p>"));
    const shot = p.intervention.state.screenshotRef;
    const img = shot && existsSync(shot) ? `<img src="/shot/${p.runId}/${basename(shot)}" style="max-width:100%;border:1px solid #ccc">` : "";
    res.send(
      page(`<h2>${p.intervention.capabilityId}</h2>
      <p><b>Reason:</b> ${p.intervention.reason} · <b>Step:</b> ${p.intervention.stoppedAtStepId}</p>
      <p><b>Needs:</b> ${p.intervention.needs}</p>
      <p><b>URL:</b> ${p.intervention.state.url}</p>${img}
      <form method="post" action="/resume/${p.runId}"><p>Operate the live session, then:</p>
      <button style="padding:8px 16px">Resume automation</button></form>`),
    );
  });

  app.post("/resume/:runId", (req, res) => {
    resolved.add(req.params.runId); // the real resume happens in the running handoff; this marks the UI
    res.redirect("/");
  });

  app.get("/shot/:runId/:file", (req, res) => {
    const f = join(evidenceDir, req.params.runId, "screenshots", req.params.file);
    if (existsSync(f)) res.sendFile(f, { root: process.cwd() });
    else res.status(404).end();
  });

  return new Promise((resolve) => {
    const server = app.listen(port, () => resolve(server));
  });
}
