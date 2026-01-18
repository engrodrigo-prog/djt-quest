// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

import { assertDjtQuestServerEnv } from "../server/env-guard.js";
import { buildFinanceAiJsonPath, extractJsonForFinanceAttachment, parseStorageRefFromUrl } from "../server/finance/attachment-extract.js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
const ANON_KEY = (process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY) as string;

const toBuffer = async (blob: any) => {
  try {
    if (!blob) return null;
    if (Buffer.isBuffer(blob)) return blob;
    if (typeof blob.arrayBuffer === "function") {
      const ab = await blob.arrayBuffer();
      return Buffer.from(ab);
    }
    if (blob instanceof ArrayBuffer) return Buffer.from(blob);
    return null;
  } catch {
    return null;
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    assertDjtQuestServerEnv({ requireSupabaseUrl: false });
    if (!SUPABASE_URL || !ANON_KEY) return res.status(500).json({ error: "Missing Supabase config" });
    if (!SERVICE_ROLE_KEY) return res.status(503).json({ error: "Missing SUPABASE_SERVICE_ROLE_KEY" });

    const authHeader = req.headers["authorization"] as string | undefined;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const token = authHeader.slice(7);

    const authed = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    const { data: userData, error: authErr } = await authed.auth.getUser();
    if (authErr || !userData?.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const uid = String(userData.user.id);

    const body = req.body || {};
    const url = String(body?.url || "").trim();
    let bucket = String(body?.storageBucket || body?.bucket || "").trim();
    let path = String(body?.storagePath || body?.path || "").trim();
    const filename = String(body?.filename || "").trim();
    const contentType = String(body?.contentType || "").trim();

    if ((!bucket || !path) && url) {
      const ref = parseStorageRefFromUrl(SUPABASE_URL, url);
      bucket = bucket || String(ref?.bucket || "").trim();
      path = path || String(ref?.path || "").trim();
    }

    if (!bucket || !path) return res.status(400).json({ error: "storageBucket/storagePath obrigatórios" });

    // Security: only allow finance uploads under the authenticated user's folder.
    const expectedPrefix = `finance-requests/${uid}/`;
    if (bucket !== "evidence" || !path.startsWith(expectedPrefix)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { data: blob, error: dlErr } = await admin.storage.from(bucket).download(path);
    if (dlErr || !blob) return res.status(400).json({ error: dlErr?.message || "Falha ao baixar anexo" });

    const buf = await toBuffer(blob);
    if (!buf) return res.status(500).json({ error: "Falha ao ler arquivo" });

    const jsonPath = buildFinanceAiJsonPath(path);
    if (!jsonPath) return res.status(500).json({ error: "Falha ao definir caminho do JSON" });

    // Extract JSON doc with AI (OCR/PDF) and upload next to the attachment.
    const doc = await extractJsonForFinanceAttachment({
      buffer: buf,
      contentType,
      filename: filename || path.split("/").pop() || "",
    }).catch(() => null);
    if (!doc) return res.status(422).json({ error: "Não foi possível extrair dados do anexo (IA)." });

    const payload = {
      version: 1,
      source: {
        bucket,
        storage_path: path,
        url: url || null,
        filename: filename || null,
        content_type: contentType || null,
      },
      extracted_at: new Date().toISOString(),
      ...doc,
    };
    const jsonText = JSON.stringify(payload, null, 2);

    const upload = await admin.storage
      .from(bucket)
      .upload(jsonPath, Buffer.from(jsonText, "utf-8"), { contentType: "application/json; charset=utf-8", upsert: true });
    if (upload.error) return res.status(400).json({ error: upload.error.message });

    const { data: pub } = admin.storage.from(bucket).getPublicUrl(jsonPath);
    const ai_extract_json = {
      bucket,
      storage_path: jsonPath,
      url: pub?.publicUrl || null,
      created_at: new Date().toISOString(),
      model: doc?.model || null,
      status: "done",
    };

    return res.status(200).json({ success: true, ai_extract_json });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "2mb" } }, maxDuration: 60 };

