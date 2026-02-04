#!/usr/bin/env node
/**
 * Normalize org hierarchy and clean legacy artifacts.
 *
 * Default: DRY-RUN (no writes). Use `--apply` to perform changes.
 *
 * What it does:
 * - Removes DJTX artifact division/coord/team (UUID-like ids) when safe
 * - Canonicalizes legacy siglas (DJT-PLA -> DJT-PLAN, DJTV-ITP -> DJTV-ITA, DJTV-VOR -> DJTV-VOT, DJTB-STO -> DJTB-SAN)
 * - Ensures coordination/team rows exist for canonical ids (DJT/DJTV/DJTB + DJT-PLAN and coords)
 * - Normalizes profiles to use `team_id = sigla_area` (sigla/coord as the canonical team id)
 * - Updates pending_registrations + challenges target arrays accordingly
 * - Backfills `teams.coordination_id` from `teams.coord_id` (fixes Studio hierarchy)
 * - Removes legacy duplicate team ids (VOT/JUN/PJU/ITA/CUB/SAN/PLA etc) when safe
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { assertDjtQuestSupabaseUrl } from "../server/env-guard.js";

const APPLY = process.argv.includes("--apply");
const DRY = !APPLY;
const GUEST_TEAM_ID = "CONVIDADOS";
const ROOT_DIVISION_IDS = new Set(["DJT", "DJTV", "DJTB"]);

const CANON_SIGLA = {
  "DJT-PLA": "DJT-PLAN",
  "DJTV-ITP": "DJTV-ITA",
  "DJTV-VOR": "DJTV-VOT",
  "DJTB-STO": "DJTB-SAN",
};

const CITY_BY_CODE = {
  CUB: "Cubatão",
  SAN: "Santos",
  VOT: "Votorantim",
  JUN: "Jundiaí",
  PJU: "Piraju",
  ITA: "Itapetininga",
  PLAN: "Planejamento",
};

const CANONICAL_TEAM_IDS = new Set([
  "DJT",
  "DJT-PLAN",
  "DJTV",
  "DJTV-VOT",
  "DJTV-JUN",
  "DJTV-PJU",
  "DJTV-ITA",
  "DJTB",
  "DJTB-CUB",
  "DJTB-SAN",
  GUEST_TEAM_ID,
]);

function loadDotenvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const txt = fs.readFileSync(filePath, "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const key = m[1];
      let value = m[2];
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // ignore
  }
}

function canonicalizeSigla(raw) {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) return "";
  return CANON_SIGLA[s] || s;
}

function upper(raw) {
  return String(raw ?? "").trim().toUpperCase();
}

function isGuestSigla(sigla) {
  const s = upper(sigla);
  return s === GUEST_TEAM_ID || s === "EXTERNO";
}

function divisionFromSigla(sigla) {
  const s = upper(sigla);
  if (s.startsWith("DJTV")) return "DJTV";
  if (s.startsWith("DJTB")) return "DJTB";
  if (s.startsWith("DJT")) return "DJT";
  return "";
}

function desiredTeamName(teamId) {
  const id = upper(teamId);
  if (!id) return "";
  if (id === GUEST_TEAM_ID) return "Convidados (externo)";
  if (id === "DJT-PLAN") return "DJT - Planejamento";
  if (ROOT_DIVISION_IDS.has(id)) return id;

  const m = /^(DJT|DJTV|DJTB)-([A-Z0-9]+)$/.exec(id);
  if (!m) return "";
  const prefix = m[1];
  const code = m[2];
  const city = CITY_BY_CODE[code] || code;
  return `${prefix} - ${city}`;
}

function isUuidLikeTextId(raw) {
  const s = String(raw ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function canonicalSiglaFromProfileRow(p) {
  const candidate = upper(p?.sigla_area) || upper(p?.team_id) || upper(p?.coord_id) || upper(p?.operational_base);
  return canonicalizeSigla(candidate);
}

function uniq(items) {
  return Array.from(new Set(items));
}

function chunk(items, size = 50) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function main() {
  // Load env (prefer .env.local)
  loadDotenvFile(path.join(process.cwd(), ".env"));
  loadDotenvFile(path.join(process.cwd(), ".env.local"));
  loadDotenvFile(path.join(process.cwd(), ".vercel.env.local"));

  const projectUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!projectUrl) throw new Error("Missing SUPABASE_URL (or VITE_SUPABASE_URL)");
  assertDjtQuestSupabaseUrl(projectUrl, { allowLocal: true, envName: "SUPABASE_URL" });
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(projectUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const [
    { data: divisions, error: divErr },
    { data: coords, error: coordErr },
    { data: teams, error: teamErr },
    { data: profiles, error: profErr },
    { data: pendingRegs, error: pendErr },
    { data: challenges, error: chalErr },
    { data: teamPerfRows, error: teamPerfErr },
    { data: teamEventRows, error: teamEventErr },
  ] = await Promise.all([
    supabase.from("divisions").select("id,name").limit(2000),
    supabase.from("coordinations").select("id,name,division_id").limit(2000),
    supabase.from("teams").select("id,name,coord_id,coordination_id").limit(5000),
    supabase.from("profiles").select("id,sigla_area,operational_base,team_id,coord_id,division_id,is_leader,studio_access").limit(5000),
    supabase.from("pending_registrations").select("id,sigla_area,operational_base,status").limit(5000),
    supabase.from("challenges").select("id,title,target_team_ids,target_coord_ids,target_div_ids").limit(5000),
    supabase.from("team_performance_log").select("id,team_id").limit(5000),
    supabase.from("team_events").select("id,team_id").limit(5000),
  ]);

  if (divErr) throw divErr;
  if (coordErr) throw coordErr;
  if (teamErr) throw teamErr;
  if (profErr) throw profErr;
  if (pendErr) console.warn("pending_registrations read warn:", pendErr.message);
  if (chalErr) console.warn("challenges read warn:", chalErr.message);
  if (teamPerfErr) console.warn("team_performance_log read warn:", teamPerfErr.message);
  if (teamEventErr) console.warn("team_events read warn:", teamEventErr.message);

  const divRows = divisions || [];
  const coordRows = coords || [];
  const teamRows = teams || [];
  const profRows = profiles || [];
  const pendRows = pendingRegs || [];
  const chalRows = challenges || [];
  const perfRows = teamPerfRows || [];
  const tEventRows = teamEventRows || [];

  // 1) Identify DJTX artifacts (uuid-like ids with DJTX names)
  const artifactDivIds = divRows
    .filter((d) => isUuidLikeTextId(d.id) && String(d.name || "").toUpperCase().startsWith("DJTX"))
    .map((d) => String(d.id));
  const artifactCoordIds = coordRows
    .filter((c) => artifactDivIds.includes(String(c.division_id)) || (isUuidLikeTextId(c.id) && String(c.name || "").toUpperCase().includes("DJTX")))
    .map((c) => String(c.id));
  const artifactTeamIds = teamRows
    .filter((t) => artifactCoordIds.includes(String(t.coord_id || "")) || (isUuidLikeTextId(t.id) && String(t.name || "").toUpperCase().includes("DJTX")))
    .map((t) => String(t.id));

  const artifactProfileRefs = profRows.filter((p) => artifactDivIds.includes(String(p.division_id)) || artifactCoordIds.includes(String(p.coord_id)) || artifactTeamIds.includes(String(p.team_id)));

  // 2) Canonicalize legacy sigla values
  const profilePatches = [];
  const pendingPatches = [];
  const teamCoordPatches = [];

  const canonicalizeProfile = (p) => {
    const siglaRaw = upper(p.sigla_area);
    const sigla = canonicalSiglaFromProfileRow(p);
    const coordRaw = upper(p.coord_id);
    const teamRaw = upper(p.team_id);
    const baseUpper = upper(p.operational_base);
    const baseCanon = canonicalizeSigla(p.operational_base);
    const patch = {};

    const shouldBeGuest = isGuestSigla(sigla) || teamRaw === GUEST_TEAM_ID || baseUpper === GUEST_TEAM_ID;
    if (shouldBeGuest) {
      if (siglaRaw !== GUEST_TEAM_ID) patch.sigla_area = GUEST_TEAM_ID;
      if (teamRaw !== GUEST_TEAM_ID) patch.team_id = GUEST_TEAM_ID;
      if (baseUpper !== GUEST_TEAM_ID) patch.operational_base = GUEST_TEAM_ID;
      if (p.coord_id !== null) patch.coord_id = null;
      if (p.division_id !== null) patch.division_id = null;
      if (!Object.keys(patch).length) return null;
      return { id: String(p.id), ...patch };
    }

    // Canonical sigla
    if (sigla && sigla !== siglaRaw) patch.sigla_area = sigla;

    // Canonical team id (team_id = sigla_area)
    if (sigla && teamRaw !== sigla) patch.team_id = sigla;

    // Canonical coord/div derived from sigla when possible
    const divDesired = divisionFromSigla(sigla);
    const divRaw = upper(p.division_id);
    if (divDesired && divRaw !== divDesired) patch.division_id = divDesired;

    if (sigla.includes("-")) {
      if (coordRaw !== sigla) patch.coord_id = sigla;
    } else {
      const coordCanon = canonicalizeSigla(coordRaw);
      if (coordCanon && coordCanon !== coordRaw) patch.coord_id = coordCanon;
    }

    // Canonicalize base only when it is a legacy sigla token (avoid mutating city names)
    if (baseCanon && baseCanon !== baseUpper) patch.operational_base = baseCanon;
    if (!p.operational_base && sigla) patch.operational_base = sigla;

    if (!Object.keys(patch).length) return null;
    return { id: String(p.id), ...patch };
  };

  for (const p of profRows) {
    const next = canonicalizeProfile(p);
    if (next) profilePatches.push(next);
  }

  // Teams: ensure coordination_id mirrors coord_id (and canonicalize legacy coord ids)
  for (const t of teamRows) {
    const idRaw = String(t.id || "");
    const id = upper(idRaw);
    const coordId = canonicalizeSigla(upper(t.coord_id) || upper(t.coordination_id));
    const patch = { id: idRaw };
    let changed = false;

    let desiredCoordId = coordId;
    if (!desiredCoordId && id.includes("-")) desiredCoordId = canonicalizeSigla(id);

    if (desiredCoordId && upper(t.coord_id) !== desiredCoordId) {
      patch.coord_id = desiredCoordId;
      changed = true;
    }
    if (desiredCoordId && upper(t.coordination_id) !== desiredCoordId) {
      patch.coordination_id = desiredCoordId;
      changed = true;
    }

    if (changed) teamCoordPatches.push(patch);
  }

  const canonicalizePending = (r) => {
    const siglaRaw = upper(r.sigla_area);
    const sigla = canonicalizeSigla(siglaRaw);
    const baseUpper = upper(r.operational_base);
    const baseCanon = canonicalizeSigla(r.operational_base);
    const patch = {};

    const shouldBeGuest = isGuestSigla(sigla) || baseUpper === GUEST_TEAM_ID;
    if (shouldBeGuest) {
      if (siglaRaw !== GUEST_TEAM_ID) patch.sigla_area = GUEST_TEAM_ID;
      if (baseUpper !== GUEST_TEAM_ID) patch.operational_base = GUEST_TEAM_ID;
    } else {
      if (sigla && sigla !== siglaRaw) patch.sigla_area = sigla;
      if (baseCanon && baseCanon !== baseUpper) patch.operational_base = baseCanon;
    }

    if (!Object.keys(patch).length) return null;
    return { id: String(r.id), ...patch };
  };

  for (const r of pendRows) {
    const next = canonicalizePending(r);
    if (next) pendingPatches.push(next);
  }

  // 3) Challenges: replace legacy ids inside target arrays
  const challengePatches = [];
  for (const ch of chalRows) {
    const fixArr = (arr) => {
      if (!Array.isArray(arr)) return arr;
      const next = arr.map((v) => canonicalizeSigla(v)).filter(Boolean);
      return next.length ? uniq(next) : null;
    };
    const nextTeams = fixArr(ch.target_team_ids);
    const nextCoords = fixArr(ch.target_coord_ids);
    const nextDivs = fixArr(ch.target_div_ids);
    const changed =
      JSON.stringify(nextTeams) !== JSON.stringify(ch.target_team_ids || null) ||
      JSON.stringify(nextCoords) !== JSON.stringify(ch.target_coord_ids || null) ||
      JSON.stringify(nextDivs) !== JSON.stringify(ch.target_div_ids || null);
    if (changed) {
      challengePatches.push({
        id: String(ch.id),
        target_team_ids: nextTeams,
        target_coord_ids: nextCoords,
        target_div_ids: nextDivs,
      });
    }
  }

  // 4) Cleanup unused legacy org rows after patches
  const legacyCoordIdsToRemove = ["DJTV-ITP", "DJT-PLA"].filter((id) => coordRows.some((c) => upper(c.id) === id));

  const shortDupTeamIds = teamRows
    .filter((t) => !upper(t.id).includes("-") && upper(t.coord_id || t.coordination_id).includes("-"))
    .map((t) => upper(t.id))
    .filter((id) => id && !ROOT_DIVISION_IDS.has(id) && id !== GUEST_TEAM_ID);

  const legacyTeamIdsToRemove = uniq(
    [
      ...shortDupTeamIds,
      "DJTV-ITP",
      "DJT-PLA",
      "DJTB-STO",
      "DJTV-VOR",
      "PLA",
    ].filter((id) => teamRows.some((t) => upper(t.id) === id)),
  );

  const teamNamePatches = teamRows
    .map((t) => {
      const id = upper(t.id);
      const nextName = desiredTeamName(id);
      if (!nextName) return null;
      const currentName = String(t.name || "").trim();
      if (currentName === nextName) return null;
      return { id: String(t.id), name: nextName };
    })
    .filter(Boolean);

  // Ensure canonical org objects exist (teams + coords) before profile changes
  const neededTeamIds = uniq(profRows.map((p) => canonicalSiglaFromProfileRow(p)).filter(Boolean)).filter((id) => !isGuestSigla(id));
  const neededCoordIds = uniq(neededTeamIds.filter((id) => id.includes("-")));

  const summary = {
    mode: DRY ? "dry-run" : "apply",
    artifacts: {
      divisions: artifactDivIds.length,
      coordinations: artifactCoordIds.length,
      teams: artifactTeamIds.length,
      profiles_referencing: artifactProfileRefs.length,
    },
    patches: {
      profiles: profilePatches.length,
      pending_registrations: pendingPatches.length,
      challenges: challengePatches.length,
      teams_coordination_backfill: teamCoordPatches.length,
      teams_rename: teamNamePatches.length,
    },
    remove: {
      legacy_coords: legacyCoordIdsToRemove,
      legacy_teams: legacyTeamIdsToRemove,
    },
    ensure: {
      coordinations: neededCoordIds.filter((id) => !coordRows.some((c) => upper(c.id) === id)),
      teams: neededTeamIds.filter((id) => !teamRows.some((t) => upper(t.id) === id)),
    },
  };

  console.log(JSON.stringify(summary, null, 2));

  if (DRY) {
    console.log("DRY-RUN: no changes applied. Re-run with --apply to execute.");
    return;
  }

  // Ensure core divisions exist
  for (const divId of ["DJT", "DJTV", "DJTB"]) {
    await supabase.from("divisions").upsert({ id: divId, name: `Divisão ${divId}` }, { onConflict: "id" });
  }

  // Ensure coordinations exist (including DJT-PLAN)
  if (neededCoordIds.length) {
    const upserts = neededCoordIds.map((id) => ({
      id,
      division_id: divisionFromSigla(id) || null,
      name: id,
    }));
    for (const batch of chunk(upserts, 100)) {
      const { error } = await supabase.from("coordinations").upsert(batch, { onConflict: "id" });
      if (error) throw error;
    }
  }

  // Ensure teams exist for canonical ids used by profiles
  const missingTeamIds = neededTeamIds.filter((id) => !teamRows.some((t) => upper(t.id) === id));
  if (missingTeamIds.length) {
    const upserts = missingTeamIds.map((id) => ({
      id,
      name: desiredTeamName(id) || id,
      coord_id: id.includes("-") ? id : null,
      coordination_id: id.includes("-") ? id : null,
    }));
    for (const batch of chunk(upserts, 100)) {
      const { error } = await supabase.from("teams").upsert(batch, { onConflict: "id" });
      if (error) throw error;
    }
  }

  // Ensure guests team exists
  await supabase.from("teams").upsert({ id: GUEST_TEAM_ID, name: "Convidados (externo)" }, { onConflict: "id" });

  // Apply pending registration patches
  if (pendingPatches.length) {
    for (const patch of pendingPatches) {
      const { id, ...changes } = patch;
      const { error } = await supabase.from("pending_registrations").update(changes).eq("id", id);
      if (error) throw error;
    }
  }

  // Apply profile patches
  if (profilePatches.length) {
    // Avoid `upsert` for partial patches: PostgREST may null columns when batch rows have different keys.
    for (const patch of profilePatches) {
      const { id, ...changes } = patch;
      const { error } = await supabase.from("profiles").update(changes).eq("id", id);
      if (error) throw error;
    }
  }

  // Apply challenge patches
  if (challengePatches.length) {
    // Use update (not upsert): guarantees we don't accidentally attempt inserts that violate NOT NULL constraints.
    for (const patch of challengePatches) {
      const { id, ...changes } = patch;
      const { error } = await supabase.from("challenges").update(changes).eq("id", id);
      if (error) throw error;
    }
  }

  // Apply teams coordination backfill patches
  if (teamCoordPatches.length) {
    for (const patch of teamCoordPatches) {
      const { id, ...changes } = patch;
      const { error } = await supabase.from("teams").update(changes).eq("id", id);
      if (error) throw error;
    }
  }

  // Improve team names (best-effort)
  if (teamNamePatches.length) {
    for (const patch of teamNamePatches) {
      const { id, ...changes } = patch;
      const { error } = await supabase.from("teams").update(changes).eq("id", id);
      if (error) throw error;
    }
  }

  // Remove legacy teams/coordinations if no longer referenced
  const [
    { data: profilesAfter },
    { data: perfAfter },
    { data: eventsAfter },
    { data: teamsAfter },
  ] = await Promise.all([
    supabase.from("profiles").select("team_id,coord_id,division_id").limit(5000),
    supabase.from("team_performance_log").select("team_id").limit(5000),
    supabase.from("team_events").select("team_id").limit(5000),
    supabase.from("teams").select("id,coord_id,coordination_id").limit(5000),
  ]);

  const usedTeamIds = new Set([
    ...(profilesAfter || []).map((p) => upper(p.team_id)),
    ...(perfAfter || []).map((p) => upper(p.team_id)),
    ...(eventsAfter || []).map((p) => upper(p.team_id)),
  ].filter(Boolean));

  const safeDeleteTeams = legacyTeamIdsToRemove.filter((id) => !usedTeamIds.has(id));

  if (safeDeleteTeams.length) {
    const { error } = await supabase.from("teams").delete().in("id", safeDeleteTeams);
    if (error) throw error;
  }

  const safeDeleteTeamsSet = new Set(safeDeleteTeams.map((id) => upper(id)));
  const remainingTeams = (teamsAfter || []).filter((t) => !safeDeleteTeamsSet.has(upper(t.id)));
  const usedCoordIds = new Set([
    ...(profilesAfter || []).map((p) => upper(p.coord_id)),
    ...remainingTeams.map((t) => upper(t.coord_id || t.coordination_id)),
  ].filter(Boolean));

  const safeDeleteCoords = legacyCoordIdsToRemove.filter((id) => !usedCoordIds.has(id));
  if (safeDeleteCoords.length) {
    const { error } = await supabase.from("coordinations").delete().in("id", safeDeleteCoords);
    if (error) throw error;
  }

  // Remove DJTX artifacts when safe
  if (artifactProfileRefs.length === 0) {
    if (artifactTeamIds.length) {
      const { error } = await supabase.from("teams").delete().in("id", artifactTeamIds);
      if (error) throw error;
    }
    if (artifactCoordIds.length) {
      const { error } = await supabase.from("coordinations").delete().in("id", artifactCoordIds);
      if (error) throw error;
    }
    if (artifactDivIds.length) {
      const { error } = await supabase.from("divisions").delete().in("id", artifactDivIds);
      if (error) throw error;
    }
  } else {
    console.warn("DJTX artifacts still referenced by profiles; skipping delete.");
  }

  console.log("✅ Org normalization applied.");
}

main().catch((err) => {
  console.error("normalize-org-hierarchy error:", err?.message || err);
  process.exit(1);
});
