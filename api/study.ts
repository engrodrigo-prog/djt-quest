// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";

import { assertDjtQuestServerEnv } from "../server/env-guard.js";
import purgeExpired from "../server/api-handlers/study-purge-expired.js";
import cleanCache from "../server/api-handlers/study-clean-cache.js";

type Handler = (req: VercelRequest, res: VercelResponse) => any | Promise<any>;

const handlers: Record<string, Handler> = {
  "purge-expired": purgeExpired,
  "clean-cache": cleanCache,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).send("");

  try {
    assertDjtQuestServerEnv({ requireSupabaseUrl: false });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Invalid server environment" });
  }

  const key =
    (typeof req.query.handler === "string"
      ? req.query.handler
      : Array.isArray(req.query.handler)
        ? req.query.handler[0]
        : undefined) ||
    (req.body && typeof req.body.handler === "string" ? req.body.handler : undefined);

  if (!key) {
    return res.status(400).json({ error: "handler query param required" });
  }

  const fn = handlers[key];
  if (!fn) {
    return res.status(400).json({ error: `Unknown study handler: ${key}` });
  }

  try {
    return await fn(req, res);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error in /api/study" });
  }
}

export const config = { api: { bodyParser: true } };
