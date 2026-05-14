import { createClient } from "@supabase/supabase-js";
import { loadLocalEnvIfNeeded } from "../server/lib/load-local-env.js";

loadLocalEnvIfNeeded();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para executar o backfill de acessos.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");

const getArg = (name) => {
  const idx = args.indexOf(name);
  if (idx < 0) return null;
  return args[idx + 1] || null;
};

const fromArg = getArg("--from");
const toArg = getArg("--to");

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
if (fromArg && !dateRegex.test(fromArg)) {
  console.error("Formato inválido em --from. Use YYYY-MM-DD.");
  process.exit(1);
}
if (toArg && !dateRegex.test(toArg)) {
  console.error("Formato inválido em --to. Use YYYY-MM-DD.");
  process.exit(1);
}
if (fromArg && toArg && fromArg > toArg) {
  console.error("Intervalo inválido: --from maior que --to.");
  process.exit(1);
}

const RODRIGO_EMAIL = "rodrigonasc@cpfl.com.br";
const ALLOWED_KINDS = new Set(["login", "session", "pageview"]);

const normalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const listAccessAuditRows = async () => {
  const all = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("audit_log")
      .select("actor_id, action, created_at")
      .like("action", "access.%")
      .order("created_at", { ascending: true })
      .range(from, to);

    if (error) throw error;
    if (!Array.isArray(data) || data.length === 0) break;

    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
};

const buildAdminSet = async (userIds) => {
  const adminSet = new Set();
  for (const ids of chunk(userIds, 500)) {
    const { data, error } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", ids)
      .eq("role", "admin");
    if (error) throw error;
    for (const row of data || []) {
      if (row?.user_id) adminSet.add(String(row.user_id));
    }
  }
  return adminSet;
};

const buildProfileMap = async (userIds) => {
  const map = new Map();
  for (const ids of chunk(userIds, 500)) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, name, email")
      .in("id", ids);
    if (error) throw error;
    for (const row of data || []) {
      map.set(String(row.id), row);
    }
  }
  return map;
};

const buildExistingAwardSet = async () => {
  const set = new Set();
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("xp_awards")
      .select("user_id, kind, metadata")
      .like("kind", "access_%")
      .range(from, to);

    if (error) {
      // xp_awards pode não existir em ambientes antigos.
      return set;
    }
    if (!Array.isArray(data) || data.length === 0) break;

    for (const row of data) {
      const userId = String(row?.user_id || "");
      const kind = String(row?.kind || "");
      const accessKey = String(row?.metadata?.access_key || "");
      if (!userId || !kind || !accessKey) continue;
      set.add(`${userId}|${kind}|${accessKey}`);
    }

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return set;
};

const rows = await listAccessAuditRows();

const normalizedRows = rows
  .map((r) => {
    const actorId = String(r?.actor_id || "");
    const action = String(r?.action || "");
    const createdAt = String(r?.created_at || "");
    const day = createdAt.slice(0, 10);
    const kind = action.startsWith("access.") ? action.slice("access.".length) : "";
    return { actorId, action, createdAt, day, kind };
  })
  .filter((r) => r.actorId && r.day && ALLOWED_KINDS.has(r.kind))
  .filter((r) => (fromArg ? r.day >= fromArg : true))
  .filter((r) => (toArg ? r.day <= toArg : true));

const userIds = Array.from(new Set(normalizedRows.map((r) => r.actorId)));
const [adminSet, profileMap, existingAwardSet] = await Promise.all([
  buildAdminSet(userIds),
  buildProfileMap(userIds),
  buildExistingAwardSet(),
]);

const isRodrigoAdmin = (userId) => {
  if (!adminSet.has(userId)) return false;
  const p = profileMap.get(userId) || {};
  const name = normalize(p?.name);
  const email = normalize(p?.email);
  return name === "rodrigo nascimento" || email === RODRIGO_EMAIL;
};

const collapsed = new Map();
let skippedRodrigo = 0;

for (const row of normalizedRows) {
  if (isRodrigoAdmin(row.actorId)) {
    skippedRodrigo += 1;
    continue;
  }
  const accessKey = `${row.kind}:${row.day}`;
  const kindDb = `access_${row.kind}`;
  const sig = `${row.actorId}|${kindDb}|${accessKey}`;
  if (!collapsed.has(sig)) {
    collapsed.set(sig, {
      user_id: row.actorId,
      kind: kindDb,
      amount: 1,
      metadata: {
        awarded_xp: 0.5,
        access_key: accessKey,
        source: "backfill-access-xp",
        kind: row.kind,
        day: row.day,
        backfill_tag: "retroactive_access_xp_2026-02-07",
      },
    });
  }
}

const allCandidates = Array.from(collapsed.values());
const toInsert = allCandidates.filter((r) => {
  const sig = `${r.user_id}|${r.kind}|${r.metadata.access_key}`;
  return !existingAwardSet.has(sig);
});

const summary = {
  apply: APPLY,
  filter_from: fromArg || null,
  filter_to: toArg || null,
  access_events_seen: rows.length,
  access_events_in_window: normalizedRows.length,
  access_events_skipped_rodrigo: skippedRodrigo,
  unique_daily_kind_candidates: allCandidates.length,
  already_existing_awards: allCandidates.length - toInsert.length,
  awards_to_insert: toInsert.length,
  xp_to_add_total: Number((toInsert.length * 0.5).toFixed(1)),
  users_impacted: new Set(toInsert.map((r) => r.user_id)).size,
};

console.log("Resumo do backfill de acesso:");
console.log(JSON.stringify(summary, null, 2));

if (!APPLY) {
  console.log("Dry-run concluído. Use --apply para gravar.");
  process.exit(0);
}

let inserted = 0;
let failed = 0;

for (const row of toInsert) {
  const { error } = await supabase.from("xp_awards").insert(row);
  if (error) {
    const msg = String(error?.message || "").toLowerCase();
    const isDup = msg.includes("duplicate key") || msg.includes("unique");
    if (!isDup) {
      failed += 1;
      console.error(`Falha ao inserir award (${row.user_id}, ${row.kind}, ${row.metadata.access_key}):`, error.message || error);
    }
  } else {
    inserted += 1;
  }
}

console.log("Resultado da aplicação:");
console.log(
  JSON.stringify(
    {
      inserted_awards: inserted,
      failed_awards: failed,
      inserted_xp_total: Number((inserted * 0.5).toFixed(1)),
      executed_at: new Date().toISOString(),
    },
    null,
    2,
  ),
);
