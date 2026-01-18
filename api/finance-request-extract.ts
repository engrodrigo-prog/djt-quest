// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

import { assertDjtQuestServerEnv } from "../server/env-guard.js";
import { canManageFinanceRequests, isGuestProfile } from "../server/finance/permissions.js";
import {
  buildFinanceAiJsonPath,
  extractJsonForFinanceAttachment,
  parseStorageRefFromUrl,
} from "../server/finance/attachment-extract.js";

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
    if (!SERVICE_ROLE_KEY) {
      return res.status(503).json({ error: "Processamento de anexos indisponível (missing SUPABASE_SERVICE_ROLE_KEY)." });
    }

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

    const id = String(req.body?.id || "").trim();
    if (!id) return res.status(400).json({ error: "id obrigatório" });

    const [{ data: rolesRows }, { data: profile }, { data: reqRow }] = await Promise.all([
      admin.from("user_roles").select("role").eq("user_id", uid),
      admin
        .from("profiles")
        .select("id,name,email,matricula,team_id,sigla_area,operational_base,is_leader")
        .eq("id", uid)
        .maybeSingle(),
      admin.from("finance_requests").select("id,created_by,status").eq("id", id).maybeSingle(),
    ]);

    const roles = Array.isArray(rolesRows) ? rolesRows.map((r: any) => String(r?.role || "")).filter(Boolean) : [];
    if (isGuestProfile(profile, roles)) return res.status(403).json({ error: "Forbidden" });
    if (!reqRow) return res.status(404).json({ error: "Solicitação não encontrada" });

    const canManage = canManageFinanceRequests(roles, profile);
    const isOwner = String(reqRow.created_by) === uid;
    if (!isOwner && !canManage) return res.status(403).json({ error: "Forbidden" });

    const { data: attachments } = await admin
      .from("finance_request_attachments")
      .select("id,item_id,url,storage_bucket,storage_path,filename,content_type,metadata")
      .eq("request_id", id)
      .order("created_at", { ascending: true });
    const list = Array.isArray(attachments) ? attachments : [];
    if (!list.length) return res.status(200).json({ success: true, processed: 0 });

    let processed = 0;
    let processedJson = 0;
    let skipped = 0;
    let failed = 0;

    for (const att of list.slice(0, 6)) {
      const attId = String(att?.id || "").trim();
      if (!attId) continue;
      const meta = att?.metadata && typeof att.metadata === "object" ? att.metadata : {};
      const aiMeta = meta?.ai_extract_json && typeof meta.ai_extract_json === "object" ? meta.ai_extract_json : null;
      const aiStatus = String(aiMeta?.status || "").trim().toLowerCase();
      const hasJson = Boolean(aiMeta?.storage_path) && aiStatus !== "error" && aiStatus !== "processing";

      // Avoid duplicate work if another process is already running.
      if (aiStatus === "processing") {
        skipped += 1;
        continue;
      }
      if (hasJson) {
        skipped += 1;
        continue;
      }

      const bucket =
        String(att?.storage_bucket || "").trim() ||
        parseStorageRefFromUrl(SUPABASE_URL, String(att?.url || ""))?.bucket ||
        "";
      const path =
        String(att?.storage_path || "").trim() ||
        parseStorageRefFromUrl(SUPABASE_URL, String(att?.url || ""))?.path ||
        "";
      if (!bucket || !path) {
        skipped += 1;
        continue;
      }

      const jsonPath = buildFinanceAiJsonPath(path);
      if (!jsonPath) {
        failed += 1;
        continue;
      }

      // Fast-path: if the JSON already exists in storage, just attach the URL in metadata.
      // This avoids re-running OCR/IA when the JSON was generated earlier (e.g. during upload).
      try {
        const { data: existingJson } = await admin.storage.from(bucket).download(jsonPath);
        if (existingJson) {
          const nextMeta = { ...(meta && typeof meta === "object" ? meta : {}) };
          const { data: pub } = admin.storage.from(bucket).getPublicUrl(jsonPath);
          nextMeta.ai_extract_json = {
            bucket,
            storage_path: jsonPath,
            url: pub?.publicUrl || null,
            created_at: String(aiMeta?.created_at || "") || new Date().toISOString(),
            model: aiMeta?.model || null,
            status: "done",
          };
          const { error: updErr } = await admin
            .from("finance_request_attachments")
            .update({ metadata: nextMeta })
            .eq("id", attId);
          if (updErr) throw updErr;
          processed += 1;
          processedJson += 1;
          continue;
        }
      } catch {
        // ignore; proceed to IA extraction
      }

      // Mark as processing early so the UI can show progress and we avoid double-processing.
      try {
        const nextMeta = { ...(meta && typeof meta === "object" ? meta : {}) };
        const attempts = Math.max(0, Number(aiMeta?.attempts || 0)) + 1;
        nextMeta.ai_extract_json = {
          ...(aiMeta && typeof aiMeta === "object" ? aiMeta : {}),
          status: "processing",
          started_at: new Date().toISOString(),
          attempts,
          error: null,
        };
        await admin.from("finance_request_attachments").update({ metadata: nextMeta }).eq("id", attId);
      } catch {
        // best-effort
      }

      const { data: blob, error: dlErr } = await admin.storage.from(bucket).download(path);
      if (dlErr || !blob) {
        failed += 1;
        try {
          const nextMeta = { ...(meta && typeof meta === "object" ? meta : {}) };
          nextMeta.ai_extract_json = {
            ...(aiMeta && typeof aiMeta === "object" ? aiMeta : {}),
            status: "error",
            error: dlErr?.message || "Falha ao baixar anexo",
            failed_at: new Date().toISOString(),
          };
          await admin.from("finance_request_attachments").update({ metadata: nextMeta }).eq("id", attId);
        } catch {
          // ignore
        }
        continue;
      }
      const buf = await toBuffer(blob);
      if (!buf) {
        failed += 1;
        try {
          const nextMeta = { ...(meta && typeof meta === "object" ? meta : {}) };
          nextMeta.ai_extract_json = {
            ...(aiMeta && typeof aiMeta === "object" ? aiMeta : {}),
            status: "error",
            error: "Falha ao ler anexo",
            failed_at: new Date().toISOString(),
          };
          await admin.from("finance_request_attachments").update({ metadata: nextMeta }).eq("id", attId);
        } catch {
          // ignore
        }
        continue;
      }

      const doc = await extractJsonForFinanceAttachment({
        buffer: buf,
        contentType: att?.content_type || "",
        filename: att?.filename || path.split("/").pop() || "",
      }).catch(() => null);

      if (!doc) {
        failed += 1;
        try {
          const nextMeta = { ...(meta && typeof meta === "object" ? meta : {}) };
          nextMeta.ai_extract_json = {
            ...(aiMeta && typeof aiMeta === "object" ? aiMeta : {}),
            status: "error",
            error: "Não foi possível extrair dados do anexo (IA).",
            failed_at: new Date().toISOString(),
          };
          await admin.from("finance_request_attachments").update({ metadata: nextMeta }).eq("id", attId);
        } catch {
          // ignore
        }
        continue;
      }

      const payload = {
        version: 1,
        request_id: id,
        attachment_id: attId,
        item_id: att?.item_id || null,
        item_idx: Number.isFinite(Number(meta?.finance_item_idx)) ? Number(meta.finance_item_idx) : null,
        source: {
          bucket,
          storage_path: path,
          url: String(att?.url || "") || null,
          filename: String(att?.filename || "") || null,
          content_type: String(att?.content_type || "") || null,
        },
        extracted_at: new Date().toISOString(),
        ...doc,
      };
      const jsonText = JSON.stringify(payload, null, 2);

      const upload = await admin.storage
        .from(bucket)
        .upload(jsonPath, Buffer.from(jsonText, "utf-8"), { contentType: "application/json; charset=utf-8", upsert: true });
      if (upload.error) {
        failed += 1;
        try {
          const nextMeta = { ...(meta && typeof meta === "object" ? meta : {}) };
          nextMeta.ai_extract_json = {
            ...(aiMeta && typeof aiMeta === "object" ? aiMeta : {}),
            status: "error",
            error: upload.error.message || "Falha ao salvar JSON",
            failed_at: new Date().toISOString(),
          };
          await admin.from("finance_request_attachments").update({ metadata: nextMeta }).eq("id", attId);
        } catch {
          // ignore
        }
        continue;
      }

      const nextMeta = { ...(meta && typeof meta === "object" ? meta : {}) };
      const { data: pub } = admin.storage.from(bucket).getPublicUrl(jsonPath);
      nextMeta.ai_extract_json = {
        bucket,
        storage_path: jsonPath,
        url: pub?.publicUrl || null,
        created_at: new Date().toISOString(),
        model: doc?.model || null,
        status: "done",
      };

      const { error: updErr } = await admin
        .from("finance_request_attachments")
        .update({ metadata: nextMeta })
        .eq("id", attId);
      if (updErr) {
        failed += 1;
        continue;
      }

      processed += 1;
      processedJson += 1;
    }

    return res.status(200).json({ success: true, processed, processedJson, skipped, failed });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "2mb" } }, maxDuration: 60 };
