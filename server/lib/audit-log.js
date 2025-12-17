export async function tryInsertAuditLog(admin, entry) {
  try {
    const payload = {
      actor_id: entry?.actor_id ?? null,
      action: String(entry?.action || '').trim(),
      entity_type: String(entry?.entity_type || '').trim(),
      entity_id: String(entry?.entity_id || '').trim(),
      before_json: entry?.before_json ?? null,
      after_json: entry?.after_json ?? null,
      created_at: entry?.created_at ?? undefined,
    };
    if (!payload.action || !payload.entity_type || !payload.entity_id) return;
    await admin.from('audit_log').insert(payload);
  } catch {
    // Best-effort only (table may not exist in some environments)
  }
}

