/**
 * Mock legacy bank server (blueprint §4 D6). Two tenants under /t/:tenant sharing one appFamily.
 * Exceptional states are injected via the Chaos controller (POST /__chaos) and via member id, so any
 * caller can drive a specific runtime condition deterministically.
 */
import express, { type Request, type Response } from "express";
import type { Server } from "node:http";
import { MEMBERS, tenant as brandOf } from "./data.js";
import { Chaos } from "./chaos.js";
import * as V from "./render.js";

const chaos = new Chaos();
const sessions = new Set<string>();

function parseCookies(req: Request): Record<string, string> {
  return (req.headers.cookie ?? "").split(";").reduce<Record<string, string>>((acc, part) => {
    const [k, ...v] = part.trim().split("=");
    if (k) acc[k] = decodeURIComponent(v.join("="));
    return acc;
  }, {});
}

/** True if the request carries a live session and no session-expiry chaos is armed. */
function hasSession(req: Request): boolean {
  const sid = parseCookies(req)["sid"];
  return !chaos.expired && !!sid && sessions.has(sid);
}

export function createMockBank(): express.Express {
  const app = express();
  app.set("strict routing", true); // so relative form actions resolve against a trailing-slash base
  app.use(express.urlencoded({ extended: false }));

  app.get("/__health", (_req, res) => res.json({ ok: true }));
  app.post("/__chaos", express.json(), (req, res) => res.json(chaos.arm(req.body ?? {})));

  const t = (req: Request) => brandOf(req.params.tenant ?? "acme");
  const expired = (req: Request, res: Response) => res.status(200).send(V.expiredScreen(req.params.tenant!, t(req)));

  // Sign on. The bare tenant root redirects to a trailing slash so relative actions resolve correctly.
  app.get("/t/:tenant", (req, res) => res.redirect(302, `/t/${req.params.tenant}/`));
  app.get("/t/:tenant/", (req, res) => res.send(V.loginPage(req.params.tenant!, t(req))));
  app.post("/t/:tenant/signon", (req, res) => {
    const sid = `sid-${Math.random().toString(36).slice(2, 10)}`;
    sessions.add(sid);
    chaos.clearExpiry();
    res.setHeader("Set-Cookie", `sid=${sid}; Path=/`);
    res.redirect(`/t/${req.params.tenant}/desktop`);
  });

  // Frameset shell + frames
  app.get("/t/:tenant/desktop", (req, res) => res.send(V.desktopFrameset(req.params.tenant!)));
  app.get("/t/:tenant/menu", (req, res) => res.send(V.menuFrame(req.params.tenant!, t(req))));
  app.get("/t/:tenant/content", (req, res) =>
    hasSession(req) ? res.send(V.searchScreen(req.params.tenant!, t(req))) : expired(req, res),
  );

  // Find validates the member, then redirects to the (idempotent) detail GET, where transient
  // failures and interstitials are injected — so "retry" means "reload the same URL" cleanly (§9).
  app.post("/t/:tenant/find", (req, res) => {
    if (!hasSession(req)) return expired(req, res);
    const id = String(req.body.memberNo ?? "").trim();
    const m = MEMBERS[id];
    if (!m) return res.status(200).send(V.notFoundScreen(req.params.tenant!, t(req))); // business: member_not_found
    if (m.restricted) return res.status(200).send(V.permissionScreen(req.params.tenant!, t(req))); // business: permission_denied
    return res.redirect(302, `detail?id=${id}`);
  });

  app.get("/t/:tenant/detail", (req, res) => {
    if (!hasSession(req)) return expired(req, res);
    if (chaos.takeTransientFail()) return res.status(503).send(V.transientBody(t(req))); // recoverable: retry
    const m = MEMBERS[String(req.query.id ?? "")];
    if (!m) return res.status(200).send(V.notFoundScreen(req.params.tenant!, t(req)));
    if (m.restricted) return res.status(200).send(V.permissionScreen(req.params.tenant!, t(req)));
    if (chaos.takeInterstitial()) return res.send(V.interstitialScreen(req.params.tenant!, t(req), m.id)); // recoverable: dismiss
    return res.send(V.detailScreen(req.params.tenant!, t(req), m));
  });

  // New sub-account (the multi-field, irreversible-ish action flow)
  app.get("/t/:tenant/subaccount", (req, res) => {
    if (!hasSession(req)) return expired(req, res);
    const m = MEMBERS[String(req.query.id ?? "")];
    if (!m) return res.status(200).send(V.notFoundScreen(req.params.tenant!, t(req)));
    return res.send(V.subAccountForm(req.params.tenant!, t(req), m));
  });
  app.post("/t/:tenant/subaccount-create", (req, res) => {
    if (!hasSession(req)) return expired(req, res);
    const m = MEMBERS[String(req.body.id ?? "")];
    if (!m) return res.status(200).send(V.notFoundScreen(req.params.tenant!, t(req)));
    return res.send(V.confirmationScreen(req.params.tenant!, t(req), m, `SA-${m.id}-01`));
  });

  return app;
}

export function startMockBank(port = 4010): Promise<Server> {
  return new Promise((resolve) => {
    const server = createMockBank().listen(port, "127.0.0.1", () => resolve(server));
  });
}
