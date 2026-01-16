// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

import { assertDjtQuestServerEnv } from "../server/env-guard.js";
import { canManageFinanceRequests, isGuestProfile } from "../server/finance/permissions.js";
import { extractCsvForFinanceAttachment, parseStorageRefFromUrl, buildFinanceCsvPath } from "../server/finance/attachment-extract.js";

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
      .select("id,url,storage_bucket,storage_path,filename,content_type,metadata")
      .eq("request_id", id)
      .order("created_at", { ascending: true });
    const list = Array.isArray(attachments) ? attachments : [];
    if (!list.length) return res.status(200).json({ success: true, processed: 0 });

    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const att of list.slice(0, 6)) {
      const attId = String(att?.id || "").trim();
      if (!attId) continue;
      const meta = att?.metadata && typeof att.metadata === "object" ? att.metadata : {};
      if (meta?.table_csv?.storage_path) {
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

      const { data: blob, error: dlErr } = await admin.storage.from(bucket).download(path);
      if (dlErr || !blob) {
        failed += 1;
        continue;
      }
      const buf = await toBuffer(blob);
      if (!buf) {
        failed += 1;
        continue;
      }

      const csv = await extractCsvForFinanceAttachment({
        buffer: buf,
        contentType: att?.content_type || "",
        filename: att?.filename || path.split("/").pop() || "",
      }).catch(() => null);
      const csvText = String(csv || "").trim();
      if (!csvText) {
        skipped += 1;
        continue;
      }

      const csvPath = buildFinanceCsvPath(path);
      if (!csvPath) {
        failed += 1;
        continue;
      }

      const upload = await admin.storage
        .from(bucket)
        .upload(csvPath, Buffer.from(csvText, "utf-8"), { contentType: "text/csv; charset=utf-8", upsert: true });
      if (upload.error) {
        failed += 1;
        continue;
      }

      const { data: pub } = admin.storage.from(bucket).getPublicUrl(csvPath);
      const nextMeta = {
        ...(meta && typeof meta === "object" ? meta : {}),
        table_csv: {
          bucket,
          storage_path: csvPath,
          url: pub?.publicUrl || null,
          created_at: new Date().toISOString(),
        },
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
    }

    return res.status(200).json({ success: true, processed, skipped, failed });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "2mb" } }, maxDuration: 60 };

